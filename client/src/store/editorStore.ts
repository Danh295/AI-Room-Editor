import { create } from 'zustand';
import { produce } from 'immer';
import type { LibraryItem, PlacedItem, Project, ProjectSettings, Pt } from '@room/shared';
import {
  createProject,
  appendWall,
  startChain,
  closeChain,
  placeItem,
  newId,
} from '@room/shared';
import { api } from '../api.js';

/** Which pointer gesture the canvas is currently interpreting. */
export type Tool = 'select' | 'pan' | 'wall' | 'door' | 'window';

/** Tools that put something new into the room, as opposed to navigating it. */
const DRAWING_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['wall', 'door', 'window']);

/**
 * A wall chain being drawn, held outside the project on purpose.
 *
 * Committing each click straight into the room would put a half-drawn outline
 * in the saved file and leave one undo entry per click. Instead the chain lives
 * here until it's finished, then lands in the project as a single edit.
 */
export interface DraftChain {
  points: Pt[];
  /** Live cursor position for the rubber-band segment; null when off-canvas. */
  hover: Pt | null;
}

/** Ids are prefixed at creation, so what a selection refers to is readable. */
export type SelectionKind = 'wall' | 'vertex' | 'opening' | 'item' | 'unknown';

export function idKind(id: string): SelectionKind {
  if (id.startsWith('w_')) return 'wall';
  if (id.startsWith('v_')) return 'vertex';
  if (id.startsWith('op_')) return 'opening';
  if (id.startsWith('pl_')) return 'item';
  return 'unknown';
}

/**
 * Undo history is snapshot-based rather than patch-based.
 *
 * Every edit goes through immer, so each new project object shares every
 * unchanged subtree with its predecessor. Holding 100 past versions of a room
 * with a few dozen items costs almost nothing, and it sidesteps the entire
 * class of bugs where an inverse patch doesn't quite invert. If projects ever
 * grow large enough for this to matter, the fix is a cap, not a rewrite.
 */
const HISTORY_LIMIT = 100;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface EditorState {
  project: Project | null;
  library: LibraryItem[];

  past: Project[];
  future: Project[];
  /** Snapshot taken at gesture start; null when no gesture is in flight. */
  gestureBase: Project | null;

  selection: string[];
  tool: Tool;
  draft: DraftChain | null;
  saveState: SaveState;
  saveError: string | null;
  loading: boolean;
  loadError: string | null;

  // --- lifecycle
  loadProject: (id: string) => Promise<void>;
  newProject: (name?: string) => Promise<void>;
  /** Drop the open project without touching disk — used after a delete. */
  closeProject: () => void;
  loadLibrary: () => Promise<void>;

  // --- editing
  /** Apply a change and record one undo entry. */
  edit: (recipe: (draft: Project) => void) => void;
  /**
   * Start a continuous gesture (a drag, a slider). Intermediate `edit` calls
   * inside the gesture mutate without pushing history; `endGesture` records the
   * whole thing as a single undo entry.
   */
  beginGesture: () => void;
  endGesture: () => void;
  cancelGesture: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  updateSettings: (patch: Partial<ProjectSettings>) => void;

  // --- library
  saveLibraryItem: (item: LibraryItem) => Promise<void>;
  removeLibraryItem: (id: string) => Promise<void>;
  /** Place a library item into the current room; returns the placement id. */
  placeInRoom: (libraryId: string, x: number, y: number) => string | null;
  removePlacement: (placementId: string) => void;
  /** Patch one placement. Use inside a gesture for drags. */
  updatePlacement: (placementId: string, patch: Partial<PlacedItem>) => void;
  /**
   * Copy every selected item, offset so the copy is visible and selected.
   * Returns the new placement ids.
   */
  duplicateSelection: (offsetX: number, offsetY: number) => string[];
  /** Nudge every selected, unlocked item. */
  nudgeSelection: (dx: number, dy: number) => void;
  /** Rotate selected items by a delta, wrapped into [0,360). */
  rotateSelection: (deltaDeg: number) => void;
  deleteSelection: () => void;

  // --- tools and wall drawing
  setTool: (tool: Tool) => void;
  draftStart: (point: Pt) => void;
  draftAdd: (point: Pt) => void;
  draftHover: (point: Pt | null) => void;
  draftUndoPoint: () => void;
  /** Commit the chain to the room as one undoable edit. `close` joins the ends. */
  draftFinish: (close: boolean) => void;
  draftCancel: () => void;

  // --- selection
  select: (ids: string[]) => void;
  toggleSelect: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  /**
   * What Esc means: undo one level of "what I'm in the middle of". A draft is
   * abandoned first; with none, a non-pointer tool drops back to the pointer
   * (selection kept); already on the pointer, the selection clears.
   */
  escape: () => void;

  // --- persistence
  save: () => Promise<void>;
}

/** Debounced autosave, shared across all mutations. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DELAY_MS = 600;

/*
  A failed save used to be the end of the story: the status bar said "Save
  failed" and nothing tried again until the next edit. Restart the server mid
  session and the last few minutes of work lived only in a tab. So failures now
  back off and retry on their own, and the unload guard below refuses to let the
  tab close quietly while anything is still unsaved.
*/
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = 0;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

export const useEditor = create<EditorState>((set, get) => {
  function scheduleSave() {
    set({ saveState: 'dirty' });
    // A fresh edit supersedes whatever the retry was going to send.
    retryTimer = clearTimer(retryTimer);
    retryDelayMs = 0;
    saveTimer = clearTimer(saveTimer);
    saveTimer = setTimeout(() => void get().save(), AUTOSAVE_DELAY_MS);
  }

  /** Try again after a failure, backing off so a down server isn't hammered. */
  function scheduleRetry() {
    retryTimer = clearTimer(retryTimer);
    retryDelayMs =
      retryDelayMs === 0 ? RETRY_BASE_MS : Math.min(retryDelayMs * 2, RETRY_MAX_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void get().save();
    }, retryDelayMs);
  }

  /** Replace the project and mark it dirty, with optional history push. */
  function commit(next: Project, pushHistory: boolean) {
    const { project, past } = get();
    if (!project) return;

    set({
      project: next,
      ...(pushHistory
        ? {
            past: [...past, project].slice(-HISTORY_LIMIT),
            future: [], // a new edit invalidates the redo branch
          }
        : {}),
    });
    scheduleSave();
  }

  return {
    project: null,
    library: [],
    past: [],
    future: [],
    gestureBase: null,
    selection: [],
    tool: 'select',
    draft: null,
    saveState: 'idle',
    saveError: null,
    loading: false,
    loadError: null,

    async loadProject(id) {
      set({ loading: true, loadError: null });
      try {
        const project = await api.getProject(id);
        set({
          project,
          past: [],
          future: [],
          gestureBase: null,
          selection: [],
          loading: false,
          saveState: 'saved',
        });
      } catch (err) {
        set({ loading: false, loadError: (err as Error).message });
      }
    },

    async newProject(name) {
      const project = createProject(name);
      set({
        project,
        past: [],
        future: [],
        gestureBase: null,
        selection: [],
        loadError: null,
      });
      // Persist immediately so a refresh right after creation finds it.
      await get().save();
    },

    closeProject() {
      // Cancel a queued autosave first: writing the project back out is exactly
      // what must not happen when it has just been deleted.
      saveTimer = clearTimer(saveTimer);
      retryTimer = clearTimer(retryTimer);
      set({
        project: null,
        past: [],
        future: [],
        gestureBase: null,
        selection: [],
        draft: null,
        saveState: 'idle',
        saveError: null,
      });
    },

    async loadLibrary() {
      try {
        set({ library: await api.getLibrary() });
      } catch (err) {
        console.error('[library]', err);
      }
    },

    edit(recipe) {
      const { project, gestureBase } = get();
      if (!project) return;
      const next = produce(project, recipe);
      if (next === project) return; // recipe was a no-op; don't dirty the file
      commit(next, gestureBase === null);
    },

    beginGesture() {
      const { project, gestureBase } = get();
      if (!project || gestureBase !== null) return;
      set({ gestureBase: project });
    },

    endGesture() {
      const { gestureBase, project, past } = get();
      if (!gestureBase || !project) return;

      // Nothing actually moved — don't leave an empty undo step behind.
      if (gestureBase === project) {
        set({ gestureBase: null });
        return;
      }

      set({
        past: [...past, gestureBase].slice(-HISTORY_LIMIT),
        future: [],
        gestureBase: null,
      });
    },

    cancelGesture() {
      const { gestureBase } = get();
      if (!gestureBase) return;
      set({ project: gestureBase, gestureBase: null });
      scheduleSave();
    },

    undo() {
      const { past, future, project, gestureBase } = get();
      if (gestureBase || !project || past.length === 0) return;
      const previous = past[past.length - 1]!;
      set({
        project: previous,
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
      });
      scheduleSave();
    },

    redo() {
      const { past, future, project, gestureBase } = get();
      if (gestureBase || !project || future.length === 0) return;
      const next = future[0]!;
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
      });
      scheduleSave();
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    updateSettings(patch) {
      get().edit((draft) => {
        Object.assign(draft.settings, patch);
      });
    },

    async saveLibraryItem(item) {
      // Update in memory first so the panel reflects the edit immediately;
      // the file is the source of truth but the round trip shouldn't be felt.
      const { library } = get();
      const index = library.findIndex((i) => i.id === item.id);
      set({
        library:
          index >= 0 ? library.map((i) => (i.id === item.id ? item : i)) : [...library, item],
      });
      try {
        const saved = await api.saveLibraryItem(item);
        set({
          library: get().library.map((i) => (i.id === saved.id ? saved : i)),
        });
      } catch (err) {
        console.error('[library] save failed', err);
        // Roll back to what was on disk rather than showing a phantom item.
        set({ library: await api.getLibrary().catch(() => get().library) });
      }
    },

    async removeLibraryItem(id) {
      set({ library: get().library.filter((i) => i.id !== id) });
      try {
        await api.deleteLibraryItem(id);
      } catch (err) {
        console.error('[library] delete failed', err);
      }
    },

    placeInRoom(libraryId, x, y) {
      const { project, library } = get();
      if (!project) return null;
      const item = library.find((i) => i.id === libraryId);
      if (!item) return null;

      const placement = placeItem(item, x, y);
      get().edit((d) => {
        d.items.push(placement);
      });
      set({ selection: [placement.id] });
      return placement.id;
    },

    updatePlacement(placementId, patch) {
      get().edit((d) => {
        const target = d.items.find((i) => i.id === placementId);
        if (!target) return;
        // A locked item refuses every patch except one that changes the lock
        // itself — otherwise locking would be a one-way door, since the
        // `{ locked: false }` that clears the flag is exactly what the guard
        // would drop.
        if (target.locked && !('locked' in patch)) return;
        Object.assign(target, patch);
      });
    },

    duplicateSelection(offsetX, offsetY) {
      const { selection, project } = get();
      if (!project || selection.length === 0) return [];

      const originals = project.items.filter((i) => selection.includes(i.id));
      if (originals.length === 0) return [];

      // A duplicate is a new placement of the same library item, so it gets a
      // fresh id and drops nothing else — including `locked`, since a copy you
      // cannot move is not much of a copy.
      const copies: PlacedItem[] = originals.map((original) => ({
        ...original,
        id: newId('pl'),
        x: Math.round(original.x + offsetX),
        y: Math.round(original.y + offsetY),
        locked: false,
      }));

      get().edit((d) => {
        d.items.push(...copies);
      });
      const ids = copies.map((c) => c.id);
      set({ selection: ids });
      return ids;
    },

    nudgeSelection(dx, dy) {
      const { selection } = get();
      if (selection.length === 0) return;
      get().edit((d) => {
        for (const item of d.items) {
          if (!selection.includes(item.id) || item.locked) continue;
          item.x = Math.round(item.x + dx);
          item.y = Math.round(item.y + dy);
        }
      });
    },

    rotateSelection(deltaDeg) {
      const { selection } = get();
      if (selection.length === 0) return;
      get().edit((d) => {
        for (const item of d.items) {
          if (!selection.includes(item.id) || item.locked) continue;
          item.rotation = (((item.rotation + deltaDeg) % 360) + 360) % 360;
        }
      });
    },

    deleteSelection() {
      const { selection } = get();
      if (selection.length === 0) return;
      get().edit((d) => {
        // Locked pieces are deliberately pinned; deleting them from under a
        // stray keypress would be worse than ignoring the keypress.
        d.items = d.items.filter((i) => !selection.includes(i.id) || i.locked);
      });
      set({ selection: [] });
    },

    removePlacement(placementId) {
      get().edit((d) => {
        d.items = d.items.filter((i) => i.id !== placementId);
      });
      set({ selection: get().selection.filter((id) => id !== placementId) });
    },

    setTool(tool) {
      // Switching away mid-chain would strand the draft with no way to finish
      // or discard it, so drop it regardless of where the tool is headed.
      //
      // The selection is different: it's only cleared when *drawing* starts,
      // not when the pointer or pan tool takes over. Losing a selection
      // because you moved the view is exactly the kind of thing that makes
      // people stop trusting a tool.
      const { selection } = get();
      set({
        tool,
        draft: null,
        selection: DRAWING_TOOLS.has(tool) ? [] : selection,
      });
    },

    draftStart(point) {
      set({ draft: { points: [point], hover: point } });
    },

    draftAdd(point) {
      const { draft } = get();
      if (!draft) {
        set({ draft: { points: [point], hover: point } });
        return;
      }
      const last = draft.points[draft.points.length - 1];
      // Ignore a repeat click on the same spot; it would create a zero-length
      // wall that renders as nothing and can never be selected to delete.
      if (last && last.x === point.x && last.y === point.y) return;
      set({ draft: { points: [...draft.points, point], hover: point } });
    },

    draftHover(point) {
      const { draft } = get();
      if (!draft) return;
      set({ draft: { ...draft, hover: point } });
    },

    draftUndoPoint() {
      const { draft } = get();
      if (!draft) return;
      const points = draft.points.slice(0, -1);
      set({ draft: points.length === 0 ? null : { ...draft, points } });
    },

    draftFinish(close) {
      const { draft, project } = get();
      if (!draft || !project) {
        set({ draft: null });
        return;
      }

      const points = draft.points;
      // A single point isn't a wall. Discard rather than leaving a stray vertex.
      if (points.length < 2) {
        set({ draft: null });
        return;
      }

      const thickness = project.settings.defaultWallThickness;
      get().edit((d) => {
        let previous = startChain(d.room, points[0]!);
        const firstId = previous;
        for (let i = 1; i < points.length; i += 1) {
          previous = appendWall(d.room, previous, points[i]!, thickness);
        }
        if (close && points.length >= 3) {
          closeChain(d.room, previous, firstId, thickness);
        }
      });

      set({ draft: null });
    },

    draftCancel() {
      set({ draft: null });
    },

    select(ids) {
      set({ selection: ids });
    },

    toggleSelect(id, additive) {
      const { selection } = get();
      if (!additive) {
        set({ selection: selection.length === 1 && selection[0] === id ? [] : [id] });
        return;
      }
      set({
        selection: selection.includes(id)
          ? selection.filter((s) => s !== id)
          : [...selection, id],
      });
    },

    clearSelection() {
      set({ selection: [] });
    },

    escape() {
      /*
        Spelled out rather than left to `setTool` side effects. Esc used to
        deselect only because switching to the pointer happened to clear the
        selection; once switching tools stopped doing that, Esc quietly
        stopped deselecting at all.
      */
      const { draft, tool } = get();
      if (draft) {
        get().draftCancel();
        return;
      }
      if (tool !== 'select') {
        get().setTool('select');
        return;
      }
      get().clearSelection();
    },

    async save() {
      const { project } = get();
      if (!project) return;

      // Whatever armed this call, it has now happened.
      saveTimer = clearTimer(saveTimer);
      set({ saveState: 'saving', saveError: null });

      try {
        const saved = await api.saveProject(project);
        retryDelayMs = 0;

        // Only adopt the server's echo if nothing changed while in flight;
        // otherwise we'd clobber edits the user made during the round trip.
        // Reporting "Saved" in that case would be a lie too — the edit that
        // landed mid-flight is still only in memory, and the pending autosave
        // is what will write it.
        if (get().project?.id === saved.id && get().saveState === 'saving') {
          set({
            project: { ...get().project!, updatedAt: saved.updatedAt },
            saveState: 'saved',
          });
        }
      } catch (err) {
        set({ saveState: 'error', saveError: (err as Error).message });
        scheduleRetry();
      }
    },
  };
});

/*
  Refuse to close quietly with unsaved work.

  Anything other than "saved" means the newest version of the plan exists only
  in this tab: 'dirty' is waiting on the debounce, 'saving' is in flight and may
  still fail, and 'error' is actively retrying. The browser shows its own
  wording; all we control is whether it asks at all.
*/
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    const { project, saveState } = useEditor.getState();
    if (!project || saveState === 'saved' || saveState === 'idle') return;
    event.preventDefault();
    // Older browsers need the assignment rather than preventDefault alone.
    event.returnValue = '';
  });
}

/** Remember the last opened project so a refresh returns to it. */
const LAST_PROJECT_KEY = 'roomEditor.lastProjectId';

export function rememberProject(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    /* private browsing / storage disabled */
  }
}

export function forgetProject(): void {
  try {
    localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    /* private browsing / storage disabled */
  }
}

export function recallProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

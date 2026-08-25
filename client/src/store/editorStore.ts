import { create } from 'zustand';
import { produce } from 'immer';
import type { LibraryItem, Project, ProjectSettings } from '@room/shared';
import { createProject } from '@room/shared';
import { api } from '../api.js';

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
  saveState: SaveState;
  saveError: string | null;
  loading: boolean;
  loadError: string | null;

  // --- lifecycle
  loadProject: (id: string) => Promise<void>;
  newProject: (name?: string) => Promise<void>;
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

  // --- selection
  select: (ids: string[]) => void;
  toggleSelect: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  // --- persistence
  save: () => Promise<void>;
}

/** Debounced autosave, shared across all mutations. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DELAY_MS = 600;

export const useEditor = create<EditorState>((set, get) => {
  function scheduleSave() {
    set({ saveState: 'dirty' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().save(), AUTOSAVE_DELAY_MS);
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

    async save() {
      const { project } = get();
      if (!project) return;
      set({ saveState: 'saving', saveError: null });
      try {
        const saved = await api.saveProject(project);
        // Only adopt the server's echo if nothing changed while in flight;
        // otherwise we'd clobber edits the user made during the round trip.
        if (get().project?.id === saved.id && get().saveState === 'saving') {
          set({ project: { ...get().project!, updatedAt: saved.updatedAt } });
        }
        set({ saveState: 'saved' });
      } catch (err) {
        set({ saveState: 'error', saveError: (err as Error).message });
      }
    },
  };
});

/** Remember the last opened project so a refresh returns to it. */
const LAST_PROJECT_KEY = 'roomEditor.lastProjectId';

export function rememberProject(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
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

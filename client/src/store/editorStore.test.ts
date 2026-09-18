import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem, Project } from '@room/shared';
import { createLibraryItem, rectangularRoom } from '@room/shared';

/*
  The store talks to the server through ./api, and none of what's under test
  here is about HTTP. Stubbing it keeps these tests about undo history, gesture
  coalescing and save bookkeeping — and lets a save be made to fail on demand,
  which is the interesting case.
*/
const saveProject = vi.hoisted(() => vi.fn());
const getLibrary = vi.hoisted(() => vi.fn());
const saveLibraryItem = vi.hoisted(() => vi.fn());
const deleteLibraryItem = vi.hoisted(() => vi.fn());

vi.mock('../api.js', () => ({
  api: { saveProject, getLibrary, saveLibraryItem, deleteLibraryItem },
}));

const { useEditor } = await import('./editorStore.js');

const sofa = (): LibraryItem =>
  createLibraryItem({ name: 'Sofa', subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });

/** Put the store in a known state: one room, one library item, no history. */
function reset(library: LibraryItem[] = [sofa()]): Project {
  const project: Project = {
    id: 'proj_test',
    name: 'Test room',
    settings: {
      units: 'imperial',
      gridStep: 25,
      snapToGrid: true,
      snapToWalls: true,
      showGrid: true,
      showDimensions: true,
      showClearances: true,
      itemRender: 'both',
      defaultWallThickness: 114,
    },
    room: rectangularRoom(4000, 3000),
    items: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  useEditor.setState({
    project,
    library,
    past: [],
    future: [],
    gestureBase: null,
    selection: [],
    saveState: 'saved',
    saveError: null,
  });
  return project;
}

beforeEach(() => {
  vi.useFakeTimers();
  saveProject.mockReset().mockImplementation(async (p: Project) => ({
    ...p,
    updatedAt: new Date().toISOString(),
  }));
  reset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('edit and history', () => {
  it('records one undo step per edit and restores the previous state', () => {
    const { edit, undo } = useEditor.getState();

    edit((d) => {
      d.name = 'Renamed';
    });
    expect(useEditor.getState().project?.name).toBe('Renamed');
    expect(useEditor.getState().past).toHaveLength(1);

    undo();
    expect(useEditor.getState().project?.name).toBe('Test room');
    expect(useEditor.getState().future).toHaveLength(1);
  });

  it('ignores an edit that changes nothing', () => {
    useEditor.getState().edit((d) => {
      // Immer returns the same object when a recipe writes the value that was
      // already there, and the store must not treat that as a change.
      d.name = 'Test room';
    });
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().saveState).toBe('saved');
  });

  it('collapses a whole gesture into a single undo step', () => {
    const { beginGesture, edit, endGesture, undo } = useEditor.getState();

    beginGesture();
    for (const name of ['a', 'ab', 'abc']) {
      edit((d) => {
        d.name = name;
      });
    }
    endGesture();

    expect(useEditor.getState().past).toHaveLength(1);
    undo();
    expect(useEditor.getState().project?.name).toBe('Test room');
  });

  it('leaves no undo step behind for a gesture that changed nothing', () => {
    const { beginGesture, endGesture } = useEditor.getState();
    beginGesture();
    endGesture();
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('cancels a gesture back to where it started', () => {
    const { beginGesture, edit, cancelGesture } = useEditor.getState();
    beginGesture();
    edit((d) => {
      d.name = 'half-dragged';
    });
    cancelGesture();
    expect(useEditor.getState().project?.name).toBe('Test room');
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('drops the redo branch once a new edit lands', () => {
    const { edit, undo } = useEditor.getState();
    edit((d) => {
      d.name = 'one';
    });
    undo();
    expect(useEditor.getState().future).toHaveLength(1);

    edit((d) => {
      d.name = 'two';
    });
    expect(useEditor.getState().future).toHaveLength(0);
  });
});

describe('placements', () => {
  it('places a library item and selects it', () => {
    const item = useEditor.getState().library[0]!;
    const id = useEditor.getState().placeInRoom(item.id, 100, 200);

    expect(id).toBeTruthy();
    expect(useEditor.getState().project?.items).toHaveLength(1);
    expect(useEditor.getState().selection).toEqual([id]);
  });

  it('refuses to place an item that is not in the library', () => {
    expect(useEditor.getState().placeInRoom('item_nope', 0, 0)).toBeNull();
    expect(useEditor.getState().project?.items).toHaveLength(0);
  });

  it('refuses to move a locked item but can still unlock it', () => {
    const item = useEditor.getState().library[0]!;
    const id = useEditor.getState().placeInRoom(item.id, 0, 0)!;

    useEditor.getState().updatePlacement(id, { locked: true });
    useEditor.getState().updatePlacement(id, { x: 999 });
    expect(useEditor.getState().project?.items[0]?.x).toBe(0);

    useEditor.getState().updatePlacement(id, { locked: false });
    useEditor.getState().updatePlacement(id, { x: 999 });
    expect(useEditor.getState().project?.items[0]?.x).toBe(999);
  });

  it('never deletes a locked item out from under a stray keypress', () => {
    const item = useEditor.getState().library[0]!;
    const id = useEditor.getState().placeInRoom(item.id, 0, 0)!;
    useEditor.getState().updatePlacement(id, { locked: true });

    useEditor.getState().select([id]);
    useEditor.getState().deleteSelection();
    expect(useEditor.getState().project?.items).toHaveLength(1);
  });

  it('rotates into [0,360) rather than drifting negative', () => {
    const item = useEditor.getState().library[0]!;
    const id = useEditor.getState().placeInRoom(item.id, 0, 0)!;
    useEditor.getState().select([id]);

    useEditor.getState().rotateSelection(-90);
    expect(useEditor.getState().project?.items[0]?.rotation).toBe(270);
    useEditor.getState().rotateSelection(180);
    expect(useEditor.getState().project?.items[0]?.rotation).toBe(90);
  });
});

describe('wall drafting', () => {
  it('commits a closed chain as one undo step', () => {
    const state = useEditor.getState();
    state.draftStart({ x: 0, y: 0 });
    state.draftAdd({ x: 1000, y: 0 });
    state.draftAdd({ x: 1000, y: 1000 });
    state.draftFinish(true);

    const room = useEditor.getState().project!.room;
    // Four walls of the starting rectangle, plus this closed triangle.
    expect(room.walls).toHaveLength(7);
    expect(useEditor.getState().past).toHaveLength(1);
    expect(useEditor.getState().draft).toBeNull();
  });

  it('throws away a chain of one point instead of stranding a vertex', () => {
    const before = Object.keys(useEditor.getState().project!.room.vertices).length;
    useEditor.getState().draftStart({ x: 0, y: 0 });
    useEditor.getState().draftFinish(false);

    expect(Object.keys(useEditor.getState().project!.room.vertices)).toHaveLength(before);
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('ignores a repeat click on the same point', () => {
    useEditor.getState().draftStart({ x: 10, y: 10 });
    useEditor.getState().draftAdd({ x: 10, y: 10 });
    expect(useEditor.getState().draft?.points).toHaveLength(1);
  });
});

describe('saving', () => {
  it('debounces an edit into one save', async () => {
    useEditor.getState().edit((d) => {
      d.name = 'a';
    });
    useEditor.getState().edit((d) => {
      d.name = 'ab';
    });
    expect(useEditor.getState().saveState).toBe('dirty');
    expect(saveProject).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(useEditor.getState().saveState).toBe('saved');
  });

  it('does not claim "saved" when an edit landed mid-flight', async () => {
    let release: (value: Project) => void = () => {};
    saveProject.mockImplementationOnce(
      () => new Promise<Project>((resolve) => (release = resolve)),
    );

    useEditor.getState().edit((d) => {
      d.name = 'first';
    });
    await vi.advanceTimersByTimeAsync(700);
    expect(useEditor.getState().saveState).toBe('saving');

    // An edit arrives while the request is still out.
    useEditor.getState().edit((d) => {
      d.name = 'second';
    });
    release({ ...useEditor.getState().project!, updatedAt: 'whenever' });
    await vi.advanceTimersByTimeAsync(0);

    // The newer edit is not on disk yet, so the status must not say it is.
    expect(useEditor.getState().saveState).toBe('dirty');

    await vi.advanceTimersByTimeAsync(700);
    expect(useEditor.getState().saveState).toBe('saved');
    expect(useEditor.getState().project?.name).toBe('second');
  });

  it('retries a failed save on its own, then settles', async () => {
    saveProject.mockRejectedValueOnce(new Error('server is down'));

    useEditor.getState().edit((d) => {
      d.name = 'needs saving';
    });
    await vi.advanceTimersByTimeAsync(700);

    expect(useEditor.getState().saveState).toBe('error');
    expect(useEditor.getState().saveError).toMatch(/server is down/);

    // No further edit happens; the retry has to come from the store itself.
    await vi.advanceTimersByTimeAsync(1200);
    expect(saveProject).toHaveBeenCalledTimes(2);
    expect(useEditor.getState().saveState).toBe('saved');
  });

  it('backs off rather than hammering a server that stays down', async () => {
    saveProject.mockRejectedValue(new Error('still down'));

    useEditor.getState().edit((d) => {
      d.name = 'x';
    });
    await vi.advanceTimersByTimeAsync(700);
    expect(saveProject).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(saveProject).toHaveBeenCalledTimes(2);

    // The next attempt is further out than the last one.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saveProject).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saveProject).toHaveBeenCalledTimes(3);
  });

});

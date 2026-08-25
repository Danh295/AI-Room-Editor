import { create } from 'zustand';
import type { Conflict } from '@room/shared';

/**
 * The current conflict list, published by the canvas for the status bar.
 *
 * Kept out of the editor store because it's derived state, not document state:
 * it must never be undoable, never mark the file dirty, and never be saved.
 * Recomputing it in the status bar instead would mean running the whole O(n^2)
 * check twice per frame during a drag.
 */
export interface ConflictState {
  conflicts: Conflict[];
  /** Index of the conflict the user last cycled to. */
  cursor: number;
  set: (conflicts: Conflict[]) => void;
  /** Advance to the next conflict and return it, or null when there are none. */
  next: () => Conflict | null;
}

export const useConflictStore = create<ConflictState>((set, get) => ({
  conflicts: [],
  cursor: -1,

  set(conflicts) {
    const previous = get().conflicts;
    // Avoid a re-render when nothing meaningful changed — this runs on every
    // frame of a drag.
    if (
      previous.length === conflicts.length &&
      previous.every((c, i) => {
        const next = conflicts[i];
        return next && c.kind === next.kind && c.message === next.message;
      })
    ) {
      return;
    }
    set({ conflicts, cursor: -1 });
  },

  next() {
    const { conflicts, cursor } = get();
    if (conflicts.length === 0) return null;
    const index = (cursor + 1) % conflicts.length;
    set({ cursor: index });
    return conflicts[index] ?? null;
  },
}));

/** A short tally for the status bar: "2 overlaps · 1 clearance". */
export function summarize(conflicts: Conflict[]): string {
  if (conflicts.length === 0) return 'No conflicts';

  const counts = new Map<string, number>();
  for (const c of conflicts) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);

  const label: Record<string, [string, string]> = {
    overlap: ['overlap', 'overlaps'],
    clearance: ['clearance conflict', 'clearance conflicts'],
    outside: ['outside the room', 'outside the room'],
    door: ['blocking a door', 'blocking a door'],
  };

  return [...counts.entries()]
    .map(([kind, n]) => {
      const [one, many] = label[kind] ?? [kind, kind];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(' · ');
}

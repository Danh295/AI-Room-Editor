import { beforeEach, describe, expect, it } from 'vitest';
import type { Conflict } from '@room/shared';
import { useConflictStore } from './conflictStore.js';

const overlap = (a: string, b: string): Conflict => ({
  kind: 'overlap',
  itemIds: [a, b],
  message: 'Accent chair overlaps Coffee table',
});

beforeEach(() => {
  useConflictStore.setState({ conflicts: [], cursor: -1 });
});

describe('conflict store', () => {
  it('replaces a conflict that reads the same but involves a different copy', () => {
    useConflictStore.getState().set([overlap('chair_1', 'table')]);
    // A duplicate chair, same name, now the one in the way.
    useConflictStore.getState().set([overlap('chair_2', 'table')]);

    expect(useConflictStore.getState().next()?.itemIds).toEqual(['chair_2', 'table']);
  });

  it('keeps the list (and the cursor) when nothing changed', () => {
    useConflictStore.getState().set([overlap('chair_1', 'table')]);
    useConflictStore.getState().next();
    useConflictStore.getState().set([overlap('chair_1', 'table')]);
    expect(useConflictStore.getState().cursor).toBe(0);
  });
});

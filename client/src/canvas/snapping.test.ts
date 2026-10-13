import { describe, expect, it } from 'vitest';
import type { LibraryItem, PlacedItem } from '@room/shared';
import { createLibraryItem, placeItem, rectangularRoom } from '@room/shared';
import { snapItemDrag } from './snapping.js';

const sofa = (): LibraryItem =>
  createLibraryItem({ name: 'Sofa', subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });

const settings = { snapToWalls: true, snapToGrid: true, gridStep: 25 };

describe('snapItemDrag', () => {
  it('keeps a wall snap exact instead of rounding it back to the grid', () => {
    const room = rectangularRoom(4000, 3000);
    const item = sofa();
    // Already facing the bottom wall, so the wall snap doesn't change rotation —
    // the case where grid rounding used to win.
    const placed: PlacedItem = { ...placeItem(item, 2000, 2400), rotation: 180 };

    const next = snapItemDrag(placed, item, 2000, 2420, {
      room,
      settings,
      others: [],
      toleranceMm: 100,
    });

    // Inner face of the bottom wall is at 3000 - 57; the sofa's back sits on it.
    expect(next.y + 450).toBe(3000 - 57);
  });

  it('keeps an item snap exact on its axis and grids the other', () => {
    const room = rectangularRoom(8000, 8000);
    const item = sofa();
    const anchor: PlacedItem = { ...placeItem(item, 3000, 4000), rotation: 0 };
    const placed: PlacedItem = { ...placeItem(item, 5013, 4011), rotation: 0 };

    const next = snapItemDrag(placed, item, 5013, 4011, {
      room,
      settings,
      others: [{ placed: anchor, item }],
      toleranceMm: 40,
    });

    // Flush side by side: the 2000-wide pieces' centres are 2000 apart.
    expect(next.x).toBe(5000);
    expect(next.y % 25).toBe(0);
  });

  it('keeps an axis that was already exactly flush with a neighbour', () => {
    const room = rectangularRoom(8000, 8000);
    const item = sofa();
    const anchor: PlacedItem = { ...placeItem(item, 3003, 4000), rotation: 0 };
    // Dragged to exactly flush (x = 3003 + 2000), on a coarse grid that would
    // otherwise round it to 4864 or 5016.
    const placed: PlacedItem = { ...placeItem(item, 5003, 4011), rotation: 0 };
    const next = snapItemDrag(placed, item, 5003, 4011, {
      room,
      settings: { ...settings, gridStep: 152 },
      others: [{ placed: anchor, item }],
      toleranceMm: 40,
    });
    expect(next.x).toBe(5003);
  });

  it('falls back to the grid when nothing is close', () => {
    const room = rectangularRoom(8000, 8000);
    const item = sofa();
    const placed: PlacedItem = { ...placeItem(item, 4000, 4000), rotation: 0 };
    const next = snapItemDrag(placed, item, 4012, 3988, {
      room,
      settings,
      others: [],
      toleranceMm: 40,
    });
    expect(next).toMatchObject({ x: 4000, y: 4000 });
  });
});

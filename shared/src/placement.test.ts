import { describe, it, expect } from 'vitest';
import {
  localFootprint,
  toWorld,
  footprintPolygon,
  polygonsOverlap,
  overlapFraction,
  clearanceZones,
  doorSwingPolygon,
  findConflicts,
  conflictedIds,
  rotationForWall,
  snapToWall,
  snapToItems,
  boundsOfPoints,
} from './placement.js';
import { createLibraryItem, placeItem, rectangularRoom } from './factory.js';
import { addOpening } from './roomOps.js';
import { polygonArea, pointInPolygon, wallInwardNormal } from './geometry.js';
import { MM_PER_INCH } from './units.js';
import type { LibraryItem, PlacedItem } from './types.js';

const sofa = () =>
  createLibraryItem({ name: 'Sofa', subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });
const table = () =>
  createLibraryItem({ name: 'Table', subcategoryId: 'coffee-table', w: 1200, d: 600, h: 450 });

function place(item: LibraryItem, x: number, y: number, rotation = 0): PlacedItem {
  return { ...placeItem(item, x, y), rotation };
}

function lib(...items: LibraryItem[]): Map<string, LibraryItem> {
  return new Map(items.map((i) => [i.id, i]));
}

describe('localFootprint', () => {
  it('centres a rectangle on the origin', () => {
    const pts = localFootprint({ kind: 'rect' }, 2000, 900);
    expect(pts).toHaveLength(4);
    expect(boundsOfPoints(pts)).toEqual({ minX: -1000, minY: -450, maxX: 1000, maxY: 450 });
  });

  it('cuts a notch out of an L-shape, keeping it inside the bounding box', () => {
    const pts = localFootprint({ kind: 'L', notchW: 0.5, notchD: 0.5, corner: 'ne' }, 2000, 1000);
    expect(pts).toHaveLength(6);
    expect(boundsOfPoints(pts)).toEqual({ minX: -1000, minY: -500, maxX: 1000, maxY: 500 });
    // An L is smaller than its bounding box by exactly the notch.
    expect(polygonArea(pts)).toBe(2000 * 1000 - 1000 * 500);
  });

  it('notches each of the four corners', () => {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const pts = localFootprint({ kind: 'L', notchW: 0.4, notchD: 0.4, corner }, 1000, 1000);
      expect(pts, corner).toHaveLength(6);
      expect(polygonArea(pts), corner).toBeCloseTo(1000 * 1000 - 400 * 400, 6);
    }
  });

  it('clamps a nonsense notch instead of inverting the shape', () => {
    const pts = localFootprint({ kind: 'L', notchW: 5, notchD: -3, corner: 'ne' }, 1000, 1000);
    expect(boundsOfPoints(pts).maxX).toBeLessThanOrEqual(500);
    expect(polygonArea(pts)).toBeGreaterThan(0);
  });

  it('scales a normalized polygon to the item size', () => {
    const pts = localFootprint(
      { kind: 'poly', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] },
      1000,
      800,
    );
    expect(pts).toEqual([
      { x: -500, y: -400 },
      { x: 500, y: -400 },
      { x: 0, y: 400 },
    ]);
  });
});

describe('toWorld', () => {
  const square = [
    { x: -100, y: -100 },
    { x: 100, y: -100 },
    { x: 100, y: 100 },
    { x: -100, y: 100 },
  ];

  it('translates', () => {
    const out = toWorld(square, { x: 1000, y: 500, rotation: 0, flipX: false });
    expect(boundsOfPoints(out)).toEqual({ minX: 900, minY: 400, maxX: 1100, maxY: 600 });
  });

  it('rotates clockwise about the item centre', () => {
    const out = toWorld([{ x: 100, y: 0 }], { x: 0, y: 0, rotation: 90, flipX: false });
    expect(out[0]!.x).toBeCloseTo(0, 6);
    expect(out[0]!.y).toBeCloseTo(100, 6);
  });

  it('mirrors across the item centre when flipped', () => {
    const out = toWorld([{ x: 100, y: 50 }], { x: 0, y: 0, rotation: 0, flipX: true });
    expect(out[0]).toEqual({ x: -100, y: 50 });
  });

  it('flips before rotating, so the two compose predictably', () => {
    const out = toWorld([{ x: 100, y: 0 }], { x: 0, y: 0, rotation: 90, flipX: true });
    expect(out[0]!.x).toBeCloseTo(0, 6);
    expect(out[0]!.y).toBeCloseTo(-100, 6);
  });
});

describe('polygonsOverlap', () => {
  const box = (x: number, y: number, s = 100) => [
    { x: x - s, y: y - s },
    { x: x + s, y: y - s },
    { x: x + s, y: y + s },
    { x: x - s, y: y + s },
  ];

  it('detects a crossing overlap', () => {
    expect(polygonsOverlap(box(0, 0), box(50, 50))).toBe(true);
  });

  it('reports disjoint shapes as clear', () => {
    expect(polygonsOverlap(box(0, 0), box(500, 500))).toBe(false);
  });

  it('detects full containment, which has no edge crossings', () => {
    expect(polygonsOverlap(box(0, 0, 500), box(0, 0, 50))).toBe(true);
    expect(polygonsOverlap(box(0, 0, 50), box(0, 0, 500))).toBe(true);
  });

  it('treats flush edges as not overlapping', () => {
    // Pushing a sofa against a sofa is an arrangement, not a collision.
    expect(polygonsOverlap(box(0, 0), box(200, 0))).toBe(false);
  });

  it('handles a concave L correctly where a bounding box would not', () => {
    // The notch of an L is inside its bbox but outside the shape itself.
    const L = localFootprint({ kind: 'L', notchW: 0.5, notchD: 0.5, corner: 'ne' }, 2000, 1000);
    const inNotch = [
      { x: 700, y: -400 },
      { x: 900, y: -400 },
      { x: 900, y: -200 },
      { x: 700, y: -200 },
    ];
    expect(polygonsOverlap(L, inNotch)).toBe(false);

    const inSolid = [
      { x: -900, y: -400 },
      { x: -700, y: -400 },
      { x: -700, y: -200 },
      { x: -900, y: -200 },
    ];
    expect(polygonsOverlap(L, inSolid)).toBe(true);
  });

  it('ignores degenerate input', () => {
    expect(polygonsOverlap([], box(0, 0))).toBe(false);
    expect(polygonsOverlap([{ x: 0, y: 0 }], box(0, 0))).toBe(false);
  });
});

describe('overlapFraction', () => {
  const box = (x: number, y: number, s: number) => [
    { x: x - s, y: y - s },
    { x: x + s, y: y - s },
    { x: x + s, y: y + s },
    { x: x - s, y: y + s },
  ];

  it('is 1 when fully contained', () => {
    expect(overlapFraction(box(0, 0, 50), box(0, 0, 500))).toBe(1);
  });

  it('is 0 when disjoint', () => {
    expect(overlapFraction(box(0, 0, 50), box(5000, 0, 50))).toBe(0);
  });

  it('is between for a partial overlap', () => {
    const f = overlapFraction(box(0, 0, 100), box(100, 0, 100));
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });
});

describe('clearanceZones', () => {
  it('puts a sofa walkway in front of it, in -Y when unrotated', () => {
    const item = sofa();
    const zones = clearanceZones(place(item, 0, 0), item);
    const front = zones.find((z) => z.side === 'front')!;

    expect(front.depth).toBe(Math.round(18 * MM_PER_INCH));
    // Front is -Y: the zone sits above the sofa on screen.
    expect(boundsOfPoints(front.polygon).maxY).toBeCloseTo(-450, 6);
  });

  it('rotates the zone with the item', () => {
    const item = sofa();
    const zones = clearanceZones(place(item, 0, 0, 180), item);
    const front = zones.find((z) => z.side === 'front')!;
    // Turned around, the walkway is now below the sofa.
    expect(boundsOfPoints(front.polygon).minY).toBeCloseTo(450, 6);
  });

  it('omits sides with no clearance', () => {
    const item = sofa(); // front-only clearance
    const sides = clearanceZones(place(item, 0, 0), item).map((z) => z.side);
    expect(sides).toEqual(['front']);
  });

  it('gives a dining table all four sides', () => {
    const item = createLibraryItem({
      name: 'Dining',
      subcategoryId: 'dining-table',
      w: 1800,
      d: 900,
      h: 750,
    });
    const sides = clearanceZones(place(item, 0, 0), item)
      .map((z) => z.side)
      .sort();
    expect(sides).toEqual(['back', 'front', 'left', 'right']);
  });

  it('honours a per-placement clearance override', () => {
    const item = sofa();
    const placed = { ...place(item, 0, 0), clearances: { front: 100 } };
    expect(clearanceZones(placed, item).find((z) => z.side === 'front')!.depth).toBe(100);
  });
});

describe('rotationForWall', () => {
  // Outward normal points into the wall; the item's back (+Y) must follow it.
  it('turns an item to face into the room from each wall', () => {
    expect(rotationForWall({ x: 0, y: -1 })).toBeCloseTo(180, 6); // top wall
    expect(rotationForWall({ x: -1, y: 0 })).toBeCloseTo(90, 6); // left wall
    expect(rotationForWall({ x: 0, y: 1 })).toBeCloseTo(0, 6); // bottom wall
    expect(rotationForWall({ x: 1, y: 0 })).toBeCloseTo(270, 6); // right wall
  });
});

describe('snapToWall', () => {
  const room = rectangularRoom(6000, 4000, 100);

  it('pulls an item flush and turns its back to the wall', () => {
    const item = sofa();
    // Near the top wall, slightly off and unrotated.
    const snap = snapToWall(place(item, 3000, 520), item, room, 200);

    expect(snap).not.toBeNull();
    // Centre sits half the wall thickness plus half the depth in from the face.
    expect(snap!.y).toBe(50 + 450);
    expect(snap!.rotation).toBeCloseTo(180, 6);
  });

  it('leaves an item alone when no wall is close', () => {
    const item = sofa();
    expect(snapToWall(place(item, 3000, 2000), item, room, 200)).toBeNull();
  });

  it('picks the nearer of two candidate walls', () => {
    const item = sofa();
    // Near the top-left corner: closer to the left wall than the top.
    const snap = snapToWall(place(item, 480, 300), item, room, 2000);
    expect(snap).not.toBeNull();
    expect(snap!.rotation).toBeCloseTo(90, 6); // left wall
  });

  it('cannot slide an item past the end of a wall', () => {
    const item = sofa();
    const snap = snapToWall(place(item, -9999, 520), item, room, 100_000);
    if (snap) {
      expect(snap.x).toBeGreaterThanOrEqual(0);
      expect(snap.x).toBeLessThanOrEqual(6000);
    }
  });
});

describe('snapToItems', () => {
  it('pulls an item flush against a neighbour', () => {
    const a = sofa();
    const b = table();
    const placedA = place(a, 0, 0); // spans x -1000..1000
    const placedB = place(b, 1650, 0); // spans x 1050..2250, 50mm gap

    const snap = snapToItems(placedB, b, [{ placed: placedA, item: a }], 100);
    expect(snap).not.toBeNull();
    expect(snap!.x).toBe(1600); // left edge now at 1000
  });

  it('ignores neighbours that are too far', () => {
    const a = sofa();
    const b = table();
    expect(snapToItems(place(b, 9000, 0), b, [{ placed: place(a, 0, 0), item: a }], 100)).toBeNull();
  });

  it('ignores a neighbour that does not face it on the other axis', () => {
    const a = sofa();
    const b = table();
    // Alongside but far away in Y — nothing to be flush with.
    const snap = snapToItems(place(b, 1050, 9000), b, [{ placed: place(a, 0, 0), item: a }], 100);
    expect(snap).toBeNull();
  });
});

describe('findConflicts', () => {
  const room = rectangularRoom(6000, 4000, 100);

  it('finds nothing in an empty room', () => {
    expect(findConflicts([], new Map(), room)).toEqual([]);
  });

  it('reports two items driven through each other', () => {
    const s = sofa();
    const t = table();
    const items = [place(s, 3000, 2000), place(t, 3000, 2000)];
    const conflicts = findConflicts(items, lib(s, t), room);
    expect(conflicts.filter((c) => c.kind === 'overlap')).toHaveLength(1);
  });

  it('does not report items merely touching', () => {
    const s = sofa();
    const t = table();
    // Sofa spans x 2000..4000; table starts exactly at 4000.
    const items = [place(s, 3000, 2000), place(t, 4600, 2000)];
    expect(findConflicts(items, lib(s, t), room).filter((c) => c.kind === 'overlap')).toEqual([]);
  });

  it('reports furniture pushed through a wall', () => {
    const s = sofa();
    const conflicts = findConflicts([place(s, 5800, 2000)], lib(s), room);
    expect(conflicts.some((c) => c.kind === 'outside')).toBe(true);
  });

  it('reports a blocked clearance even when nothing overlaps', () => {
    const s = sofa(); // 2000x900, 18" (457mm) front clearance
    const t = table();
    // Table sits 300mm in front of the sofa: no collision, but no walkway.
    const items = [place(s, 3000, 2000), place(t, 3000, 2000 - 450 - 300 - 300)];
    const conflicts = findConflicts(items, lib(s, t), room);

    expect(conflicts.filter((c) => c.kind === 'overlap')).toEqual([]);

    // Both items technically violate each other here — the table stands in the
    // sofa's walkway, and the sofa stands in the table's reach zone. That is one
    // gap, so it must be reported once, keeping the more demanding side (the
    // sofa's 18" beats the table's 16").
    const clearance = conflicts.filter((c) => c.kind === 'clearance');
    expect(clearance).toHaveLength(1);
    expect(clearance[0]!.side).toBe('front');
    expect(clearance[0]!.message).toContain('Sofa');
  });

  it('clears the clearance once the item is moved far enough away', () => {
    const s = sofa();
    const t = table();
    // 600mm of gap, comfortably past the 457mm requirement.
    const items = [place(s, 3000, 2000), place(t, 3000, 2000 - 450 - 600 - 300)];
    expect(findConflicts(items, lib(s, t), room).filter((c) => c.kind === 'clearance')).toEqual([]);
  });

  it('lets a coffee table stand on a rug without complaint', () => {
    const rug = createLibraryItem({
      name: 'Rug',
      subcategoryId: 'area-rug',
      w: 2400,
      d: 1700,
      h: 10,
    });
    const t = table();
    const items = [place(rug, 3000, 2000), place(t, 3000, 2000)];
    expect(findConflicts(items, lib(rug, t), room)).toEqual([]);
  });

  it('ignores wall-mounted pieces hanging over furniture', () => {
    const art = createLibraryItem({ name: 'Art', subcategoryId: 'mirror', w: 800, d: 50, h: 1000 });
    const s = sofa();
    const items = [place(art, 3000, 2000), place(s, 3000, 2000)];
    expect(findConflicts(items, lib(art, s), room)).toEqual([]);
  });

  it('skips a placement whose library item is gone', () => {
    const s = sofa();
    const orphan = { ...place(s, 3000, 2000), libraryId: 'missing' };
    expect(() => findConflicts([orphan], new Map(), room)).not.toThrow();
    expect(findConflicts([orphan], new Map(), room)).toEqual([]);
  });

  it('flags furniture standing in a door swing', () => {
    const withDoor = rectangularRoom(6000, 4000, 100);
    addOpening(withDoor, withDoor.walls[0]!.id, { kind: 'door', offset: 2000, width: 900 });

    const t = table();
    // Just inside the top wall, right where the door sweeps.
    const items = [place(t, 2400, 500)];
    const conflicts = findConflicts(items, lib(t), withDoor);
    expect(conflicts.some((c) => c.kind === 'door')).toBe(true);
  });

  it('does not flag furniture well clear of the door', () => {
    const withDoor = rectangularRoom(6000, 4000, 100);
    addOpening(withDoor, withDoor.walls[0]!.id, { kind: 'door', offset: 200, width: 900 });

    const t = table();
    const conflicts = findConflicts([place(t, 5000, 3000)], lib(t), withDoor);
    expect(conflicts.some((c) => c.kind === 'door')).toBe(false);
  });

  it('collects every involved id for highlighting', () => {
    const s = sofa();
    const t = table();
    const items = [place(s, 3000, 2000), place(t, 3000, 2000)];
    const ids = conflictedIds(findConflicts(items, lib(s, t), room));
    expect(ids.size).toBe(2);
  });
});

describe('doorSwingPolygon', () => {
  it('sweeps into the room, not through the wall', () => {
    const room = rectangularRoom(6000, 4000, 100);
    const door = addOpening(room, room.walls[0]!.id, { kind: 'door', offset: 2000, width: 900 })!;
    const swing = doorSwingPolygon(room, door);

    expect(swing.length).toBeGreaterThan(3);
    const inward = wallInwardNormal(room, room.walls[0]!);
    expect(inward.y).toBeGreaterThan(0); // interior is below the top wall

    // Every point of the arc should be on the room side of that wall.
    const beyond = swing.filter((p) => p.y < -1);
    expect(beyond).toEqual([]);
  });

  it('returns nothing for a window', () => {
    const room = rectangularRoom(6000, 4000, 100);
    const win = addOpening(room, room.walls[0]!.id, { kind: 'window', offset: 1000, width: 900 })!;
    expect(doorSwingPolygon(room, win)).toEqual([]);
  });

  it('sweeps outward when the door opens out', () => {
    const room = rectangularRoom(6000, 4000, 100);
    const door = addOpening(room, room.walls[0]!.id, { kind: 'door', offset: 2000, width: 900 })!;
    door.swing!.into = 'out';
    const swing = doorSwingPolygon(room, door);
    // Now the far side of the arc lies outside the room.
    expect(swing.some((p) => p.y < 0)).toBe(true);
  });
});

describe('footprintPolygon', () => {
  it('places a rotated item where it belongs in the world', () => {
    const item = sofa(); // 2000 wide, 900 deep
    const polygon = footprintPolygon(place(item, 1000, 500, 90), item);
    const b = boundsOfPoints(polygon);
    // Rotated a quarter turn, width and depth swap.
    expect(Math.round(b.maxX - b.minX)).toBe(900);
    expect(Math.round(b.maxY - b.minY)).toBe(2000);
    expect(Math.round((b.minX + b.maxX) / 2)).toBe(1000);
  });

  it('respects a per-placement size override', () => {
    const item = sofa();
    const placed = { ...place(item, 0, 0), w: 1000 };
    const b = boundsOfPoints(footprintPolygon(placed, item));
    expect(Math.round(b.maxX - b.minX)).toBe(1000);
  });

  it('keeps every corner inside the room for a well-placed item', () => {
    const room = rectangularRoom(6000, 4000, 100);
    const ring = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 4000 },
      { x: 0, y: 4000 },
    ];
    const item = sofa();
    const polygon = footprintPolygon(place(item, 3000, 2000), item);
    expect(polygon.every((p) => pointInPolygon(p, ring))).toBe(true);
    void room;
  });
});

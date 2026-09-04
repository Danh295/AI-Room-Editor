import { describe, it, expect } from 'vitest';
import {
  newId,
  createProject,
  createLibraryItem,
  placeItem,
  rectangularRoom,
  lShapedRoom,
  roomFromPolygon,
  emptyRoom,
  effectiveSize,
  effectiveClearances,
} from './factory.js';
import { MM_PER_FOOT } from './units.js';

describe('newId', () => {
  it('prefixes and stays unique across a burst', () => {
    const ids = Array.from({ length: 500 }, () => newId('v'));
    expect(ids.every((id) => id.startsWith('v_'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('roomFromPolygon', () => {
  it('closes the loop, so wall count equals vertex count', () => {
    const room = rectangularRoom(4000, 3000);
    expect(Object.keys(room.vertices)).toHaveLength(4);
    expect(room.walls).toHaveLength(4);
  });

  it('chains walls end to end and back to the start', () => {
    const room = rectangularRoom(4000, 3000);
    for (let i = 0; i < room.walls.length; i += 1) {
      const next = room.walls[(i + 1) % room.walls.length]!;
      expect(room.walls[i]!.b).toBe(next.a);
    }
  });

  it('references only vertices that exist', () => {
    const room = lShapedRoom(5000, 4000, 2000, 1500);
    for (const wall of room.walls) {
      expect(room.vertices[wall.a]).toBeDefined();
      expect(room.vertices[wall.b]).toBeDefined();
    }
  });

  it('refuses to build a degenerate loop from fewer than three points', () => {
    expect(roomFromPolygon([{ x: 0, y: 0 }, { x: 100, y: 0 }]).walls).toEqual([]);
    expect(roomFromPolygon([]).walls).toEqual([]);
  });

  it('rounds coordinates to whole millimeters', () => {
    const room = roomFromPolygon([
      { x: 0.4, y: 0.6 },
      { x: 100.5, y: 0 },
      { x: 100, y: 100 },
    ]);
    for (const v of Object.values(room.vertices)) {
      expect(Number.isInteger(v.x)).toBe(true);
      expect(Number.isInteger(v.y)).toBe(true);
    }
  });
});

describe('lShapedRoom', () => {
  it('produces six corners', () => {
    const room = lShapedRoom(5000, 4000, 2000, 1500);
    expect(Object.keys(room.vertices)).toHaveLength(6);
    expect(room.walls).toHaveLength(6);
  });

  it('clamps a notch larger than the room rather than inverting it', () => {
    const room = lShapedRoom(3000, 3000, 9999, 9999);
    const xs = Object.values(room.vertices).map((v) => v.x);
    const ys = Object.values(room.vertices).map((v) => v.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(3000);
    expect(Math.max(...ys)).toBeLessThanOrEqual(3000);
  });
});

describe('createProject', () => {
  it('starts empty with imperial defaults', () => {
    const p = createProject();
    expect(p.items).toEqual([]);
    expect(p.room.walls).toEqual([]);
    expect(p.settings.units).toBe('imperial');
    expect(p.settings.gridStep).toBe(25); // 1 inch
  });

  it('uses a 10mm grid under metric', () => {
    expect(createProject('m', 'metric').settings.gridStep).toBe(10);
  });

  it('gives a sane default ceiling height', () => {
    expect(emptyRoom().ceilingHeight).toBe(Math.round(8 * MM_PER_FOOT));
  });
});

describe('createLibraryItem', () => {
  it('fills clearances and footprint from the subcategory', () => {
    const sofa = createLibraryItem({ name: 'KIVIK', subcategoryId: 'sofa', w: 2299, d: 950, h: 830 });
    expect(sofa.categoryId).toBe('seating');
    expect(sofa.clearances.front).toBeGreaterThan(0);
    expect(sofa.footprint).toEqual({ kind: 'rect' });
    expect(sofa.confidence).toBe('manual');
  });

  it('falls back to uncategorized for an unknown subcategory', () => {
    const odd = createLibraryItem({ name: '?', subcategoryId: 'hovercraft', w: 1, d: 1, h: 1 });
    expect(odd.subcategoryId).toBe('uncategorized');
    expect(odd.categoryId).toBe('other');
  });

  it('gives a sectional an L footprint', () => {
    const s = createLibraryItem({ name: 'S', subcategoryId: 'sectional', w: 2800, d: 2300, h: 860 });
    expect(s.footprint.kind).toBe('L');
  });

  it('rounds dimensions to whole millimeters', () => {
    const i = createLibraryItem({ name: 'x', subcategoryId: 'sofa', w: 2298.7, d: 950.2, h: 830.5 });
    expect(i.w).toBe(2299);
    expect(i.d).toBe(950);
  });
});

describe('placeItem', () => {
  it('inherits the category default layer', () => {
    const rug = createLibraryItem({ name: 'Rug', subcategoryId: 'area-rug', w: 2400, d: 3000, h: 10 });
    expect(placeItem(rug, 0, 0).layer).toBe('rug');

    const sofa = createLibraryItem({ name: 'Sofa', subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });
    expect(placeItem(sofa, 0, 0).layer).toBe('floor');
  });

  it('starts unrotated, unlocked, and on the floor plane', () => {
    const sofa = createLibraryItem({ name: 'S', subcategoryId: 'sofa', w: 1, d: 1, h: 1 });
    const p = placeItem(sofa, 10.6, 20.2);
    expect(p).toMatchObject({ rotation: 0, z: 0, locked: false, flipX: false, x: 11, y: 20 });
  });

  it('adopts the first variant, so the chosen colour reaches the plan', () => {
    const sofa = createLibraryItem({ name: 'S', subcategoryId: 'sofa', w: 1, d: 1, h: 1 });
    sofa.variants = [
      { id: 'var_teal', label: 'Teal', hex: '#008080' },
      { id: 'var_rust', label: 'Rust', hex: '#b7410e' },
    ];
    expect(placeItem(sofa, 0, 0).variantId).toBe('var_teal');
  });

  it('leaves variantId unset when the item has no variants', () => {
    const sofa = createLibraryItem({ name: 'S', subcategoryId: 'sofa', w: 1, d: 1, h: 1 });
    expect(sofa.variants).toHaveLength(0);
    expect(placeItem(sofa, 0, 0).variantId).toBeUndefined();
  });
});

describe('effective values', () => {
  const item = createLibraryItem({ name: 'S', subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });

  it('uses catalog dimensions when the placement has no overrides', () => {
    expect(effectiveSize(placeItem(item, 0, 0), item)).toEqual({ w: 2000, d: 900, h: 800 });
  });

  it('lets a placement override one dimension without disturbing the others', () => {
    const placed = { ...placeItem(item, 0, 0), w: 1800 };
    expect(effectiveSize(placed, item)).toEqual({ w: 1800, d: 900, h: 800 });
  });

  it('merges partial clearance overrides over the catalog values', () => {
    const placed = { ...placeItem(item, 0, 0), clearances: { front: 100 } };
    const merged = effectiveClearances(placed, item);
    expect(merged.front).toBe(100);
    expect(merged.back).toBe(item.clearances.back);
  });

  it('does not mutate the catalog item when merging', () => {
    const before = item.clearances.front;
    effectiveClearances({ ...placeItem(item, 0, 0), clearances: { front: 1 } }, item);
    expect(item.clearances.front).toBe(before);
  });
});

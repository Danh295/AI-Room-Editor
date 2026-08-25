/**
 * Constructors for new domain objects.
 *
 * These live in `shared` rather than the client so the server can mint the same
 * shapes when it seeds a project from an AI floor plan trace.
 */

import type {
  Clearances,
  LibraryItem,
  PlacedItem,
  Project,
  ProjectSettings,
  Room,
  UnitSystem,
  Wall,
} from './types.js';
import { defaultGridStep, MM_PER_INCH } from './units.js';
import { defaultClearances, defaultFootprint, defaultLayer, findSubcategory } from './taxonomy.js';

/**
 * Short, sortable, collision-resistant enough for a single-user local app.
 * Not a UUID: these end up in JSON a human may read and hand-edit.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}

const DEFAULT_WALL_THICKNESS = Math.round(4.5 * MM_PER_INCH); // 2x4 stud + drywall
const DEFAULT_CEILING_HEIGHT = 2438; // 8 ft

export function defaultSettings(units: UnitSystem = 'imperial'): ProjectSettings {
  return {
    units,
    gridStep: defaultGridStep(units),
    snapToGrid: true,
    snapToWalls: true,
    showGrid: true,
    showDimensions: true,
    showClearances: true,
    itemRender: 'both',
    defaultWallThickness: DEFAULT_WALL_THICKNESS,
  };
}

/** An empty room with no walls — the starting point for freehand drawing. */
export function emptyRoom(): Room {
  return {
    vertices: {},
    walls: [],
    openings: [],
    ceilingHeight: DEFAULT_CEILING_HEIGHT,
  };
}

/**
 * A closed loop of walls through the given points, in order.
 *
 * Points are interior corner positions; walls are drawn centered on the lines
 * between them. Fewer than three points yields a room with no walls rather than
 * a degenerate loop.
 */
export function roomFromPolygon(
  points: { x: number; y: number }[],
  thickness = DEFAULT_WALL_THICKNESS,
): Room {
  const room = emptyRoom();
  if (points.length < 3) return room;

  const ids = points.map(() => newId('v'));
  points.forEach((p, i) => {
    room.vertices[ids[i]!] = { x: Math.round(p.x), y: Math.round(p.y) };
  });

  for (let i = 0; i < ids.length; i += 1) {
    const wall: Wall = {
      id: newId('w'),
      a: ids[i]!,
      b: ids[(i + 1) % ids.length]!,
      thickness,
    };
    room.walls.push(wall);
  }

  return room;
}

/** Axis-aligned rectangular room with its top-left interior corner at origin. */
export function rectangularRoom(
  width: number,
  length: number,
  thickness = DEFAULT_WALL_THICKNESS,
): Room {
  return roomFromPolygon(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: length },
      { x: 0, y: length },
    ],
    thickness,
  );
}

/**
 * L-shaped room. `notchW` / `notchD` cut a rectangle out of the bottom-right
 * corner of the `width` x `length` bounding box.
 */
export function lShapedRoom(
  width: number,
  length: number,
  notchW: number,
  notchD: number,
  thickness = DEFAULT_WALL_THICKNESS,
): Room {
  const nw = Math.min(notchW, width - 1);
  const nd = Math.min(notchD, length - 1);
  return roomFromPolygon(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: length - nd },
      { x: width - nw, y: length - nd },
      { x: width - nw, y: length },
      { x: 0, y: length },
    ],
    thickness,
  );
}

export function createProject(name = 'Untitled room', units: UnitSystem = 'imperial'): Project {
  const now = new Date().toISOString();
  return {
    id: newId('proj'),
    name,
    settings: defaultSettings(units),
    room: emptyRoom(),
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface NewLibraryItemInput {
  name: string;
  subcategoryId: string;
  w: number;
  d: number;
  h: number;
  categoryId?: string;
  brand?: string;
  modelNumber?: string;
  price?: number;
  currency?: string;
  sourceUrl?: string;
  imageAssetId?: string;
  notes?: string;
  tags?: string[];
}

/**
 * Build a library item, filling category-derived defaults for footprint and
 * clearances so a manually-entered piece behaves like an ingested one.
 */
export function createLibraryItem(input: NewLibraryItemInput): LibraryItem {
  const now = new Date().toISOString();
  const found = findSubcategory(input.subcategoryId, input.categoryId);

  return {
    id: newId('item'),
    name: input.name,
    brand: input.brand,
    modelNumber: input.modelNumber,
    categoryId: found?.category.id ?? input.categoryId ?? 'other',
    subcategoryId: found?.subcategory.id ?? 'uncategorized',
    w: Math.round(input.w),
    d: Math.round(input.d),
    h: Math.round(input.h),
    footprint: defaultFootprint(input.subcategoryId),
    clearances: defaultClearances(input.subcategoryId),
    variants: [],
    price: input.price,
    currency: input.currency ?? 'CAD',
    sourceUrl: input.sourceUrl,
    imageAssetId: input.imageAssetId,
    confidence: 'manual',
    provenance: { method: 'manual', citations: [], capturedAt: now },
    tags: input.tags ?? [],
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
}

/** Place a library item at a point, inheriting the category's default layer. */
export function placeItem(item: LibraryItem, x: number, y: number): PlacedItem {
  return {
    id: newId('pl'),
    libraryId: item.id,
    x: Math.round(x),
    y: Math.round(y),
    rotation: 0,
    z: 0,
    flipX: false,
    locked: false,
    layer: defaultLayer(item.subcategoryId),
    tags: [],
  };
}

/** Effective dimensions for a placement: instance overrides win over the catalog. */
export function effectiveSize(
  placed: PlacedItem,
  item: LibraryItem,
): { w: number; d: number; h: number } {
  return {
    w: placed.w ?? item.w,
    d: placed.d ?? item.d,
    h: placed.h ?? item.h,
  };
}

/** Effective clearances for a placement, merging any per-side overrides. */
export function effectiveClearances(placed: PlacedItem, item: LibraryItem): Clearances {
  return { ...item.clearances, ...placed.clearances };
}

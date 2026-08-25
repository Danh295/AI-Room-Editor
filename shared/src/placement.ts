/**
 * Placement rules: where a piece of furniture physically is, what it collides
 * with, and whether you can actually use it once it's there.
 *
 * Local space convention, used by everything here and by the top-down glyphs:
 * an item is centred on the origin, its width runs along X, its depth along Y,
 * and it **faces -Y**. So the back of a sofa is +Y, and pushing it against a
 * wall means rotating it until +Y points into that wall.
 */

import type {
  Clearances,
  Footprint,
  LibraryItem,
  Opening,
  PlacedItem,
  Pt,
  Room,
} from './types.js';
import { effectiveClearances, effectiveSize } from './factory.js';
import {
  EPS,
  add,
  angleOf,
  degToRad,
  distance,
  normalize,
  perpendicular,
  pointInPolygon,
  roomPolygon,
  scale as vscale,
  sub,
  wallInwardNormal,
  wallSegment,
} from './geometry.js';

// ------------------------------------------------------------- footprints ---

/** Outline of a footprint in local space, centred on the origin. */
export function localFootprint(footprint: Footprint, w: number, d: number): Pt[] {
  const hw = w / 2;
  const hd = d / 2;

  if (footprint.kind === 'poly') {
    // Stored normalized to the bounding box so it survives a resize.
    return footprint.points.map((p) => ({ x: p.x * w - hw, y: p.y * d - hd }));
  }

  if (footprint.kind === 'L') {
    const nw = Math.min(Math.max(footprint.notchW, 0.01), 0.99) * w;
    const nd = Math.min(Math.max(footprint.notchD, 0.01), 0.99) * d;

    switch (footprint.corner) {
      case 'nw':
        return [
          { x: -hw + nw, y: -hd },
          { x: hw, y: -hd },
          { x: hw, y: hd },
          { x: -hw, y: hd },
          { x: -hw, y: -hd + nd },
          { x: -hw + nw, y: -hd + nd },
        ];
      case 'se':
        return [
          { x: -hw, y: -hd },
          { x: hw, y: -hd },
          { x: hw, y: hd - nd },
          { x: hw - nw, y: hd - nd },
          { x: hw - nw, y: hd },
          { x: -hw, y: hd },
        ];
      case 'sw':
        return [
          { x: -hw, y: -hd },
          { x: hw, y: -hd },
          { x: hw, y: hd },
          { x: -hw + nw, y: hd },
          { x: -hw + nw, y: hd - nd },
          { x: -hw, y: hd - nd },
        ];
      case 'ne':
      default:
        return [
          { x: -hw, y: -hd },
          { x: hw - nw, y: -hd },
          { x: hw - nw, y: -hd + nd },
          { x: hw, y: -hd + nd },
          { x: hw, y: hd },
          { x: -hw, y: hd },
        ];
    }
  }

  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
}

/** Local -> world, applying flip, rotation, then translation, in that order. */
export function toWorld(points: Pt[], placed: { x: number; y: number; rotation: number; flipX: boolean }): Pt[] {
  const rad = degToRad(placed.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = placed.flipX ? -1 : 1;

  return points.map((p) => {
    const lx = p.x * sx;
    const ly = p.y;
    return {
      x: placed.x + lx * cos - ly * sin,
      y: placed.y + lx * sin + ly * cos,
    };
  });
}

/** World-space outline of a placed item. */
export function footprintPolygon(placed: PlacedItem, item: LibraryItem): Pt[] {
  const { w, d } = effectiveSize(placed, item);
  return toWorld(localFootprint(placed.footprint ?? item.footprint, w, d), placed);
}

// -------------------------------------------------------------- collision ---

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
  const d2 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
  const d3 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const d4 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Do two polygons overlap?
 *
 * Edge crossings plus a containment check, rather than SAT. SAT is faster but
 * only valid for convex shapes, and L-shaped sectionals are the whole reason
 * custom footprints exist. At six to eight vertices the difference doesn't
 * matter; correctness on a concave sofa does.
 *
 * Touching exactly along an edge does not count as overlapping — furniture
 * pushed flush against furniture is a legitimate arrangement, not a conflict.
 */
export function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  if (a.length < 3 || b.length < 3) return false;

  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  // No crossings: either disjoint, or one is entirely inside the other.
  return pointInPolygon(a[0]!, b) || pointInPolygon(b[0]!, a);
}

/** How much of `a` lies inside `b`, sampled. Used to rank conflicts by severity. */
export function overlapFraction(a: Pt[], b: Pt[], samples = 6): number {
  if (a.length < 3) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  let inA = 0;
  let inBoth = 0;
  for (let i = 0; i < samples; i += 1) {
    for (let j = 0; j < samples; j += 1) {
      const p = {
        x: minX + ((i + 0.5) / samples) * (maxX - minX),
        y: minY + ((j + 0.5) / samples) * (maxY - minY),
      };
      if (!pointInPolygon(p, a)) continue;
      inA += 1;
      if (pointInPolygon(p, b)) inBoth += 1;
    }
  }
  return inA === 0 ? 0 : inBoth / inA;
}

// ------------------------------------------------------------- clearances ---

export type Side = 'front' | 'back' | 'left' | 'right';

export interface ClearanceZone {
  side: Side;
  polygon: Pt[];
  depth: number;
}

/**
 * The space an item needs around it to be usable, as world polygons.
 *
 * Each zone is a rectangle projecting outward from one face. Front is -Y in
 * local space, so a sofa's walkway sits in front of the seat and a dresser's
 * drawer-pull zone in front of the drawers, whichever way either is rotated.
 */
export function clearanceZones(placed: PlacedItem, item: LibraryItem): ClearanceZone[] {
  const { w, d } = effectiveSize(placed, item);
  const clear = effectiveClearances(placed, item);
  const hw = w / 2;
  const hd = d / 2;

  const zones: { side: Side; local: Pt[]; depth: number }[] = [];

  if (clear.front > 0) {
    zones.push({
      side: 'front',
      depth: clear.front,
      local: [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: -hd - clear.front },
        { x: -hw, y: -hd - clear.front },
      ],
    });
  }
  if (clear.back > 0) {
    zones.push({
      side: 'back',
      depth: clear.back,
      local: [
        { x: -hw, y: hd },
        { x: hw, y: hd },
        { x: hw, y: hd + clear.back },
        { x: -hw, y: hd + clear.back },
      ],
    });
  }
  if (clear.left > 0) {
    zones.push({
      side: 'left',
      depth: clear.left,
      local: [
        { x: -hw, y: -hd },
        { x: -hw, y: hd },
        { x: -hw - clear.left, y: hd },
        { x: -hw - clear.left, y: -hd },
      ],
    });
  }
  if (clear.right > 0) {
    zones.push({
      side: 'right',
      depth: clear.right,
      local: [
        { x: hw, y: -hd },
        { x: hw, y: hd },
        { x: hw + clear.right, y: hd },
        { x: hw + clear.right, y: -hd },
      ],
    });
  }

  return zones.map((z) => ({ side: z.side, depth: z.depth, polygon: toWorld(z.local, placed) }));
}

/**
 * The arc a door sweeps, as a polygon.
 *
 * A door that opens into the room takes floor space no furniture may occupy,
 * and it's the single most commonly forgotten constraint when arranging a room
 * on paper.
 */
export function doorSwingPolygon(room: Room, opening: Opening, segments = 10): Pt[] {
  if (opening.kind !== 'door' || !opening.swing) return [];
  const wall = room.walls.find((w) => w.id === opening.wallId);
  if (!wall) return [];
  const seg = wallSegment(room, wall);
  if (!seg) return [];

  const total = distance(seg.a, seg.b);
  if (total < EPS) return [];

  const dir = normalize(sub(seg.b, seg.a));
  const start = add(seg.a, vscale(dir, opening.offset));
  const end = add(seg.a, vscale(dir, opening.offset + opening.width));

  const hingeAtA = opening.swing.hinge !== 'b';
  const hinge = hingeAtA ? start : end;
  const closed = hingeAtA ? dir : vscale(dir, -1);

  const inward = wallInwardNormal(room, wall);
  const openSide = opening.swing.into === 'out' ? vscale(inward, -1) : inward;

  // Sweep direction follows the geometry rather than an assumption, the same
  // way the plan-view arc does.
  const clockwise = closed.x * openSide.y - closed.y * openSide.x > 0;
  const sweep = (opening.swing.angle ?? 90) * (clockwise ? 1 : -1);
  const startAngle = angleOf(closed);

  const points: Pt[] = [hinge];
  for (let i = 0; i <= segments; i += 1) {
    const rad = degToRad(startAngle + (sweep * i) / segments);
    points.push({
      x: hinge.x + Math.cos(rad) * opening.width,
      y: hinge.y + Math.sin(rad) * opening.width,
    });
  }
  return points;
}

// -------------------------------------------------------------- conflicts ---

export type ConflictKind = 'overlap' | 'clearance' | 'outside' | 'door';

export interface Conflict {
  kind: ConflictKind;
  /** Placement ids involved. One entry for `outside`, two otherwise. */
  itemIds: string[];
  /** Which item's clearance was blocked, for `clearance`. */
  side?: Side;
  message: string;
}

export interface ConflictOptions {
  /** Skip items whose layer means they can't physically collide. */
  ignoreLayers?: string[];
}

/** Layers that don't occupy floor space in a way that conflicts. */
const NON_COLLIDING = new Set(['rug', 'wall', 'ceiling']);

/**
 * Every problem with the current arrangement.
 *
 * Rugs, wall-mounted pieces, and ceiling fixtures are excluded: a coffee table
 * standing on a rug is the point of a rug, and a picture hangs above the sofa
 * rather than fighting it for floor.
 */
export function findConflicts(
  items: PlacedItem[],
  library: Map<string, LibraryItem>,
  room: Room,
  options: ConflictOptions = {},
): Conflict[] {
  const ignore = new Set([...NON_COLLIDING, ...(options.ignoreLayers ?? [])]);

  const solid = items
    .map((placed) => {
      const item = library.get(placed.libraryId);
      if (!item || ignore.has(placed.layer)) return null;
      return { placed, item, polygon: footprintPolygon(placed, item) };
    })
    .filter((v): v is { placed: PlacedItem; item: LibraryItem; polygon: Pt[] } => v !== null);

  const conflicts: Conflict[] = [];
  const roomRing = roomPolygon(room);

  // 1. Furniture through furniture.
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const a = solid[i]!;
      const b = solid[j]!;
      if (polygonsOverlap(a.polygon, b.polygon)) {
        conflicts.push({
          kind: 'overlap',
          itemIds: [a.placed.id, b.placed.id],
          message: `${a.item.name} overlaps ${b.item.name}`,
        });
      }
    }
  }

  // 2. Furniture outside the walls.
  if (roomRing.length >= 3) {
    for (const entry of solid) {
      const outsideCorners = entry.polygon.filter((p) => !pointInPolygon(p, roomRing)).length;
      if (outsideCorners > 0) {
        conflicts.push({
          kind: 'outside',
          itemIds: [entry.placed.id],
          message:
            outsideCorners === entry.polygon.length
              ? `${entry.item.name} is outside the room`
              : `${entry.item.name} sticks through a wall`,
        });
      }
    }
  }

  /*
    3. Blocked clearances — the check that catches "it fits, but you can't open
       it". Only reported against other furniture, since a clearance zone
       running into a wall is usually deliberate (a sofa's back to the wall).

       Two items too close almost always violate each other reciprocally: a
       coffee table sits inside the sofa's walkway while the sofa sits inside
       the table's reach zone. That's one gap, not two problems, so the pair is
       reported once — keeping whichever side demands more room, since closing
       that one closes both.
  */
  const worstByPair = new Map<string, { conflict: Conflict; depth: number }>();

  for (const entry of solid) {
    for (const zone of clearanceZones(entry.placed, entry.item)) {
      for (const other of solid) {
        if (other.placed.id === entry.placed.id) continue;
        if (!polygonsOverlap(zone.polygon, other.polygon)) continue;

        const key = [entry.placed.id, other.placed.id].sort().join('|');
        const existing = worstByPair.get(key);
        if (existing && existing.depth >= zone.depth) continue;

        worstByPair.set(key, {
          depth: zone.depth,
          conflict: {
            kind: 'clearance',
            itemIds: [entry.placed.id, other.placed.id],
            side: zone.side,
            message: `${other.item.name} blocks the ${zone.side} clearance of ${entry.item.name}`,
          },
        });
      }
    }
  }

  for (const { conflict } of worstByPair.values()) conflicts.push(conflict);

  // 4. Door swings.
  for (const opening of room.openings) {
    const swing = doorSwingPolygon(room, opening);
    if (swing.length < 3) continue;
    for (const entry of solid) {
      if (!polygonsOverlap(swing, entry.polygon)) continue;
      conflicts.push({
        kind: 'door',
        itemIds: [entry.placed.id],
        message: `${entry.item.name} is in the way of a door`,
      });
    }
  }

  return conflicts;
}

/** Placement ids mentioned by any conflict, for highlighting. */
export function conflictedIds(conflicts: Conflict[]): Set<string> {
  const ids = new Set<string>();
  for (const c of conflicts) for (const id of c.itemIds) ids.add(id);
  return ids;
}

// ---------------------------------------------------------------- snapping ---

export interface WallSnap {
  x: number;
  y: number;
  rotation: number;
  wallId: string;
}

/**
 * Rotation that puts an item's back against a wall.
 *
 * Local +Y is the back, and after rotating by θ it points along
 * (−sin θ, cos θ). Setting that equal to the wall's outward normal gives
 * θ = atan2(−outward.x, outward.y), so a sofa dropped near the top wall turns
 * to face into the room rather than into the plaster.
 */
export function rotationForWall(outwardNormal: Pt): number {
  const deg = (Math.atan2(-outwardNormal.x, outwardNormal.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Snap an item flush against the nearest wall, if one is close enough.
 *
 * Returns null when nothing is in range, so the caller can leave the item
 * exactly where the user put it. `toleranceMm` should come from the zoom level
 * — snapping that feels right at arm's length feels magnetic when zoomed out.
 */
export function snapToWall(
  placed: PlacedItem,
  item: LibraryItem,
  room: Room,
  toleranceMm: number,
): WallSnap | null {
  const { d } = effectiveSize(placed, item);
  let best: { snap: WallSnap; distance: number } | null = null;

  for (const wall of room.walls) {
    const seg = wallSegment(room, wall);
    if (!seg) continue;

    const inward = wallInwardNormal(room, wall);
    const outward = vscale(inward, -1);
    const rotation = rotationForWall(outward);

    // Distance from the item's centre to the wall's inner face.
    const along = normalize(sub(seg.b, seg.a));
    const toItem = sub({ x: placed.x, y: placed.y }, seg.a);
    const perpDist = toItem.x * inward.x + toItem.y * inward.y;

    // Where along the wall the item sits, clamped so it can't slide past a corner.
    const wallLen = distance(seg.a, seg.b);
    const t = Math.max(0, Math.min(wallLen, toItem.x * along.x + toItem.y * along.y));

    // Flush means the back face touches the wall: centre sits half a depth in.
    const target = add(add(seg.a, vscale(along, t)), vscale(inward, wall.thickness / 2 + d / 2));
    const gap = Math.abs(perpDist - (wall.thickness / 2 + d / 2));

    if (gap > toleranceMm) continue;
    if (best && gap >= best.distance) continue;

    best = {
      distance: gap,
      snap: { x: Math.round(target.x), y: Math.round(target.y), rotation, wallId: wall.id },
    };
  }

  return best?.snap ?? null;
}

/**
 * Snap flush to another item's edge — sofa against sofa, nightstand to bed.
 * Only considers axis-aligned faces, which is what "push these together" means
 * in practice and avoids nudging a deliberately angled chair.
 */
export function snapToItems(
  placed: PlacedItem,
  item: LibraryItem,
  others: { placed: PlacedItem; item: LibraryItem }[],
  toleranceMm: number,
): { x: number; y: number } | null {
  const self = footprintPolygon(placed, item);
  const selfBounds = boundsOfPoints(self);
  let dx: number | null = null;
  let dy: number | null = null;

  for (const other of others) {
    if (other.placed.id === placed.id) continue;
    const b = boundsOfPoints(footprintPolygon(other.placed, other.item));

    // Only snap when the two actually face each other on the other axis.
    const overlapsY = selfBounds.minY < b.maxY && selfBounds.maxY > b.minY;
    const overlapsX = selfBounds.minX < b.maxX && selfBounds.maxX > b.minX;

    if (overlapsY) {
      for (const [from, to] of [
        [selfBounds.minX, b.maxX],
        [selfBounds.maxX, b.minX],
      ] as const) {
        const delta = to - from;
        if (Math.abs(delta) <= toleranceMm && (dx === null || Math.abs(delta) < Math.abs(dx))) {
          dx = delta;
        }
      }
    }
    if (overlapsX) {
      for (const [from, to] of [
        [selfBounds.minY, b.maxY],
        [selfBounds.maxY, b.minY],
      ] as const) {
        const delta = to - from;
        if (Math.abs(delta) <= toleranceMm && (dy === null || Math.abs(delta) < Math.abs(dy))) {
          dy = delta;
        }
      }
    }
  }

  if (dx === null && dy === null) return null;
  return { x: Math.round(placed.x + (dx ?? 0)), y: Math.round(placed.y + (dy ?? 0)) };
}

function boundsOfPoints(points: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export { boundsOfPoints };

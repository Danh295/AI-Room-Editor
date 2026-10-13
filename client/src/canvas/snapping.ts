import type { LibraryItem, PlacedItem, ProjectSettings, Pt, Room } from '@room/shared';
import {
  closestPointOnSegment,
  distance,
  snapToItems,
  snapToWall,
  wallSegment,
} from '@room/shared';

export type SnapKind = 'free' | 'grid' | 'vertex' | 'ortho' | 'wall';

export interface SnapResult {
  point: Pt;
  kind: SnapKind;
  /** Id of the vertex or wall that was snapped to, when applicable. */
  refId?: string;
}

export interface SnapOptions {
  room: Room;
  gridStep: number;
  snapToGrid: boolean;
  /** Anchor for orthogonal locking — the previous point in a wall chain. */
  from?: Pt | null;
  /** Force the result onto the horizontal or vertical through `from`. */
  ortho?: boolean;
  /** Snap radius in world millimeters. Derive from zoom so it feels constant. */
  toleranceMm: number;
  /** Vertex ids to ignore, e.g. the one currently being dragged. */
  exclude?: Set<string>;
}

function snapToGridPoint(p: Pt, step: number): Pt {
  if (step <= 0) return p;
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/**
 * Constrain a point to the horizontal or vertical through `from`, whichever
 * axis it is already closer to. This is what shift-drag does in every drawing
 * tool, and it's how you get a genuinely square room by hand.
 */
function applyOrtho(p: Pt, from: Pt): Pt {
  const dx = Math.abs(p.x - from.x);
  const dy = Math.abs(p.y - from.y);
  return dx >= dy ? { x: p.x, y: from.y } : { x: from.x, y: p.y };
}

/**
 * Resolve a raw cursor position into the point the user almost certainly meant.
 *
 * Priority is deliberate: an existing vertex beats everything, because
 * closing a loop exactly matters more than staying on the grid. Orthogonal
 * locking comes next since it's an explicit modifier. Grid is the fallback.
 */
export function snapPoint(raw: Pt, options: SnapOptions): SnapResult {
  const { room, gridStep, snapToGrid, from, ortho, toleranceMm, exclude } = options;

  // 1. Existing vertices — exact, so chains actually close.
  let bestVertex: { id: string; point: Pt; d: number } | null = null;
  for (const [id, vertex] of Object.entries(room.vertices)) {
    if (exclude?.has(id)) continue;
    const d = distance(raw, vertex);
    if (d <= toleranceMm && (!bestVertex || d < bestVertex.d)) {
      bestVertex = { id, point: { x: vertex.x, y: vertex.y }, d };
    }
  }
  if (bestVertex) {
    return { point: bestVertex.point, kind: 'vertex', refId: bestVertex.id };
  }

  // 2. Orthogonal lock relative to the chain's previous point.
  if (ortho && from) {
    const locked = applyOrtho(raw, from);
    // Still land on the grid along the free axis, so lengths stay round.
    return {
      point: snapToGrid ? snapToGridPoint(locked, gridStep) : locked,
      kind: 'ortho',
    };
  }

  // 3. Plain grid.
  if (snapToGrid) {
    return { point: snapToGridPoint(raw, gridStep), kind: 'grid' };
  }

  return { point: { ...raw }, kind: 'free' };
}

/**
 * Nearest wall to a point, for dropping doors and windows.
 * Returns the wall, the point on it, and how far along it that is in mm.
 */
export function nearestWall(
  room: Room,
  at: Pt,
  toleranceMm: number,
): { wallId: string; point: Pt; alongMm: number; distance: number } | null {
  let best: { wallId: string; point: Pt; alongMm: number; distance: number } | null = null;

  for (const wall of room.walls) {
    const seg = wallSegment(room, wall);
    if (!seg) continue;
    const hit = closestPointOnSegment(at, seg);
    if (hit.distance > toleranceMm) continue;
    if (best && hit.distance >= best.distance) continue;
    best = {
      wallId: wall.id,
      point: hit.point,
      alongMm: hit.t * distance(seg.a, seg.b),
      distance: hit.distance,
    };
  }

  return best;
}

/** Vertex within tolerance of a point, for grab handles. */
export function vertexAt(room: Room, at: Pt, toleranceMm: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const [id, vertex] of Object.entries(room.vertices)) {
    const d = distance(at, vertex);
    if (d <= toleranceMm && (!best || d < best.d)) best = { id, d };
  }
  return best?.id ?? null;
}

export interface ItemDragOptions {
  room: Room;
  settings: Pick<ProjectSettings, 'snapToWalls' | 'snapToGrid' | 'gridStep'>;
  /** Every other placed piece, paired with its library entry. */
  others: { placed: PlacedItem; item: LibraryItem }[];
  /** Snap radius in world millimeters at the current zoom. */
  toleranceMm: number;
}

/**
 * Where a piece being dragged to (x, y) should actually go.
 *
 * Walls win, then other pieces, then the grid. The grid only rounds an axis
 * that nothing stronger placed: rounding a wall-snapped position would pull
 * the piece off the face it was just put flush against, and an item snap
 * usually lines up one axis only, leaving the other free to follow the grid.
 */
export function snapItemDrag(
  placed: PlacedItem,
  item: LibraryItem,
  x: number,
  y: number,
  { room, settings, others, toleranceMm }: ItemDragOptions,
): { x: number; y: number; rotation: number } {
  let next = { x: Math.round(x), y: Math.round(y), rotation: placed.rotation };
  let snappedX = false;
  let snappedY = false;

  if (settings.snapToWalls) {
    const wallSnap = snapToWall({ ...placed, ...next }, item, room, toleranceMm * 2);
    if (wallSnap) {
      next = { x: wallSnap.x, y: wallSnap.y, rotation: wallSnap.rotation };
      snappedX = snappedY = true;
    } else {
      const itemSnap = snapToItems({ ...placed, ...next }, item, others, toleranceMm * 1.5);
      if (itemSnap) {
        snappedX = itemSnap.x !== next.x;
        snappedY = itemSnap.y !== next.y;
        next = { ...next, ...itemSnap };
      }
    }
  }

  if (settings.snapToGrid && settings.gridStep > 0) {
    const step = settings.gridStep;
    if (!snappedX) next.x = Math.round(next.x / step) * step;
    if (!snappedY) next.y = Math.round(next.y / step) * step;
  }

  return next;
}

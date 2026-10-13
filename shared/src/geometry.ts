/**
 * Plane geometry in world millimeters.
 *
 * Everything here is pure and free of React or Konva, so the placement rules
 * can be tested without driving a canvas. Angles are degrees clockwise from +X,
 * matching the screen-style axes described in types.ts (+Y points down), which
 * means a "clockwise" rotation on screen is a positive angle here.
 */

import type { Pt, Room, Wall } from './types.js';

export const EPS = 1e-6;

// --------------------------------------------------------------- vectors ---

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
/** 2D cross product magnitude — positive when b is clockwise from a on screen. */
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const length = (a: Pt): number => Math.hypot(a.x, a.y);
export const distance = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

export function normalize(a: Pt): Pt {
  const len = length(a);
  return len < EPS ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Rotate 90 degrees clockwise on screen. */
export const perpendicular = (a: Pt): Pt => ({ x: -a.y, y: a.x });

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

export function rotate(p: Pt, degrees: number, about: Pt = { x: 0, y: 0 }): Pt {
  const rad = degToRad(degrees);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const d = sub(p, about);
  return {
    x: about.x + d.x * cos - d.y * sin,
    y: about.y + d.x * sin + d.y * cos,
  };
}

/** Heading of a vector in degrees clockwise from +X, in [0, 360). */
export function angleOf(v: Pt): number {
  const deg = radToDeg(Math.atan2(v.y, v.x));
  return (deg + 360) % 360;
}

/** Smallest absolute difference between two headings, in [0, 180]. */
export function angleDelta(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * True when two headings describe the same line, ignoring direction.
 * A wall running east and one running west are parallel by this test.
 */
export function isParallel(a: number, b: number, toleranceDeg = 1): boolean {
  const d = angleDelta(a, b);
  return d <= toleranceDeg || Math.abs(d - 180) <= toleranceDeg;
}

export function isPerpendicular(a: number, b: number, toleranceDeg = 1): boolean {
  return Math.abs(angleDelta(a, b) - 90) <= toleranceDeg;
}

// -------------------------------------------------------------- segments ---

export interface Segment {
  a: Pt;
  b: Pt;
}

/**
 * Closest point on segment `s` to `p`, and how far along the segment it sits.
 * `t` is clamped to [0,1], so the result is always on the segment itself.
 */
export function closestPointOnSegment(
  p: Pt,
  s: Segment,
): { point: Pt; t: number; distance: number } {
  const ab = sub(s.b, s.a);
  const lenSq = dot(ab, ab);
  if (lenSq < EPS) {
    return { point: { ...s.a }, t: 0, distance: distance(p, s.a) };
  }
  const t = Math.max(0, Math.min(1, dot(sub(p, s.a), ab) / lenSq));
  const point = add(s.a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}

export function pointToSegmentDistance(p: Pt, s: Segment): number {
  return closestPointOnSegment(p, s).distance;
}

/**
 * Intersection of two infinite lines through the given segments, or null when
 * they're parallel. Used to trim wall centerlines into mitred corners.
 */
export function lineIntersection(s1: Segment, s2: Segment): Pt | null {
  const d1 = sub(s1.b, s1.a);
  const d2 = sub(s2.b, s2.a);
  const denom = cross(d1, d2);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(s2.a, s1.a), d2) / denom;
  return add(s1.a, scale(d1, t));
}

// -------------------------------------------------------------- polygons ---

/**
 * Signed area. Positive means clockwise on screen (+Y down), which is the
 * opposite of the usual math convention — worth remembering when deciding
 * which side of a wall is "inside".
 */
export function signedArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

export const polygonArea = (points: Pt[]): number => Math.abs(signedArea(points));

export function polygonCentroid(points: Pt[]): Pt {
  const area = signedArea(points);
  if (Math.abs(area) < EPS) {
    // Degenerate ring — fall back to the average of the vertices so callers
    // still get a usable anchor point instead of NaN.
    if (points.length === 0) return { x: 0, y: 0 };
    const sum = points.reduce(add, { x: 0, y: 0 });
    return scale(sum, 1 / points.length);
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const w = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Ray-casting containment test; points exactly on an edge are unspecified. */
export function pointInPolygon(p: Pt, points: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!;
    const b = points[j]!;
    const straddles = a.y > p.y !== b.y > p.y;
    if (!straddles) continue;
    const xAtP = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (p.x < xAtP) inside = !inside;
  }
  return inside;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Pt[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export const boundsWidth = (b: Bounds): number => b.maxX - b.minX;
export const boundsHeight = (b: Bounds): number => b.maxY - b.minY;

export function expandBounds(b: Bounds, by: number): Bounds {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}

// ----------------------------------------------------------------- rooms ---

/**
 * Endpoints of a wall in world space, or null when a vertex is missing.
 *
 * Returns copies, not references into `room.vertices`. Handing out live
 * references means a caller that moves a vertex silently mutates the segment it
 * captured beforehand — which is exactly how setWallLength once ended up
 * comparing a wall against its own post-move geometry.
 */
export function wallSegment(room: Room, wall: Wall): Segment | null {
  const a = room.vertices[wall.a];
  const b = room.vertices[wall.b];
  if (!a || !b) return null;
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

export function wallLength(room: Room, wall: Wall): number {
  const seg = wallSegment(room, wall);
  return seg ? distance(seg.a, seg.b) : 0;
}

export function wallAngle(room: Room, wall: Wall): number {
  const seg = wallSegment(room, wall);
  return seg ? angleOf(sub(seg.b, seg.a)) : 0;
}

/**
 * Walk the wall list as a connected loop and return the vertices in order.
 *
 * Falls back to insertion order when the walls don't form a single closed
 * chain, so a half-drawn room still yields something renderable rather than
 * throwing.
 */
export function roomPolygon(room: Room): Pt[] {
  if (room.walls.length === 0) return [];

  const byStart = new Map<string, Wall>();
  for (const wall of room.walls) byStart.set(wall.a, wall);

  const start = room.walls[0]!.a;
  const order: string[] = [];
  const seen = new Set<string>();

  let current: string | undefined = start;
  while (current && !seen.has(current)) {
    seen.add(current);
    order.push(current);
    current = byStart.get(current)?.b;
  }

  // Not a single closed loop — use whatever vertices exist, in wall order.
  if (current !== start || order.length !== room.walls.length) {
    const fallback: Pt[] = [];
    const added = new Set<string>();
    for (const wall of room.walls) {
      for (const id of [wall.a, wall.b]) {
        if (added.has(id)) continue;
        const v = room.vertices[id];
        if (v) {
          fallback.push(v);
          added.add(id);
        }
      }
    }
    return fallback;
  }

  return order.map((id) => room.vertices[id]).filter((v): v is Pt => Boolean(v));
}

/**
 * Area enclosed by the wall centrelines, in square millimetres.
 *
 * This is not the floor you can stand on: walls are centred on their
 * vertices, so half of each one sits inside this outline. Use `interiorArea`
 * for anything shown to the user.
 */
export function roomArea(room: Room): number {
  return polygonArea(roomPolygon(room));
}

// ------------------------------------------------------------ inside faces ---
//
// Walls are stored on their centrelines, and everything that draws or snaps to
// them works from there. People measure rooms the other way, with a tape
// against the inside faces, so every size a user types or reads is converted
// at that edge: these functions turn centrelines into inside faces and back.

/** The walls in loop order when they form one closed chain, or null. */
function wallLoop(room: Room): Wall[] | null {
  if (room.walls.length < 3) return null;
  const byStart = new Map<string, Wall>();
  for (const wall of room.walls) byStart.set(wall.a, wall);

  const first = room.walls[0]!;
  const loop: Wall[] = [];
  let wall: Wall | undefined = first;
  while (wall && loop.length <= room.walls.length) {
    loop.push(wall);
    wall = byStart.get(wall.b);
    if (wall === first) break;
  }
  return wall === first && loop.length === room.walls.length ? loop : null;
}

/**
 * Shift each edge of a closed polygon sideways and re-join the edges at mitred
 * corners. `offsets[i]` moves edge i (from point i to point i+1) toward the
 * inside when positive and outward when negative, whichever way the polygon
 * winds. Where two neighbouring edges are parallel (a wall split in two) the
 * corner just moves along its edge's normal.
 */
export function offsetPolygon(points: Pt[], offsets: number[]): Pt[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ ...p }));

  // Positive signed area is clockwise on screen, where the inside of an edge
  // is on its `perpendicular` side.
  const inwardSign = signedArea(points) >= 0 ? 1 : -1;
  const shifted: Segment[] = points.map((a, i) => {
    const b = points[(i + 1) % n]!;
    const normal = scale(perpendicular(normalize(sub(b, a))), inwardSign * (offsets[i] ?? 0));
    return { a: add(a, normal), b: add(b, normal) };
  });

  return points.map((_, i) => {
    const prev = shifted[(i - 1 + n) % n]!;
    const cur = shifted[i]!;
    return lineIntersection(prev, cur) ?? { ...cur.a };
  });
}

/**
 * The inside faces of the walls as a polygon: the floor you can actually use.
 * `slack` grows it outward by that many millimetres, for containment tests
 * that shouldn't flag something sitting exactly on a face. Falls back to the
 * centreline outline when the walls don't close into a loop.
 */
export function interiorPolygon(room: Room, slack = 0): Pt[] {
  return facePolygon(room, (w) => w.thickness / 2 - slack);
}

/** The outside faces of the walls: the room's full footprint on the plan. */
export function exteriorPolygon(room: Room): Pt[] {
  return facePolygon(room, (w) => -w.thickness / 2);
}

function facePolygon(room: Room, inset: (wall: Wall) => number): Pt[] {
  const loop = wallLoop(room);
  if (!loop) return roomPolygon(room);
  const points = loop.map((w) => room.vertices[w.a]);
  if (points.some((p) => !p)) return roomPolygon(room);
  return offsetPolygon(points as Pt[], loop.map(inset));
}

/** Usable floor area inside the walls, in square millimetres. */
export function interiorArea(room: Room): number {
  return polygonArea(interiorPolygon(room));
}

/**
 * Every wall's inside face, from its `a` end to its `b` end, computed in one
 * pass. A wall that isn't part of a closed loop has no inside yet, so it gets
 * its centreline. Use this when drawing all walls; it builds the inset
 * polygon once rather than once per wall.
 */
export function interiorWallSegments(room: Room): Map<string, Segment> {
  const faces = new Map<string, Segment>();
  const loop = wallLoop(room);
  const inner = loop ? interiorPolygon(room) : [];
  loop?.forEach((wall, i) => {
    faces.set(wall.id, { a: inner[i]!, b: inner[(i + 1) % inner.length]! });
  });
  for (const wall of room.walls) {
    if (faces.has(wall.id)) continue;
    const seg = wallSegment(room, wall);
    if (seg) faces.set(wall.id, seg);
  }
  return faces;
}

/** One wall's inside face; see `interiorWallSegments`. */
export function interiorWallSegment(room: Room, wall: Wall): Segment | null {
  return interiorWallSegments(room).get(wall.id) ?? null;
}

/**
 * The stretch of a wall's centreline, measured from its `a` end, that lies
 * between the inside faces of the walls at either end. An opening has to fit
 * here: anything nearer the ends is buried in the neighbouring wall.
 */
export function interiorSpan(
  room: Room,
  wall: Wall,
  faces: Map<string, Segment> = interiorWallSegments(room),
): { start: number; end: number } {
  const seg = wallSegment(room, wall);
  if (!seg) return { start: 0, end: 0 };
  const len = distance(seg.a, seg.b);
  const face = faces.get(wall.id);
  if (!face || len < EPS) return { start: 0, end: len };
  const dir = normalize(sub(seg.b, seg.a));
  const along = (p: Pt) => dot(sub(p, seg.a), dir);
  const start = Math.max(0, Math.min(len, along(face.a)));
  const end = Math.max(start, Math.min(len, along(face.b)));
  return { start, end };
}

/** Length of a wall's inside face: what a tape measure along it reads. */
export function interiorWallLength(room: Room, wall: Wall): number {
  const seg = interiorWallSegment(room, wall);
  return seg ? distance(seg.a, seg.b) : 0;
}

/**
 * Centreline corners for walls of `thickness` whose inside faces meet at
 * `points`: the inverse of `interiorPolygon`, for building a room from sizes
 * someone measured or typed.
 */
export function centrelineFromInterior(points: Pt[], thickness: number): Pt[] {
  return offsetPolygon(
    points,
    points.map(() => -thickness / 2),
  );
}

/**
 * Which side of a wall faces into the room, as a unit vector.
 *
 * Computed by testing whether stepping off the wall's midpoint along its
 * normal lands inside the room polygon, so it stays correct regardless of
 * which way the wall loop was wound.
 */
export function wallInwardNormal(room: Room, wall: Wall): Pt {
  const seg = wallSegment(room, wall);
  if (!seg) return { x: 0, y: 0 };

  const dir = normalize(sub(seg.b, seg.a));
  const normal = perpendicular(dir);
  const mid = scale(add(seg.a, seg.b), 0.5);
  const polygon = roomPolygon(room);
  if (polygon.length < 3) return normal;

  const probe = add(mid, scale(normal, 1));
  return pointInPolygon(probe, polygon) ? normal : scale(normal, -1);
}

/**
 * Position of an opening's midpoint along its wall.
 * `offset` is measured from the wall's `a` end to the opening's near edge.
 */
export function openingMidpoint(
  room: Room,
  wallId: string,
  offset: number,
  width: number,
): Pt | null {
  const wall = room.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const seg = wallSegment(room, wall);
  if (!seg) return null;

  const total = distance(seg.a, seg.b);
  if (total < EPS) return { ...seg.a };

  const dir = normalize(sub(seg.b, seg.a));
  return add(seg.a, scale(dir, offset + width / 2));
}

/** Clamp an opening so it stays entirely on its wall. */
export function clampOpening(wallLen: number, offset: number, width: number): number {
  const maxOffset = Math.max(0, wallLen - width);
  return Math.max(0, Math.min(maxOffset, offset));
}

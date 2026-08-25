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
export function closestPointOnSegment(p: Pt, s: Segment): { point: Pt; t: number; distance: number } {
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

/** Interior floor area of the room in square millimeters. */
export function roomArea(room: Room): number {
  return polygonArea(roomPolygon(room));
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
export function openingMidpoint(room: Room, wallId: string, offset: number, width: number): Pt | null {
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

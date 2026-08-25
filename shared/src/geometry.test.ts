import { describe, it, expect } from 'vitest';
import {
  angleOf,
  angleDelta,
  isParallel,
  isPerpendicular,
  rotate,
  normalize,
  closestPointOnSegment,
  pointToSegmentDistance,
  lineIntersection,
  signedArea,
  polygonArea,
  polygonCentroid,
  pointInPolygon,
  boundsOf,
  roomPolygon,
  roomArea,
  wallLength,
  wallAngle,
  wallInwardNormal,
  openingMidpoint,
  clampOpening,
} from './geometry.js';
import { rectangularRoom, lShapedRoom, emptyRoom } from './factory.js';
import { MM_PER_FOOT } from './units.js';

const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('angles', () => {
  // +Y is down, so a positive angle sweeps clockwise on screen.
  it('measures headings clockwise from +X', () => {
    expect(angleOf({ x: 1, y: 0 })).toBe(0);
    expect(angleOf({ x: 0, y: 1 })).toBe(90);
    expect(angleOf({ x: -1, y: 0 })).toBe(180);
    expect(angleOf({ x: 0, y: -1 })).toBe(270);
  });

  it('wraps into [0, 360)', () => {
    expect(angleOf({ x: 1, y: -0.0001 })).toBeGreaterThan(180);
    expect(angleOf({ x: 1, y: -0.0001 })).toBeLessThan(360);
  });

  it('takes the short way round when comparing headings', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(20);
    expect(angleDelta(0, 180)).toBe(180);
  });

  it('treats opposite directions as parallel', () => {
    expect(isParallel(0, 180)).toBe(true);
    expect(isParallel(90, 270)).toBe(true);
    expect(isParallel(0, 90)).toBe(false);
  });

  it('detects perpendicular headings in either order', () => {
    expect(isPerpendicular(0, 90)).toBe(true);
    expect(isPerpendicular(90, 180)).toBe(true);
    expect(isPerpendicular(0, 45)).toBe(false);
  });

  it('rotates clockwise about a point', () => {
    const r = rotate({ x: 1, y: 0 }, 90);
    near(r.x, 0);
    near(r.y, 1);

    const about = rotate({ x: 2, y: 1 }, 180, { x: 1, y: 1 });
    near(about.x, 0);
    near(about.y, 1);
  });

  it('normalizes a zero vector to zero rather than NaN', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('segments', () => {
  const seg = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };

  it('finds the perpendicular foot when it lies on the segment', () => {
    const r = closestPointOnSegment({ x: 4, y: 3 }, seg);
    expect(r.point).toEqual({ x: 4, y: 0 });
    near(r.t, 0.4);
    near(r.distance, 3);
  });

  it('clamps past the ends instead of running off the line', () => {
    expect(closestPointOnSegment({ x: -5, y: 0 }, seg).point).toEqual({ x: 0, y: 0 });
    expect(closestPointOnSegment({ x: 50, y: 0 }, seg).point).toEqual({ x: 10, y: 0 });
    expect(pointToSegmentDistance({ x: -5, y: 0 }, seg)).toBe(5);
  });

  it('handles a degenerate zero-length segment', () => {
    const point = { a: { x: 3, y: 3 }, b: { x: 3, y: 3 } };
    const r = closestPointOnSegment({ x: 0, y: 0 }, point);
    expect(r.point).toEqual({ x: 3, y: 3 });
    near(r.distance, Math.hypot(3, 3));
  });

  it('intersects two crossing lines', () => {
    const hit = lineIntersection(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 4, y: -5 }, b: { x: 4, y: 5 } },
    );
    expect(hit).toEqual({ x: 4, y: 0 });
  });

  it('extends beyond the given segments, since the lines are infinite', () => {
    const hit = lineIntersection(
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { a: { x: 40, y: -5 }, b: { x: 40, y: 5 } },
    );
    expect(hit).toEqual({ x: 40, y: 0 });
  });

  it('returns null for parallel lines', () => {
    expect(
      lineIntersection(
        { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
        { a: { x: 0, y: 5 }, b: { x: 10, y: 5 } },
      ),
    ).toBeNull();
  });
});

describe('polygons', () => {
  // Clockwise on screen with +Y down.
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('reports positive signed area for a screen-clockwise ring', () => {
    expect(signedArea(square)).toBeGreaterThan(0);
    expect(signedArea([...square].reverse())).toBeLessThan(0);
  });

  it('measures area regardless of winding', () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
  });

  it('finds the centroid of a square', () => {
    const c = polygonCentroid(square);
    near(c.x, 5);
    near(c.y, 5);
  });

  it('falls back to the vertex average for a degenerate ring', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const c = polygonCentroid(collinear);
    expect(Number.isFinite(c.x)).toBe(true);
    expect(Number.isFinite(c.y)).toBe(true);
    near(c.x, 5);
  });

  it('returns origin for an empty ring rather than NaN', () => {
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
  });

  it('tests containment', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: -1 }, square)).toBe(false);
  });

  it('handles a concave shape where a bounding box would not', () => {
    // An L: the notch corner is inside the bbox but outside the polygon.
    const L = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, L)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, L)).toBe(false);
  });

  it('computes bounds, and null for no points', () => {
    expect(boundsOf(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(boundsOf([])).toBeNull();
  });
});

describe('rooms', () => {
  it('walks a closed wall loop into an ordered polygon', () => {
    const room = rectangularRoom(4000, 3000);
    const poly = roomPolygon(room);
    expect(poly).toHaveLength(4);
    expect(polygonArea(poly)).toBe(4000 * 3000);
  });

  it('orders an L-shaped room correctly', () => {
    // 5000x4000 with a 2000x1500 notch removed.
    const room = lShapedRoom(5000, 4000, 2000, 1500);
    expect(roomPolygon(room)).toHaveLength(6);
    expect(roomArea(room)).toBe(5000 * 4000 - 2000 * 1500);
  });

  it('returns nothing for a room with no walls', () => {
    expect(roomPolygon(emptyRoom())).toEqual([]);
    expect(roomArea(emptyRoom())).toBe(0);
  });

  it('degrades to insertion order for a broken chain instead of throwing', () => {
    const room = rectangularRoom(4000, 3000);
    room.walls.pop(); // leave the loop open
    const poly = roomPolygon(room);
    expect(poly.length).toBeGreaterThan(0);
    expect(poly.every((p) => Number.isFinite(p.x))).toBe(true);
  });

  it('measures wall lengths and headings', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;
    expect(wallLength(room, top)).toBe(4000);
    expect(wallAngle(room, top)).toBe(0);

    const right = room.walls[1]!;
    expect(wallLength(room, right)).toBe(3000);
    expect(wallAngle(room, right)).toBe(90);
  });

  it('points wall normals into the room', () => {
    const room = rectangularRoom(4000, 3000);
    // Top wall runs left-to-right along y=0; inside is below it (+Y).
    const inward = wallInwardNormal(room, room.walls[0]!);
    expect(inward.y).toBeGreaterThan(0);
    near(inward.x, 0);

    // Bottom wall runs right-to-left along y=3000; inside is above it (-Y).
    const bottom = wallInwardNormal(room, room.walls[2]!);
    expect(bottom.y).toBeLessThan(0);
  });

  it('points normals inward even when the loop is wound the other way', () => {
    const room = rectangularRoom(4000, 3000);
    const reversed = {
      ...room,
      walls: [...room.walls].reverse().map((w) => ({ ...w, a: w.b, b: w.a })),
    };
    for (const wall of reversed.walls) {
      const n = wallInwardNormal(reversed, wall);
      expect(Math.hypot(n.x, n.y)).toBeGreaterThan(0.5);
    }
  });
});

describe('openings', () => {
  const room = rectangularRoom(4000, 3000);
  const top = room.walls[0]!;

  it('places an opening midpoint along the wall', () => {
    const mid = openingMidpoint(room, top.id, 1000, 900);
    expect(mid).toEqual({ x: 1450, y: 0 });
  });

  it('returns null for an unknown wall', () => {
    expect(openingMidpoint(room, 'nope', 0, 900)).toBeNull();
  });

  it('clamps an opening to stay on its wall', () => {
    expect(clampOpening(4000, -500, 900)).toBe(0);
    expect(clampOpening(4000, 9999, 900)).toBe(3100);
    expect(clampOpening(4000, 1000, 900)).toBe(1000);
  });

  it('clamps to zero when the opening is wider than the wall', () => {
    expect(clampOpening(800, 100, 900)).toBe(0);
  });
});

describe('real-world sanity', () => {
  it('measures a 12x10 foot room in square feet', () => {
    const room = rectangularRoom(12 * MM_PER_FOOT, 10 * MM_PER_FOOT);
    const sqft = roomArea(room) / (MM_PER_FOOT * MM_PER_FOOT);
    expect(Math.round(sqft)).toBe(120);
  });
});

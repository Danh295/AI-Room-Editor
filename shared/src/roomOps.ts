/**
 * Editing operations on a Room.
 *
 * These mutate the room in place so they can be called directly inside an immer
 * recipe. They're still pure with respect to anything outside the room they're
 * handed, which keeps them testable without a store.
 */

import type { Opening, OpeningKind, Room, Wall } from './types.js';
import { newId } from './factory.js';
import {
  add,
  angleOf,
  clampOpening,
  closestPointOnSegment,
  distance,
  isPerpendicular,
  normalize,
  scale,
  sub,
  interiorSpan,
  interiorWallLength,
  wallLength,
  wallSegment,
} from './geometry.js';

/** Round a point to whole millimeters, keeping the stored model integral. */
function snapInt(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export function findWall(room: Room, wallId: string): Wall | undefined {
  return room.walls.find((w) => w.id === wallId);
}

/** Walls that touch a vertex, as either endpoint. */
export function wallsAtVertex(room: Room, vertexId: string): Wall[] {
  return room.walls.filter((w) => w.a === vertexId || w.b === vertexId);
}

/**
 * Pull each opening on these walls back onto its wall.
 *
 * Every way a wall gets shorter — typing a length, dragging a corner,
 * splitting it — would otherwise leave a door hanging past the end, drawn and
 * collision-checked outside the room. Call it once a move is finished, not
 * per frame of a drag. The offset is clamped first; the width
 * only shrinks when the wall itself has become narrower than the opening.
 */
export function refitOpenings(room: Room, wallIds: Iterable<string>): void {
  const ids = new Set(wallIds);
  for (const opening of room.openings) {
    if (!ids.has(opening.wallId)) continue;
    const wall = findWall(room, opening.wallId);
    if (!wall) continue;
    Object.assign(opening, fitOnWall(room, wall, opening.offset, opening.width));
  }
}

/**
 * Where an opening of this width can sit on this wall: between the inside
 * faces of the walls at each end, since nearer the ends it would be buried in
 * the neighbouring wall. Offsets stay measured from the centreline's `a` end.
 */
function fitOnWall(
  room: Room,
  wall: Wall,
  offset: number,
  width: number,
): { offset: number; width: number } {
  const { start, end } = interiorSpan(room, wall);
  const fitted = Math.round(Math.min(width, end - start));
  const clamped = start + clampOpening(end - start, offset - start, fitted);
  return { offset: Math.round(clamped), width: fitted };
}

/**
 * Move a vertex to an absolute position. Every attached wall follows.
 *
 * Openings are deliberately left alone: a corner drag calls this once per
 * frame on the live room, and refitting each frame would ratchet — drag past a
 * window and back, and it would stay narrowed. Whoever finishes the move calls
 * `refitOpenings` once: `setWallLength` does, and so does the end of a drag.
 */
export function moveVertex(room: Room, vertexId: string, to: { x: number; y: number }): void {
  const vertex = room.vertices[vertexId];
  if (!vertex) return;
  const snapped = snapInt(to);
  vertex.x = snapped.x;
  vertex.y = snapped.y;
}

export function translateVertex(
  room: Room,
  vertexId: string,
  by: { x: number; y: number },
): void {
  const vertex = room.vertices[vertexId];
  if (!vertex) return;
  moveVertex(room, vertexId, add(vertex, by));
}

/**
 * Set a wall's length by moving its `b` endpoint along the wall's own direction.
 *
 * The subtlety is what happens to the rest of the room. Moving only `b` turns a
 * rectangle into a trapezoid: the neighbouring wall was perpendicular, and now
 * it's diagonal. That is almost never what someone typing "12'4"" into a wall
 * means.
 *
 * So the rule is: move `b`, and if the next wall leaving `b` is perpendicular to
 * this one, carry its far endpoint along by the same delta. On a rectangle that
 * slides the entire opposite side across and the room stays rectangular. On an
 * L-shape it moves the one leg. When the next wall is collinear instead, only
 * `b` moves, which correctly re-splits a straight run.
 *
 * Propagation stops after one wall on purpose — carrying further would drag the
 * whole loop and change nothing about the shape.
 */
export function setWallLength(room: Room, wallId: string, newLength: number): boolean {
  const wall = findWall(room, wallId);
  if (!wall || newLength <= 0) return false;

  const seg = wallSegment(room, wall);
  if (!seg) return false;

  const currentLength = distance(seg.a, seg.b);
  if (currentLength < 1e-6) return false;

  const dir = normalize(sub(seg.b, seg.a));
  const target = add(seg.a, scale(dir, newLength));
  const delta = sub(target, seg.b);
  if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return false;

  const thisAngle = angleOf(sub(seg.b, seg.a));

  // Decide about the neighbour using the geometry as it is *now*, before
  // anything moves. Reading it afterwards would compare the next wall against
  // the endpoint's new position and conclude it was never perpendicular.
  const nextWall = room.walls.find((w) => w.id !== wall.id && w.a === wall.b);
  const nextFar = nextWall ? room.vertices[nextWall.b] : undefined;
  const carryNeighbour =
    nextWall !== undefined &&
    nextFar !== undefined &&
    isPerpendicular(thisAngle, angleOf(sub(nextFar, seg.b)), 2);

  moveVertex(room, wall.b, target);
  const moved = [wall.b];
  if (carryNeighbour && nextWall) {
    translateVertex(room, nextWall.b, delta);
    moved.push(nextWall.b);
  }
  refitOpenings(
    room,
    moved.flatMap((id) => wallsAtVertex(room, id).map((w) => w.id)),
  );

  return true;
}

/**
 * Set the length of a wall's inside face, the length a tape measure reads.
 *
 * Moving the end by the same amount moves the inside face by the same amount,
 * as long as the neighbouring walls keep their angles, so the target is just
 * shifted by the wall's current centreline-minus-inside difference.
 */
export function setInteriorWallLength(room: Room, wallId: string, newLength: number): boolean {
  const wall = findWall(room, wallId);
  if (!wall || newLength <= 0) return false;
  // Exact in one step when the neighbours are square to this wall. At any
  // other angle the neighbouring wall pivots and the inside corner moves a
  // little more or less than the end did, so correct by what's left over.
  let changed = false;
  for (let i = 0; i < 4; i += 1) {
    const error = newLength - interiorWallLength(room, wall);
    if (Math.abs(error) < 0.5) break;
    if (!setWallLength(room, wallId, wallLength(room, wall) + error)) break;
    changed = true;
  }
  return changed;
}

/**
 * Append a wall from the room's current open end to a new point.
 * Returns the id of the vertex created.
 */
export function appendWall(
  room: Room,
  fromVertexId: string,
  to: { x: number; y: number },
  thickness: number,
): string {
  const id = newId('v');
  room.vertices[id] = snapInt(to);
  room.walls.push({ id: newId('w'), a: fromVertexId, b: id, thickness });
  return id;
}

/** Start a new wall chain at a point, returning the seed vertex id. */
export function startChain(room: Room, at: { x: number; y: number }): string {
  const id = newId('v');
  room.vertices[id] = snapInt(at);
  return id;
}

/** Close a chain by connecting its last vertex back to its first. */
export function closeChain(
  room: Room,
  lastVertexId: string,
  firstVertexId: string,
  thickness: number,
): void {
  if (lastVertexId === firstVertexId) return;
  const exists = room.walls.some(
    (w) =>
      (w.a === lastVertexId && w.b === firstVertexId) ||
      (w.a === firstVertexId && w.b === lastVertexId),
  );
  if (exists) return;
  room.walls.push({ id: newId('w'), a: lastVertexId, b: firstVertexId, thickness });
}

/**
 * Remove a wall, and any vertex that becomes orphaned as a result.
 * Openings on that wall go with it — they have nowhere to live otherwise.
 */
export function deleteWall(room: Room, wallId: string): void {
  const wall = findWall(room, wallId);
  if (!wall) return;

  room.walls = room.walls.filter((w) => w.id !== wallId);
  room.openings = room.openings.filter((o) => o.wallId !== wallId);

  for (const vertexId of [wall.a, wall.b]) {
    if (wallsAtVertex(room, vertexId).length === 0) {
      delete room.vertices[vertexId];
    }
  }
}

/**
 * Split a wall at a point along it, inserting a vertex.
 * Openings are reassigned to whichever half holds their centre.
 */
export function splitWall(
  room: Room,
  wallId: string,
  at: { x: number; y: number },
): string | null {
  const wall = findWall(room, wallId);
  if (!wall) return null;
  const seg = wallSegment(room, wall);
  if (!seg) return null;

  const { point, t } = closestPointOnSegment(at, seg);
  if (t <= 0.001 || t >= 0.999) return null; // too close to an existing end

  const totalLength = distance(seg.a, seg.b);
  const splitAt = totalLength * t;

  const midId = newId('v');
  room.vertices[midId] = snapInt(point);

  const originalB = wall.b;
  wall.b = midId;
  const secondHalf: Wall = {
    id: newId('w'),
    a: midId,
    b: originalB,
    thickness: wall.thickness,
  };

  const index = room.walls.findIndex((w) => w.id === wallId);
  room.walls.splice(index + 1, 0, secondHalf);

  // Each opening goes to the half holding its centre, then both halves are
  // refitted so one that straddled the split doesn't hang past either end.
  for (const opening of room.openings) {
    if (opening.wallId !== wallId) continue;
    if (opening.offset + opening.width / 2 >= splitAt) {
      opening.wallId = secondHalf.id;
      opening.offset -= splitAt;
    }
  }
  refitOpenings(room, [wall.id, secondHalf.id]);

  return midId;
}

// --------------------------------------------------------------- openings ---

export interface AddOpeningOptions {
  kind: OpeningKind;
  /** Distance from the wall's `a` end to the opening's near edge. */
  offset: number;
  width: number;
  height?: number;
  sillHeight?: number;
}

export function addOpening(
  room: Room,
  wallId: string,
  options: AddOpeningOptions,
): Opening | null {
  const wall = findWall(room, wallId);
  if (!wall) return null;
  if (!wallSegment(room, wall)) return null;

  const { start, end } = interiorSpan(room, wall);
  if (options.width >= end - start) return null; // wouldn't leave any wall behind
  const fitted = fitOnWall(room, wall, options.offset, options.width);

  const opening: Opening = {
    id: newId('op'),
    wallId,
    offset: fitted.offset,
    width: fitted.width,
    kind: options.kind,
    height: options.height,
    sillHeight: options.sillHeight,
    ...(options.kind === 'door'
      ? { swing: { hinge: 'a' as const, into: 'in' as const, angle: 90 } }
      : {}),
  };

  room.openings.push(opening);
  return opening;
}

/** Slide an opening along its wall, clamped to stay fully on it. */
export function moveOpening(room: Room, openingId: string, offset: number): void {
  const opening = room.openings.find((o) => o.id === openingId);
  if (!opening) return;
  const wall = findWall(room, opening.wallId);
  if (!wall) return;
  opening.offset = fitOnWall(room, wall, offset, opening.width).offset;
}

export function resizeOpening(room: Room, openingId: string, width: number): void {
  const opening = room.openings.find((o) => o.id === openingId);
  if (!opening || width <= 0) return;
  const wall = findWall(room, opening.wallId);
  if (!wall) return;
  Object.assign(opening, fitOnWall(room, wall, opening.offset, width));
}

export function deleteOpening(room: Room, openingId: string): void {
  room.openings = room.openings.filter((o) => o.id !== openingId);
}

/**
 * Drop an opening onto whichever wall is nearest a world point.
 * Returns null when nothing is within `maxDistance`.
 */
export function addOpeningNearPoint(
  room: Room,
  at: { x: number; y: number },
  options: Omit<AddOpeningOptions, 'offset'>,
  maxDistance: number,
): Opening | null {
  let best: { wall: Wall; offset: number; distance: number } | null = null;

  for (const wall of room.walls) {
    const seg = wallSegment(room, wall);
    if (!seg) continue;
    const hit = closestPointOnSegment(at, seg);
    if (hit.distance > maxDistance) continue;
    const offsetToCentre = hit.t * distance(seg.a, seg.b);
    if (!best || hit.distance < best.distance) {
      best = { wall, offset: offsetToCentre - options.width / 2, distance: hit.distance };
    }
  }

  if (!best) return null;
  return addOpening(room, best.wall.id, { ...options, offset: Math.round(best.offset) });
}

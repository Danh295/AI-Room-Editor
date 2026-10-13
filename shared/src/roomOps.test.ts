import { describe, it, expect } from 'vitest';
import {
  setWallLength,
  moveVertex,
  deleteWall,
  splitWall,
  addOpening,
  moveOpening,
  resizeOpening,
  deleteOpening,
  addOpeningNearPoint,
  appendWall,
  startChain,
  closeChain,
  wallsAtVertex,
  setInteriorWallLength,
  refitOpenings,
} from './roomOps.js';
import { rectangularRoom, lShapedRoom, emptyRoom, roomFromPolygon } from './factory.js';
import {
  roomPolygon,
  roomArea,
  wallLength,
  wallAngle,
  polygonArea,
  interiorWallLength,
  interiorArea,
  interiorSpan,
} from './geometry.js';
import { MM_PER_FOOT } from './units.js';

describe('setWallLength', () => {
  it('keeps a rectangle rectangular by carrying the perpendicular neighbour', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;

    expect(setWallLength(room, top.id, 5000)).toBe(true);

    expect(wallLength(room, top)).toBe(5000);
    // The whole right side moved across; the room is still a rectangle.
    expect(roomArea(room)).toBe(5000 * 3000);
    // Every wall is still axis-aligned — no wall went diagonal.
    for (const wall of room.walls) {
      const offAxis = wallAngle(room, wall) % 90;
      expect(Math.min(offAxis, 90 - offAxis)).toBeLessThan(0.01);
    }
  });

  it('shortens as well as lengthens', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;
    setWallLength(room, top.id, 2500);
    expect(wallLength(room, top)).toBe(2500);
    expect(roomArea(room)).toBe(2500 * 3000);
  });

  it('sets a wall to an exact imperial length', () => {
    const room = rectangularRoom(4000, 3000);
    const target = Math.round(12 * MM_PER_FOOT + 4 * (MM_PER_FOOT / 12)); // 12'4"
    setWallLength(room, room.walls[0]!.id, target);
    expect(wallLength(room, room.walls[0]!)).toBe(target);
    expect(target).toBe(3759);
  });

  it('resizes one leg of an L-shaped room without distorting the rest', () => {
    const room = lShapedRoom(5000, 4000, 2000, 1500);
    const before = roomPolygon(room).length;

    expect(setWallLength(room, room.walls[0]!.id, 6000)).toBe(true);

    expect(roomPolygon(room)).toHaveLength(before);
    expect(wallLength(room, room.walls[0]!)).toBe(6000);
  });

  it('moves only the endpoint when the next wall is collinear', () => {
    // A straight run split in two: v0 -> v1 -> v2, all along y=0.
    const room = emptyRoom();
    const v0 = startChain(room, { x: 0, y: 0 });
    const v1 = appendWall(room, v0, { x: 1000, y: 0 }, 100);
    const v2 = appendWall(room, v1, { x: 2000, y: 0 }, 100);

    setWallLength(room, room.walls[0]!.id, 1500);

    expect(room.vertices[v1]).toEqual({ x: 1500, y: 0 });
    // The far end of the collinear continuation stays put.
    expect(room.vertices[v2]).toEqual({ x: 2000, y: 0 });
  });

  it('rejects a non-positive or unchanged length', () => {
    const room = rectangularRoom(4000, 3000);
    const id = room.walls[0]!.id;
    expect(setWallLength(room, id, 0)).toBe(false);
    expect(setWallLength(room, id, -100)).toBe(false);
    expect(setWallLength(room, id, 4000)).toBe(false); // no change
    expect(setWallLength(room, 'nope', 1000)).toBe(false);
  });

  it('leaves whole-millimeter coordinates behind', () => {
    const room = rectangularRoom(4000, 3000);
    setWallLength(room, room.walls[0]!.id, 3333);
    for (const v of Object.values(room.vertices)) {
      expect(Number.isInteger(v.x)).toBe(true);
      expect(Number.isInteger(v.y)).toBe(true);
    }
  });
});

describe('moveVertex', () => {
  it('moves every wall attached to the vertex', () => {
    const room = rectangularRoom(4000, 3000);
    const corner = room.walls[0]!.a;
    expect(wallsAtVertex(room, corner)).toHaveLength(2);

    moveVertex(room, corner, { x: -500, y: -500 });
    expect(room.vertices[corner]).toEqual({ x: -500, y: -500 });
    expect(roomPolygon(room)).toHaveLength(4);
  });

  it('rounds to whole millimeters', () => {
    const room = rectangularRoom(4000, 3000);
    moveVertex(room, room.walls[0]!.a, { x: 10.6, y: -3.2 });
    expect(room.vertices[room.walls[0]!.a]).toEqual({ x: 11, y: -3 });
  });

  it('ignores an unknown vertex', () => {
    const room = rectangularRoom(4000, 3000);
    expect(() => moveVertex(room, 'nope', { x: 0, y: 0 })).not.toThrow();
  });
});

describe('deleteWall', () => {
  it('removes the wall and any vertex left with nothing attached', () => {
    const room = emptyRoom();
    const v0 = startChain(room, { x: 0, y: 0 });
    appendWall(room, v0, { x: 1000, y: 0 }, 100);
    expect(Object.keys(room.vertices)).toHaveLength(2);

    deleteWall(room, room.walls[0]!.id);
    expect(room.walls).toHaveLength(0);
    expect(Object.keys(room.vertices)).toHaveLength(0);
  });

  it('keeps vertices that other walls still use', () => {
    const room = rectangularRoom(4000, 3000);
    deleteWall(room, room.walls[0]!.id);
    expect(room.walls).toHaveLength(3);
    // Every corner is still shared by a remaining wall except none — a closed
    // loop minus one wall leaves all four corners in use.
    expect(Object.keys(room.vertices)).toHaveLength(4);
  });

  it('takes the wall openings with it', () => {
    const room = rectangularRoom(4000, 3000);
    const wallId = room.walls[0]!.id;
    addOpening(room, wallId, { kind: 'door', offset: 1000, width: 900 });
    expect(room.openings).toHaveLength(1);

    deleteWall(room, wallId);
    expect(room.openings).toHaveLength(0);
  });
});

describe('splitWall', () => {
  it('inserts a vertex and a second wall', () => {
    const room = rectangularRoom(4000, 3000);
    const wallId = room.walls[0]!.id;

    const midId = splitWall(room, wallId, { x: 2000, y: 0 });

    expect(midId).not.toBeNull();
    expect(room.walls).toHaveLength(5);
    expect(room.vertices[midId!]).toEqual({ x: 2000, y: 0 });
    // The ring is still closed and the same size.
    expect(polygonArea(roomPolygon(room))).toBe(4000 * 3000);
  });

  it('refuses to split at the very ends', () => {
    const room = rectangularRoom(4000, 3000);
    const wallId = room.walls[0]!.id;
    expect(splitWall(room, wallId, { x: 0, y: 0 })).toBeNull();
    expect(splitWall(room, wallId, { x: 4000, y: 0 })).toBeNull();
    expect(room.walls).toHaveLength(4);
  });

  it('reassigns an opening past the split to the second half', () => {
    const room = rectangularRoom(4000, 3000);
    const wallId = room.walls[0]!.id;
    const opening = addOpening(room, wallId, { kind: 'window', offset: 3000, width: 600 })!;

    splitWall(room, wallId, { x: 2000, y: 0 });

    const moved = room.openings.find((o) => o.id === opening.id)!;
    expect(moved.wallId).not.toBe(wallId);
    expect(moved.offset).toBe(1000); // 3000 - 2000
  });

  it('leaves an opening before the split where it was', () => {
    const room = rectangularRoom(4000, 3000);
    const wallId = room.walls[0]!.id;
    const opening = addOpening(room, wallId, { kind: 'window', offset: 500, width: 600 })!;

    splitWall(room, wallId, { x: 2000, y: 0 });

    const stayed = room.openings.find((o) => o.id === opening.id)!;
    expect(stayed.wallId).toBe(wallId);
    expect(stayed.offset).toBe(500);
  });
});

describe('openings', () => {
  it('adds a door with a default swing', () => {
    const room = rectangularRoom(4000, 3000);
    const door = addOpening(room, room.walls[0]!.id, {
      kind: 'door',
      offset: 1000,
      width: 900,
    })!;
    expect(door.swing).toEqual({ hinge: 'a', into: 'in', angle: 90 });
  });

  it('does not give a window a swing', () => {
    const room = rectangularRoom(4000, 3000);
    const win = addOpening(room, room.walls[0]!.id, {
      kind: 'window',
      offset: 1000,
      width: 900,
    })!;
    expect(win.swing).toBeUndefined();
  });

  it('refuses an opening at least as wide as its wall', () => {
    const room = rectangularRoom(4000, 3000);
    expect(
      addOpening(room, room.walls[0]!.id, { kind: 'door', offset: 0, width: 4000 }),
    ).toBeNull();
    expect(
      addOpening(room, room.walls[0]!.id, { kind: 'door', offset: 0, width: 5000 }),
    ).toBeNull();
    expect(room.openings).toHaveLength(0);
  });

  it('clamps an out-of-range offset on insert', () => {
    const room = rectangularRoom(4000, 3000);
    const door = addOpening(room, room.walls[0]!.id, {
      kind: 'door',
      offset: 9999,
      width: 900,
    })!;
    // Stops at the inside face of the far wall (114 mm walls, so 57 in).
    expect(door.offset).toBe(4000 - 57 - 900);
  });

  it('clamps when sliding along the wall', () => {
    const room = rectangularRoom(4000, 3000);
    const door = addOpening(room, room.walls[0]!.id, {
      kind: 'door',
      offset: 1000,
      width: 900,
    })!;

    // Each end stops at the neighbouring wall's inside face, not its centreline.
    moveOpening(room, door.id, -500);
    expect(room.openings[0]!.offset).toBe(57);

    moveOpening(room, door.id, 99999);
    expect(room.openings[0]!.offset).toBe(4000 - 57 - 900);
  });

  it('clamps width to the wall and re-clamps the offset', () => {
    const room = rectangularRoom(4000, 3000);
    const door = addOpening(room, room.walls[0]!.id, {
      kind: 'door',
      offset: 3000,
      width: 900,
    })!;

    resizeOpening(room, door.id, 2000);
    expect(room.openings[0]!.width).toBe(2000);
    expect(room.openings[0]!.offset).toBe(4000 - 57 - 2000); // pushed back to fit

    // No wider than the wall between its neighbours' inside faces.
    resizeOpening(room, door.id, 99999);
    expect(room.openings[0]!.width).toBe(4000 - 114);
  });

  it('ignores a non-positive resize', () => {
    const room = rectangularRoom(4000, 3000);
    const door = addOpening(room, room.walls[0]!.id, { kind: 'door', offset: 0, width: 900 })!;
    resizeOpening(room, door.id, 0);
    expect(room.openings[0]!.width).toBe(900);
  });

  it('deletes by id', () => {
    const room = rectangularRoom(4000, 3000);
    const door = addOpening(room, room.walls[0]!.id, { kind: 'door', offset: 0, width: 900 })!;
    deleteOpening(room, door.id);
    expect(room.openings).toHaveLength(0);
  });

  it('drops an opening onto the nearest wall and centres it on the click', () => {
    const room = rectangularRoom(4000, 3000);
    // Just below the top wall, a third of the way across.
    const placed = addOpeningNearPoint(
      room,
      { x: 1200, y: 40 },
      { kind: 'door', width: 900 },
      200,
    );

    expect(placed).not.toBeNull();
    expect(placed!.wallId).toBe(room.walls[0]!.id);
    expect(placed!.offset).toBe(1200 - 450);
  });

  it('returns null when no wall is close enough', () => {
    const room = rectangularRoom(4000, 3000);
    expect(
      addOpeningNearPoint(room, { x: 2000, y: 1500 }, { kind: 'door', width: 900 }, 200),
    ).toBeNull();
    expect(room.openings).toHaveLength(0);
  });
});

describe('chains', () => {
  it('builds and closes a triangle', () => {
    const room = emptyRoom();
    const v0 = startChain(room, { x: 0, y: 0 });
    const v1 = appendWall(room, v0, { x: 3000, y: 0 }, 100);
    const v2 = appendWall(room, v1, { x: 0, y: 4000 }, 100);
    closeChain(room, v2, v0, 100);

    expect(room.walls).toHaveLength(3);
    expect(roomPolygon(room)).toHaveLength(3);
    expect(roomArea(room)).toBe((3000 * 4000) / 2);
  });

  it('will not close a chain onto itself or duplicate an existing wall', () => {
    const room = emptyRoom();
    const v0 = startChain(room, { x: 0, y: 0 });
    const v1 = appendWall(room, v0, { x: 1000, y: 0 }, 100);

    closeChain(room, v0, v0, 100);
    expect(room.walls).toHaveLength(1);

    closeChain(room, v1, v0, 100); // that wall already exists
    expect(room.walls).toHaveLength(1);
  });
});

describe('openings follow their wall', () => {
  it('pulls a door back onto a wall that was typed shorter', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;
    const door = addOpening(room, top.id, { kind: 'door', offset: 3000, width: 800 })!;

    setWallLength(room, top.id, 2000);

    expect(door.offset + door.width).toBeLessThanOrEqual(2000);
    expect(door.width).toBe(800);
  });

  it('pulls a window back once a corner drag ends', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;
    const win = addOpening(room, top.id, { kind: 'window', offset: 3000, width: 900 })!;

    moveVertex(room, top.b, { x: 2500, y: 0 });
    refitOpenings(room, [top.id]);

    expect(win.offset + win.width).toBeLessThanOrEqual(wallLength(room, top));
  });

  it('narrows an opening only when the wall is now narrower than it', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;
    const win = addOpening(room, top.id, { kind: 'window', offset: 0, width: 1500 })!;

    moveVertex(room, top.b, { x: 1000, y: 0 });
    refitOpenings(room, [top.id]);

    // Exactly as wide as the wall's inside face now is (the right wall went
    // diagonal, so that's not simply 1000 - 114), starting where it starts.
    const span = interiorSpan(room, top);
    expect(win.width).toBe(Math.round(span.end - span.start));
    expect(win.width).toBeLessThan(1000);
    expect(win.offset).toBe(Math.round(span.start));
  });

  it('does not ratchet while a corner is dragged past an opening and back', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;
    const win = addOpening(room, top.id, { kind: 'window', offset: 0, width: 1500 })!;

    // Frames of one drag: in past the window, then back out.
    moveVertex(room, top.b, { x: 1000, y: 0 });
    moveVertex(room, top.b, { x: 4000, y: 0 });
    refitOpenings(room, [top.id]);

    expect(win.width).toBe(1500);
  });

  it('keeps an opening that straddles a split on one half, fully', () => {
    const room = rectangularRoom(4000, 3000);
    const wallId = room.walls[0]!.id;
    const door = addOpening(room, wallId, { kind: 'door', offset: 1700, width: 800 })!;

    splitWall(room, wallId, { x: 2000, y: 0 });

    // Its centre (2100) is past the split, so it goes to the second half.
    const half = room.walls.find((w) => w.id === door.wallId)!;
    expect(half.id).not.toBe(wallId);
    expect(door.offset).toBeGreaterThanOrEqual(0);
    expect(door.offset + door.width).toBeLessThanOrEqual(wallLength(room, half));
  });
});

describe('setInteriorWallLength', () => {
  it('sets the length a tape measure along the inside would read', () => {
    const room = rectangularRoom(4000, 3000);
    const top = room.walls[0]!;
    expect(setInteriorWallLength(room, top.id, 4000)).toBe(true);
    expect(Math.round(interiorWallLength(room, top))).toBe(4000);
    // The room stays rectangular, and its floor grows to match.
    expect(Math.round(interiorArea(room))).toBe(4000 * (3000 - 114));
  });
});

describe('inside faces and openings', () => {
  it('keeps a door out of the neighbouring wall at either end', () => {
    const room = rectangularRoom(3000, 3000);
    const door = addOpening(room, room.walls[0]!.id, { kind: 'door', offset: 0, width: 900 })!;
    expect(door.offset).toBe(57);
  });
});

describe('setInteriorWallLength at an angle', () => {
  it('lands on the typed length even when the next wall is not square', () => {
    // The wall after the first leaves at 45°, so it pivots rather than sliding.
    const room = roomFromPolygon([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 6000, y: 2000 },
      { x: 0, y: 2000 },
    ]);
    const first = room.walls[0]!;
    setInteriorWallLength(room, first.id, 3500);
    expect(Math.round(interiorWallLength(room, first))).toBe(3500);
  });
});

describe('refitting after a typed length', () => {
  const angled = () =>
    roomFromPolygon([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 6000, y: 2000 },
      { x: 0, y: 2000 },
    ]);

  it('does not narrow an opening on an overshooting correction step', () => {
    const room = angled();
    const first = room.walls[0]!;
    const win = addOpening(room, first.id, { kind: 'window', offset: 2000, width: 1800 })!;
    setInteriorWallLength(room, first.id, 3900);
    // The face is long enough for it once the length has settled, so it keeps its width.
    const span = interiorSpan(room, first);
    expect(span.end - span.start).toBeGreaterThan(1800);
    expect(win.width).toBe(1800);
  });

  it('refits the wall beyond a neighbour that pivoted', () => {
    // Walls: 0 top, 1 diagonal right side, 2 bottom, 3 left.
    const room = angled();
    const bottom = room.walls[2]!;
    // Flush against the diagonal wall's inside face, at bottom's `a` end.
    const door = addOpening(room, bottom.id, { kind: 'door', offset: 0, width: 800 })!;
    const before = door.offset;

    setWallLength(room, room.walls[0]!.id, 3000); // the diagonal wall pivots

    expect(door.offset).not.toBe(before);
    expect(door.offset).toBeGreaterThanOrEqual(Math.floor(interiorSpan(room, bottom).start));
  });
});

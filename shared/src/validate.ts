/**
 * Structural checks for what crosses the API boundary.
 *
 * The server writes whatever it's given straight to disk, and the editor
 * assumes every project it loads is well formed: a wall whose vertex is
 * missing, or a length that's a string, crashes the canvas rather than showing
 * an error. So the shape is checked once, at the door, and a bad body is
 * refused with the path of the first thing wrong with it.
 *
 * This checks what the code relies on, not every optional field. Anything
 * present is type-checked; only fields the editor can't do without are
 * required.
 */

import type { Project } from './types.js';

/** Bumped whenever the saved project shape changes in a way old files need migrating for. */
export const PROJECT_SCHEMA_VERSION = 1;

type Obj = Record<string, unknown>;

class Invalid extends Error {}

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(path: string, what: string): never {
  throw new Invalid(`${path} ${what}`);
}

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) fail(path, 'must be an object');
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'must be an array');
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'must be a string');
  return v;
}

function num(v: unknown, path: string, { min }: { min?: number } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'must be a finite number');
  if (min !== undefined && v < min) fail(path, `must be at least ${min}`);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'must be true or false');
  return v;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  if (!options.includes(v as T)) fail(path, `must be one of ${options.join(', ')}`);
  return v as T;
}

function optional<T>(v: unknown, check: (v: unknown) => T): T | undefined {
  return v === undefined ? undefined : check(v);
}

function strings(v: unknown, path: string): void {
  arr(v, path).forEach((s, i) => str(s, `${path}[${i}]`));
}

const LAYERS = ['rug', 'floor', 'onTop', 'wall', 'ceiling'] as const;
const OPENING_KINDS = ['door', 'window', 'opening'] as const;
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
const CONFIDENCE = ['high', 'medium', 'low', 'manual'] as const;

function footprint(v: unknown, path: string): void {
  const f = obj(v, path);
  const kind = oneOf(f.kind, ['rect', 'L', 'poly'] as const, `${path}.kind`);
  if (kind === 'L') {
    num(f.notchW, `${path}.notchW`);
    num(f.notchD, `${path}.notchD`);
    oneOf(f.corner, CORNERS, `${path}.corner`);
  } else if (kind === 'poly') {
    const points = arr(f.points, `${path}.points`);
    if (points.length < 3) fail(`${path}.points`, 'needs at least 3 points');
    points.forEach((p, i) => point(p, `${path}.points[${i}]`));
  }
}

function point(v: unknown, path: string): void {
  const p = obj(v, path);
  num(p.x, `${path}.x`);
  num(p.y, `${path}.y`);
}

function clearances(v: unknown, path: string, partial: boolean): void {
  const c = obj(v, path);
  for (const side of ['front', 'back', 'left', 'right']) {
    if (partial && c[side] === undefined) continue;
    num(c[side], `${path}.${side}`, { min: 0 });
  }
}

function checkProject(v: unknown): void {
  const p = obj(v, 'project');
  str(p.id, 'project.id');
  str(p.name, 'project.name');
  optional(p.schemaVersion, (s) => num(s, 'project.schemaVersion', { min: 0 }));

  const settings = obj(p.settings, 'project.settings');
  oneOf(settings.units, ['imperial', 'metric'] as const, 'project.settings.units');
  num(settings.gridStep, 'project.settings.gridStep', { min: 0 });

  const room = obj(p.room, 'project.room');
  const vertices = obj(room.vertices, 'project.room.vertices');
  for (const [id, pt] of Object.entries(vertices)) point(pt, `project.room.vertices.${id}`);
  num(room.ceilingHeight, 'project.room.ceilingHeight', { min: 0 });

  const wallIds = new Set<string>();
  arr(room.walls, 'project.room.walls').forEach((w, i) => {
    const path = `project.room.walls[${i}]`;
    const wall = obj(w, path);
    wallIds.add(str(wall.id, `${path}.id`));
    for (const end of ['a', 'b'] as const) {
      const ref = str(wall[end], `${path}.${end}`);
      if (!(ref in vertices)) fail(`${path}.${end}`, `refers to missing vertex ${ref}`);
    }
    num(wall.thickness, `${path}.thickness`, { min: 0 });
  });

  arr(room.openings, 'project.room.openings').forEach((o, i) => {
    const path = `project.room.openings[${i}]`;
    const opening = obj(o, path);
    str(opening.id, `${path}.id`);
    const wallId = str(opening.wallId, `${path}.wallId`);
    if (!wallIds.has(wallId)) fail(`${path}.wallId`, `refers to missing wall ${wallId}`);
    num(opening.offset, `${path}.offset`, { min: 0 });
    num(opening.width, `${path}.width`, { min: 0 });
    oneOf(opening.kind, OPENING_KINDS, `${path}.kind`);
  });

  arr(p.items, 'project.items').forEach((it, i) => {
    const path = `project.items[${i}]`;
    const item = obj(it, path);
    str(item.id, `${path}.id`);
    str(item.libraryId, `${path}.libraryId`);
    for (const key of ['x', 'y', 'rotation', 'z']) num(item[key], `${path}.${key}`);
    for (const key of ['w', 'd', 'h'])
      optional(item[key], (n) => num(n, `${path}.${key}`, { min: 0 }));
    optional(item.footprint, (f) => footprint(f, `${path}.footprint`));
    optional(item.clearances, (c) => clearances(c, `${path}.clearances`, true));
    bool(item.flipX, `${path}.flipX`);
    bool(item.locked, `${path}.locked`);
    oneOf(item.layer, LAYERS, `${path}.layer`);
    strings(item.tags, `${path}.tags`);
  });
}

function checkLibraryItem(v: unknown, path: string): void {
  const item = obj(v, path);
  str(item.id, `${path}.id`);
  str(item.name, `${path}.name`);
  str(item.categoryId, `${path}.categoryId`);
  str(item.subcategoryId, `${path}.subcategoryId`);
  for (const key of ['w', 'd', 'h']) num(item[key], `${path}.${key}`, { min: 0 });
  footprint(item.footprint, `${path}.footprint`);
  clearances(item.clearances, `${path}.clearances`, false);
  arr(item.variants, `${path}.variants`).forEach((va, i) => {
    const variant = obj(va, `${path}.variants[${i}]`);
    str(variant.id, `${path}.variants[${i}].id`);
    str(variant.hex, `${path}.variants[${i}].hex`);
  });
  oneOf(item.confidence, CONFIDENCE, `${path}.confidence`);
  strings(item.tags, `${path}.tags`);
}

function run(check: () => void): string | null {
  try {
    check();
    return null;
  } catch (err) {
    if (err instanceof Invalid) return err.message;
    throw err;
  }
}

/** Why `value` isn't a usable project, or null if it is. */
export function projectProblem(value: unknown): string | null {
  return run(() => checkProject(value));
}

/** Why `value` isn't a usable library item, or null if it is. */
export function libraryItemProblem(value: unknown, path = 'item'): string | null {
  return run(() => checkLibraryItem(value, path));
}

/**
 * Bring a project read from disk up to the current shape.
 *
 * Files written before versioning carry no `schemaVersion`; version 1 is that
 * same shape with the field added, so there's nothing to transform yet. The
 * next breaking change adds its step here, keyed on the version it upgrades.
 */
export function migrateProject(raw: Project): Project {
  const from = raw.schemaVersion ?? 0;
  if (from > PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `project ${raw.id} was saved by a newer version of the app (schema ${from}); update before opening it`,
    );
  }
  return { ...raw, schemaVersion: PROJECT_SCHEMA_VERSION };
}

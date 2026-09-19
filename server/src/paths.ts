import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Data lives at the repo root, not under the server package, so it survives
 * moving the server around and is obvious to a human poking at the folder.
 * Resolved from this module's location rather than cwd, because the dev script
 * runs with cwd set to `server/` while a direct `node` invocation may not.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

export const DATA_DIR = path.join(REPO_ROOT, 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const LIBRARY_DIR = path.join(DATA_DIR, 'library');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
export const LIBRARY_FILE = path.join(LIBRARY_DIR, 'library.json');
/** Starter furniture, committed to the repo and copied in on first run. */
export const SEED_LIBRARY_FILE = path.join(REPO_ROOT, 'data', 'seed', 'library.json');

/**
 * Copy the starter library in the first time the app runs.
 *
 * A fresh clone with an empty library is a bad first five minutes: every
 * feature past "draw a wall" needs something to place, and the only ways to get
 * one are an AI key or typing a product in by hand. Seeding happens exactly
 * once — the check is for the file existing, not for it being non-empty, so a
 * user who deliberately empties their library doesn't find it refilled.
 */
async function seedLibraryIfMissing(): Promise<void> {
  try {
    await fs.access(LIBRARY_FILE);
    return; // already has a library, seeded or not
  } catch {
    /* no library yet — fall through and seed */
  }

  try {
    await fs.copyFile(SEED_LIBRARY_FILE, LIBRARY_FILE);
    console.log('[server] seeded the furniture library with starter items');
  } catch (err) {
    // Not fatal: an empty library still works, and the UI explains how to fill
    // it. Failing startup over missing sample data would be absurd.
    console.warn('[server] could not seed the library:', (err as Error).message);
  }
}

export async function ensureDataDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(PROJECTS_DIR, { recursive: true }),
    fs.mkdir(LIBRARY_DIR, { recursive: true }),
    fs.mkdir(IMAGES_DIR, { recursive: true }),
  ]);
  await seedLibraryIfMissing();
}

/**
 * Ids come from the client and end up in file paths, so treat them as hostile.
 * Only the shape `newId()` produces is allowed: no separators, no dots, no
 * traversal, nothing that could escape the data directory.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeId(id: string): boolean {
  return typeof id === 'string' && SAFE_ID.test(id);
}

/** Resolve a project file path, or throw if the id is not a plain safe token. */
export function projectPath(id: string): string {
  if (!isSafeId(id)) throw new Error(`unsafe project id: ${id}`);
  return path.join(PROJECTS_DIR, `${id}.json`);
}

export function imagePath(assetId: string): string {
  if (!isSafeId(assetId)) throw new Error(`unsafe asset id: ${assetId}`);
  return path.join(IMAGES_DIR, `${assetId}.webp`);
}

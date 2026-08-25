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

export async function ensureDataDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(PROJECTS_DIR, { recursive: true }),
    fs.mkdir(LIBRARY_DIR, { recursive: true }),
    fs.mkdir(IMAGES_DIR, { recursive: true }),
  ]);
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

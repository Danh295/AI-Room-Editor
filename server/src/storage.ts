import fs from 'node:fs/promises';
import path from 'node:path';
import type { LibraryItem, Project, ProjectSummary } from '@room/shared';
import { LIBRARY_FILE, PROJECTS_DIR, projectPath, ensureDataDirs } from './paths.js';

/**
 * Write JSON without the truncate-then-crash failure mode.
 *
 * A plain `writeFile` opens the target with O_TRUNC, so an interrupted write
 * leaves a zero-length or half-written project file — the user's floor plan,
 * gone. Writing to a sibling temp file and renaming makes replacement atomic on
 * the same filesystem.
 */
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDataDirs();
  const entries = await fs.readdir(PROJECTS_DIR);
  const summaries: ProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const project = await readJson<Project>(path.join(PROJECTS_DIR, entry));
    // Skip anything unreadable rather than failing the whole listing — one
    // hand-edited file with a stray comma shouldn't hide every other project.
    if (!project?.id) continue;
    summaries.push({
      id: project.id,
      name: project.name ?? 'Untitled',
      updatedAt: project.updatedAt ?? '',
      itemCount: project.items?.length ?? 0,
    });
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export async function readProject(id: string): Promise<Project | null> {
  return readJson<Project>(projectPath(id));
}

export async function writeProject(project: Project): Promise<Project> {
  const stamped: Project = { ...project, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(projectPath(stamped.id), stamped);
  return stamped;
}

export async function deleteProject(id: string): Promise<boolean> {
  try {
    await fs.unlink(projectPath(id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

interface LibraryFile {
  items: LibraryItem[];
}

export async function readLibrary(): Promise<LibraryItem[]> {
  const file = await readJson<LibraryFile>(LIBRARY_FILE);
  return file?.items ?? [];
}

export async function writeLibrary(items: LibraryItem[]): Promise<void> {
  await writeJsonAtomic(LIBRARY_FILE, { items } satisfies LibraryFile);
}

/** Insert or replace by id, preserving `createdAt` on replace. */
export async function upsertLibraryItem(item: LibraryItem): Promise<LibraryItem> {
  const items = await readLibrary();
  const index = items.findIndex((i) => i.id === item.id);
  const now = new Date().toISOString();

  const merged: LibraryItem =
    index >= 0
      ? { ...item, createdAt: items[index]!.createdAt, updatedAt: now }
      : { ...item, updatedAt: now };

  if (index >= 0) items[index] = merged;
  else items.push(merged);

  await writeLibrary(items);
  return merged;
}

export async function deleteLibraryItem(id: string): Promise<boolean> {
  const items = await readLibrary();
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return false;
  await writeLibrary(next);
  return true;
}

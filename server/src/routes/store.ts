import { Router } from 'express';
import type { LibraryItem, Project } from '@room/shared';
import { PROJECT_SCHEMA_VERSION, libraryItemProblem, projectProblem } from '@room/shared';
import { isSafeId } from '../paths.js';
import {
  deleteLibraryItem,
  deleteProject,
  listProjects,
  readLibrary,
  readProject,
  upsertLibraryItem,
  writeLibrary,
  writeProject,
} from '../storage.js';

export const storeRouter = Router();

// --- projects --------------------------------------------------------------

storeRouter.get('/projects', async (_req, res) => {
  res.json(await listProjects());
});

storeRouter.get('/projects/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid project id' });

  const project = await readProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });
  return res.json(project);
});

storeRouter.put('/projects/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid project id' });

  // Trust the URL over the payload so a stale client can't write one project's
  // contents into another's file.
  const body = { ...(req.body as Project), id };
  // Written by a newer build: saving it through this one would stamp it with
  // the older version and silently drop whatever the newer shape added. Checked
  // before the shape, which a newer build may well have changed.
  const version = (body as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number' && version > PROJECT_SCHEMA_VERSION) {
    return res.status(409).json({ error: 'project was saved by a newer version of the app' });
  }
  const problem = projectProblem(body);
  if (problem) return res.status(400).json({ error: `invalid project: ${problem}` });
  return res.json(await writeProject(body));
});

storeRouter.delete('/projects/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid project id' });
  return res.json({ deleted: await deleteProject(id) });
});

// --- library ---------------------------------------------------------------

storeRouter.get('/library', async (_req, res) => {
  res.json(await readLibrary());
});

storeRouter.put('/library', async (req, res) => {
  const items = req.body as LibraryItem[] | undefined;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'expected an array of library items' });
  }
  for (const [i, item] of items.entries()) {
    const problem = libraryItemProblem(item, `items[${i}]`);
    if (problem) return res.status(400).json({ error: `invalid library: ${problem}` });
  }
  await writeLibrary(items);
  return res.json({ count: items.length });
});

storeRouter.put('/library/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid item id' });

  const body = { ...(req.body as LibraryItem), id };
  const problem = libraryItemProblem(body);
  if (problem) return res.status(400).json({ error: `invalid library item: ${problem}` });
  return res.json(await upsertLibraryItem(body));
});

storeRouter.delete('/library/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid item id' });
  return res.json({ deleted: await deleteLibraryItem(id) });
});

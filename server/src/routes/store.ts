import { Router } from 'express';
import type { LibraryItem, Project } from '@room/shared';
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

  const body = req.body as Project | undefined;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'expected a project body' });
  }
  // Trust the URL over the payload so a stale client can't write one project's
  // contents into another's file.
  return res.json(await writeProject({ ...body, id }));
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
  await writeLibrary(items);
  return res.json({ count: items.length });
});

storeRouter.put('/library/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid item id' });

  const body = req.body as LibraryItem | undefined;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'expected a library item body' });
  }
  return res.json(await upsertLibraryItem({ ...body, id }));
});

storeRouter.delete('/library/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid item id' });
  return res.json({ deleted: await deleteLibraryItem(id) });
});

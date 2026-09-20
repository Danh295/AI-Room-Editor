import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createProject, createLibraryItem, type Project } from '@room/shared';

/*
  Point the whole storage layer at a throwaway directory *before* importing
  anything that reads it: paths.ts resolves its constants at module load, so an
  import earlier than this would pin the real data directory and these tests
  would start writing over someone's rooms.
*/
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-store-test-'));
process.env.ROOM_DATA_DIR = dataDir;

const { createApp } = await import('../app.js');
const { ensureDataDirs, PROJECTS_DIR, LIBRARY_FILE } = await import('../paths.js');

const app = createApp();

beforeAll(async () => {
  await ensureDataDirs();
});

beforeEach(async () => {
  // Each test starts from an empty store, seeded library and all.
  await fs.rm(PROJECTS_DIR, { recursive: true, force: true });
  await fs.rm(LIBRARY_FILE, { force: true });
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.writeFile(LIBRARY_FILE, JSON.stringify({ items: [] }));
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function sampleProject(name = 'Test room'): Project {
  return createProject(name);
}

describe('projects', () => {
  it('round-trips a project through PUT and GET', async () => {
    const project = sampleProject();
    const put = await request(app).put(`/api/projects/${project.id}`).send(project).expect(200);

    // The server owns updatedAt, so it should come back newer than we sent.
    expect(put.body.id).toBe(project.id);
    expect(put.body.updatedAt).not.toBe('');

    const got = await request(app).get(`/api/projects/${project.id}`).expect(200);
    expect(got.body.name).toBe('Test room');
    expect(got.body.room.walls).toEqual([]);
  });

  it('lists projects newest first, with an item count', async () => {
    const older = { ...sampleProject('Older'), updatedAt: '2020-01-01T00:00:00.000Z' };
    const newer = sampleProject('Newer');
    await request(app).put(`/api/projects/${older.id}`).send(older).expect(200);
    await new Promise((r) => setTimeout(r, 5));
    await request(app).put(`/api/projects/${newer.id}`).send(newer).expect(200);

    const list = await request(app).get('/api/projects').expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Newer', 'Older']);
    expect(list.body[0]).toHaveProperty('itemCount', 0);
  });

  it('404s for a project that does not exist', async () => {
    await request(app).get('/api/projects/proj_missing').expect(404);
  });

  it('deletes, and says so honestly the second time', async () => {
    const project = sampleProject();
    await request(app).put(`/api/projects/${project.id}`).send(project).expect(200);

    await request(app).delete(`/api/projects/${project.id}`).expect(200, { deleted: true });
    await request(app).delete(`/api/projects/${project.id}`).expect(200, { deleted: false });
    await request(app).get(`/api/projects/${project.id}`).expect(404);
  });

  it('writes the id from the URL, not the one in the body', async () => {
    // A stale client must not be able to write one project over another.
    const project = sampleProject();
    const res = await request(app)
      .put(`/api/projects/${project.id}`)
      .send({ ...project, id: 'proj_somewhere_else' })
      .expect(200);

    expect(res.body.id).toBe(project.id);
    await request(app).get('/api/projects/proj_somewhere_else').expect(404);
  });

  it('refuses ids that could escape the data directory', async () => {
    // Some of these never reach the handler because Express normalizes the
    // path first, so the guarantee under test is "never succeeds, never
    // writes", not one specific status code.
    for (const id of ['..', '../../etc/passwd', 'a/b', 'a.json', 'a b']) {
      const get = await request(app).get(`/api/projects/${encodeURIComponent(id)}`);
      expect([400, 404]).toContain(get.status);

      const put = await request(app)
        .put(`/api/projects/${encodeURIComponent(id)}`)
        .send(sampleProject());
      expect([400, 404]).toContain(put.status);
    }

    // Nothing above may have left a file anywhere near the data directory.
    expect(await fs.readdir(PROJECTS_DIR)).toEqual([]);
  });

  it('rejects a body that is not a project object', async () => {
    await request(app).put('/api/projects/proj_abc').send('42').type('json').expect(400);
  });

  it('answers 400, not 500, for malformed JSON', async () => {
    await request(app)
      .put('/api/projects/proj_abc')
      .set('content-type', 'application/json')
      .send('{"name": ')
      .expect(400);
  });
});

describe('library', () => {
  const item = () =>
    createLibraryItem({ name: 'Sofa', subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });

  it('upserts an item and lists it', async () => {
    const sofa = item();
    await request(app).put(`/api/library/${sofa.id}`).send(sofa).expect(200);

    const list = await request(app).get('/api/library').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Sofa');
  });

  it('keeps createdAt when an item is replaced', async () => {
    const sofa = item();
    const first = await request(app).put(`/api/library/${sofa.id}`).send(sofa).expect(200);

    await new Promise((r) => setTimeout(r, 5));
    const second = await request(app)
      .put(`/api/library/${sofa.id}`)
      .send({ ...sofa, name: 'Renamed', createdAt: '2001-01-01T00:00:00.000Z' })
      .expect(200);

    expect(second.body.name).toBe('Renamed');
    expect(second.body.createdAt).toBe(first.body.createdAt);
    expect(second.body.updatedAt).not.toBe(first.body.updatedAt);
  });

  it('deletes an item', async () => {
    const sofa = item();
    await request(app).put(`/api/library/${sofa.id}`).send(sofa).expect(200);
    await request(app).delete(`/api/library/${sofa.id}`).expect(200, { deleted: true });
    await request(app).get('/api/library').expect(200, []);
  });

  it('replaces the whole library only with an array', async () => {
    await request(app).put('/api/library').send([item(), item()]).expect(200, { count: 2 });
    await request(app).put('/api/library').send({ items: [] }).expect(400);
  });
});

describe('health', () => {
  it('reports the data directory and that no AI key is set', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dataDir).toBe(dataDir);
  });
});

describe('unknown endpoints', () => {
  it('404s as JSON under /api', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body).toHaveProperty('error');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-assets-test-'));
process.env.ROOM_DATA_DIR = dataDir;

const { createApp } = await import('../app.js');
const { ensureDataDirs } = await import('../paths.js');

const app = createApp();

/** A real 8x8 PNG — sharp has to be able to decode whatever we send. */
async function samplePng(): Promise<string> {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
  return png.toString('base64');
}

beforeAll(async () => {
  await ensureDataDirs();
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('POST /api/assets/upload', () => {
  it('stores an image and serves it back as webp', async () => {
    const res = await request(app)
      .post('/api/assets/upload')
      .send({ dataBase64: await samplePng() })
      .expect(200);

    expect(res.body.assetId).toMatch(/^[0-9a-f]{32}$/);
    expect(res.body.bytes).toBeGreaterThan(0);

    const fetched = await request(app).get(`/api/assets/${res.body.assetId}`).expect(200);
    expect(fetched.headers['content-type']).toContain('image/webp');
    // Content-addressed storage can cache forever; that's the whole point of it.
    expect(fetched.headers['cache-control']).toContain('immutable');
  });

  it('gives the same id to the same bytes twice', async () => {
    const dataBase64 = await samplePng();
    const first = await request(app)
      .post('/api/assets/upload')
      .send({ dataBase64 })
      .expect(200);
    const second = await request(app)
      .post('/api/assets/upload')
      .send({ dataBase64 })
      .expect(200);
    expect(second.body.assetId).toBe(first.body.assetId);
  });

  it('accepts a full data: URL as well as bare base64', async () => {
    const res = await request(app)
      .post('/api/assets/upload')
      .send({ dataBase64: `data:image/png;base64,${await samplePng()}` })
      .expect(200);
    expect(res.body.assetId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses an empty or undecodable payload', async () => {
    await request(app).post('/api/assets/upload').send({}).expect(400);
    await request(app).post('/api/assets/upload').send({ dataBase64: '' }).expect(400);
    await request(app)
      .post('/api/assets/upload')
      .send({ dataBase64: Buffer.from('not an image').toString('base64') })
      .expect(400);
  });
});

describe('GET /api/assets/:id', () => {
  it('404s for an id that was never stored', async () => {
    await request(app)
      .get(`/api/assets/${'a'.repeat(32)}`)
      .expect(404);
  });

  it('400s for an id that isn’t a plain token', async () => {
    await request(app).get('/api/assets/not%2Fa%2Ftoken').expect(400);
  });
});

describe('POST /api/assets/fetch', () => {
  it('refuses a private address instead of fetching it', async () => {
    const res = await request(app)
      .post('/api/assets/fetch')
      .send({ url: 'http://169.254.169.254/latest/meta-data/' })
      .expect(400);
    expect(res.body.error).toMatch(/local or private/);
  });

  it('refuses a non-http scheme', async () => {
    await request(app)
      .post('/api/assets/fetch')
      .send({ url: 'file:///etc/passwd' })
      .expect(400);
  });

  it('needs a url', async () => {
    await request(app).post('/api/assets/fetch').send({}).expect(400);
  });
});

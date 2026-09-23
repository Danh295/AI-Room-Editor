import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

/*
  These tests are about what the ingest routes claim, not about Gemini. The
  provider is stubbed, so each case can hand back exactly the answer a real
  model gave during live testing — including the ones that made the review
  card overstate how far to trust it.
*/
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-ingest-test-'));
process.env.ROOM_DATA_DIR = dataDir;

const research = vi.hoisted(() => vi.fn());
const extract = vi.hoisted(() => vi.fn());

vi.mock('../ai/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/index.js')>();
  return {
    ...actual,
    getProvider: () => ({
      name: 'gemini',
      researchModel: 'research-model',
      extractModel: 'extract-model',
      visionModel: 'vision-model',
      research,
      extract,
    }),
    providerName: () => 'gemini',
  };
});

const { createApp } = await import('../app.js');
const { AiError } = await import('../ai/index.js');
const app = createApp();

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  research.mockReset().mockResolvedValue({
    text: 'notes',
    citations: [{ title: 'ikea.com', url: 'https://www.ikea.com/' }],
    queries: [],
    model: 'research-model',
  });
  extract.mockReset();
});

/** What the extraction step returned for the couch photo during live testing. */
const identifiedSofa = {
  name: 'IKEA LANDSKRONA 3-seat sofa',
  brand: 'IKEA',
  subcategoryId: 'sofa',
  widthMm: 2040,
  depthMm: 890,
  heightMm: 780,
  confidence: 'high',
};

describe('POST /api/ingest/product', () => {
  it('never rates a photo identification above medium', async () => {
    extract.mockResolvedValue(identifiedSofa);

    const res = await request(app)
      .post('/api/ingest/product')
      .send({ method: 'photo', imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg' })
      .expect(200);

    // "high" from the model means the dimensions came off a spec sheet. It
    // says nothing about whether the picture really is that product.
    expect(res.body.draft.w.confidence).toBe('medium');
    expect(res.body.draft.name.confidence).toBe('medium');
    expect(res.body.draft.warnings.join(' ')).toMatch(/identified from a photo/i);
  });

  it('keeps a lower photo confidence as it is', async () => {
    extract.mockResolvedValue({ ...identifiedSofa, confidence: 'low' });

    const res = await request(app)
      .post('/api/ingest/product')
      .send({ method: 'photo', imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg' })
      .expect(200);

    expect(res.body.draft.w.confidence).toBe('low');
  });

  it("leaves a model-number lookup's high confidence alone", async () => {
    extract.mockResolvedValue({ ...identifiedSofa, name: 'IKEA KALLAX 4x4' });

    const res = await request(app)
      .post('/api/ingest/product')
      .send({ method: 'model', modelNumber: 'IKEA KALLAX 4x4' })
      .expect(200);

    expect(res.body.draft.w.confidence).toBe('high');
    expect(res.body.draft.warnings.join(' ')).not.toMatch(/identified from a photo/i);
  });
});

describe('POST /api/ingest/floorplan', () => {
  const trace = {
    polygonPx: [
      { x: 100, y: 70 },
      { x: 700, y: 70 },
      { x: 700, y: 570 },
      { x: 100, y: 570 },
    ],
    openings: [],
    readDimensions: [`12'-0"`, `10'-0"`],
    scaleMmPerPx: 6.096,
    confidence: 'high',
  };
  const body = { imageBase64: 'aGVsbG8=', mimeType: 'image/png', width: 800, height: 640 };

  it("reports the vision model's own confidence when it answers", async () => {
    extract.mockResolvedValue(trace);

    const res = await request(app).post('/api/ingest/floorplan').send(body).expect(200);

    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]?.[0]).toMatchObject({ model: 'vision-model' });
    expect(res.body.confidence).toBe('high');
    expect(res.body.warnings.join(' ')).toMatch(
      /shape and the number of corners are dependable/,
    );
  });

  it('reports low confidence, and drops the "shape is dependable" line, after falling back', async () => {
    // Live: the vision model answered 503 twice, the fallback traced a
    // shrunken room with an invented notch, and the card still said "high"
    // beside a warning that the corners were off.
    extract
      .mockRejectedValueOnce(new AiError('busy', 'unavailable', 503))
      .mockResolvedValueOnce(trace);

    const res = await request(app).post('/api/ingest/floorplan').send(body).expect(200);

    expect(extract).toHaveBeenCalledTimes(2);
    expect(res.body.confidence).toBe('low');
    const warnings = res.body.warnings.join(' ');
    expect(warnings).toMatch(/weaker one was used/);
    expect(warnings).not.toMatch(/shape and the number of corners are dependable/);
  });
});

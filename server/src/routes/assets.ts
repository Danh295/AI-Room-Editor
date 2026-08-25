import { Router } from 'express';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { IMAGES_DIR, imagePath, isSafeId, ensureDataDirs } from '../paths.js';
import { assertFetchableUrl, fetchWithTimeout } from '../net.js';

export const assetsRouter = Router();

/** Cap on what we'll pull from a remote host, before decoding. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** Longest edge we keep. Product shots beyond this are wasted pixels on a canvas. */
const MAX_EDGE = 1600;

function assetIdFor(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

/**
 * Normalize any input image to a size-bounded webp and store it under its
 * content hash, so re-adding the same product photo is free and the canvas
 * never has to reach out to a remote host (which CORS would block anyway).
 */
export async function storeImage(input: Buffer): Promise<{ assetId: string; bytes: number }> {
  await ensureDataDirs();

  const webp = await sharp(input)
    .rotate() // honour EXIF orientation; phone photos of floor plans arrive sideways
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const assetId = assetIdFor(webp);
  const target = imagePath(assetId);

  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, webp);
  }

  return { assetId, bytes: webp.length };
}

/** POST /api/assets/fetch  { url } -> { assetId } */
assetsRouter.post('/fetch', async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };
  if (typeof url !== 'string' || url === '') {
    return res.status(400).json({ error: 'expected { url }' });
  }

  try {
    return res.json(await storeImageFromUrl(url));
  } catch (err) {
    const message = (err as Error).message;
    const status = /local or private|valid URL|http and https/.test(message)
      ? 400
      : /too large/.test(message)
        ? 413
        : 502;
    return res.status(status).json({ error: message });
  }
});

/** POST /api/assets/upload  { dataBase64 } -> { assetId } */
assetsRouter.post('/upload', async (req, res) => {
  const { dataBase64 } = (req.body ?? {}) as { dataBase64?: string };
  if (typeof dataBase64 !== 'string' || dataBase64 === '') {
    return res.status(400).json({ error: 'expected { dataBase64 }' });
  }

  // Accept a full data: URL as well as a bare base64 payload.
  const payload = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
  const buffer = Buffer.from(payload, 'base64');

  if (buffer.length === 0) return res.status(400).json({ error: 'empty image' });
  if (buffer.length > MAX_DOWNLOAD_BYTES) return res.status(413).json({ error: 'image too large' });

  try {
    return res.json(await storeImage(buffer));
  } catch {
    return res.status(400).json({ error: 'could not decode that image' });
  }
});

/** GET /api/assets/:assetId -> the cached webp */
assetsRouter.get('/:assetId', async (req, res) => {
  const { assetId } = req.params;
  if (!isSafeId(assetId)) return res.status(400).json({ error: 'invalid asset id' });

  try {
    const bytes = await fs.readFile(imagePath(assetId));
    res.type('image/webp');
    // Content-addressed, so the bytes behind an id can never change.
    res.set('cache-control', 'public, max-age=31536000, immutable');
    return res.send(bytes);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
});

export { IMAGES_DIR };


/**
 * Download an image by URL and cache it, reusing the same guards and
 * normalization as the upload path. Used by product ingestion to pull the
 * og:image off a product page.
 */
export async function storeImageFromUrl(
  rawUrl: string,
): Promise<{ assetId: string; bytes: number; sourceUrl: string }> {
  const url = assertFetchableUrl(rawUrl);
  const response = await fetchWithTimeout(url, { headers: { accept: 'image/*' } });
  if (!response.ok) throw new Error(`source responded ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('empty image');
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new Error('image too large');

  const stored = await storeImage(buffer);
  return { ...stored, sourceUrl: url.toString() };
}

import { Router } from 'express';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { IMAGES_DIR, imagePath, isSafeId, ensureDataDirs } from '../paths.js';

export const assetsRouter = Router();

/** Cap on what we'll pull from a remote host, before decoding. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** Longest edge we keep. Product shots beyond this are wasted pixels on a canvas. */
const MAX_EDGE = 1600;
const FETCH_TIMEOUT_MS = 15_000;

function assetIdFor(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

/**
 * Normalize any input image to a size-bounded webp and store it under its
 * content hash, so re-adding the same product photo is free and the canvas
 * never has to reach out to a remote host (which CORS would block anyway).
 */
async function storeImage(input: Buffer): Promise<{ assetId: string; bytes: number }> {
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

/**
 * Only http(s), and never a host that resolves to somewhere on this machine or
 * the local network. Product URLs come from model output, which is influenced
 * by page content — an SSRF guard is cheap and the alternative is a server that
 * will fetch `http://localhost:8787/...` or a cloud metadata endpoint on request.
 */
function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http and https URLs are supported');
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) throw new Error('refusing to fetch a local or private address');
  return url;
}

/** POST /api/assets/fetch  { url } -> { assetId } */
assetsRouter.post('/fetch', async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };
  if (typeof url !== 'string' || url === '') {
    return res.status(400).json({ error: 'expected { url }' });
  }

  let parsed: URL;
  try {
    parsed = assertFetchableUrl(url);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some retail CDNs 403 a bare fetch.
        'user-agent': 'Mozilla/5.0 (compatible; AIRoomEditor/0.1; +local)',
        accept: 'image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `source responded ${response.status}` });
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_DOWNLOAD_BYTES) {
      return res.status(413).json({ error: 'image too large' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
      return res.status(413).json({ error: 'image too large' });
    }

    const stored = await storeImage(buffer);
    return res.json({ ...stored, sourceUrl: parsed.toString() });
  } catch (err) {
    const message = (err as Error).name === 'AbortError' ? 'source timed out' : (err as Error).message;
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timer);
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

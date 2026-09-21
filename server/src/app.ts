import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import cors from 'cors';
import { DATA_DIR, CLIENT_DIST } from './paths.js';
import { providerName } from './ai/index.js';
import { rateLimit } from './rateLimit.js';
import { storeRouter } from './routes/store.js';
import { assetsRouter } from './routes/assets.js';
import { ingestRouter } from './routes/ingest.js';

/**
 * Which AI provider is actually usable, if any.
 *
 * Reported by /api/health so the client can disable AI features with a clear
 * explanation instead of letting the user walk into a failing request. It asks
 * the provider registry rather than looking at the environment directly: an
 * ANTHROPIC_API_KEY is a configured key with no implementation behind it, and
 * answering "anthropic" here would light up a banner promising features that
 * 503 on first use.
 */
export function aiProvider(): 'gemini' | 'anthropic' | null {
  return providerName();
}

export interface AppOptions {
  /** Serve the built client and fall back to index.html for client routes. */
  serveClient?: boolean;
}

/**
 * Build the Express app.
 *
 * Separate from starting it so the tests can drive the real routes over an
 * ephemeral port instead of testing a reimplementation of them.
 */
export function createApp({ serveClient = false }: AppOptions = {}): express.Express {
  const app = express();

  // In production the client is served from this same origin, so CORS is
  // pointless there. In dev it's the Vite proxy, plus curl from a terminal.
  if (!serveClient) {
    app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
  }

  // Floor plan screenshots and product photos arrive as base64 in a JSON body,
  // so those two routes need a much larger limit than anything else. Applying
  // it globally would let any endpoint accept a 32mb body.
  const bulky = express.json({ limit: '32mb' });
  app.use('/api/ingest', bulky);
  app.use('/api/assets', bulky);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    // Whether the data directory is *writable* is the thing worth knowing:
    // a read-only volume mount looks perfectly healthy until the first save
    // fails, which is the worst possible moment to find out.
    let dataWritable = true;
    try {
      const probe = path.join(DATA_DIR, `.write-probe-${process.pid}`);
      await fs.writeFile(probe, '');
      await fs.rm(probe, { force: true });
    } catch {
      dataWritable = false;
    }

    res.json({ ok: true, dataDir: DATA_DIR, dataWritable, aiProvider: aiProvider() });
  });

  app.use('/api', storeRouter);
  app.use('/api/assets', assetsRouter);
  // Twelve lookups back to back covers furnishing a room in one sitting; the
  // sustained rate is what stops a retry loop from eating the daily quota.
  app.use('/api/ingest', rateLimit({ burst: 12, perMinute: 20 }), ingestRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'no such endpoint' });
  });

  if (serveClient) {
    // Hashed asset filenames can be cached hard; index.html must not be, or a
    // deploy leaves browsers pinned to the previous build forever.
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1y' }));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      // A body the parser couldn't read is the caller's problem, not a server
      // fault, and answering 500 to it sends people hunting for a bug here.
      if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({ error: 'malformed JSON body' });
      }
      if ((err as { type?: string })?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'body too large' });
      }

      console.error('[server]', err);
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : 'internal error' });
    },
  );

  return app;
}

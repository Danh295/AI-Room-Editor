import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ensureDataDirs, DATA_DIR } from './paths.js';
import { storeRouter } from './routes/store.js';
import { assetsRouter } from './routes/assets.js';

const PORT = Number(process.env.PORT ?? 8787);

const app = express();

// The client is same-origin through the Vite proxy in dev, but allow direct
// localhost calls so the API is pokeable with curl while developing.
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));

// Floor plan screenshots arrive as base64 in a JSON body, so the default 100kb
// limit is far too small.
app.use(express.json({ limit: '32mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dataDir: DATA_DIR,
    // Surfaced so the client can disable AI features with a clear explanation
    // instead of letting the user hit a failing request.
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.use('/api', storeRouter);
app.use('/api/assets', assetsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'no such endpoint' });
});

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
  },
);

await ensureDataDirs();

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] data directory: ${DATA_DIR}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[server] no ANTHROPIC_API_KEY set — AI features will be unavailable');
  }
});

import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { ensureDataDirs, DATA_DIR, REPO_ROOT, CLIENT_DIST } from './paths.js';
import { createApp, aiProvider } from './app.js';

/*
  Point dotenv at the repo root explicitly.

  `import 'dotenv/config'` resolves .env relative to cwd, and the dev script
  runs this with cwd set to server/ -- so it silently looked for server/.env and
  found nothing. The failure mode is nasty: no error, just an app that behaves
  as though you never configured a key. REPO_ROOT is derived from this module's
  location, so it holds however the server is launched.
*/
loadEnv({ path: path.join(REPO_ROOT, '.env') });

const PORT = Number(process.env.PORT ?? 8787);
/*
  Bind to loopback by default.

  This server has no authentication of any kind: anyone who can reach it can
  read and overwrite every project. On a laptop on a café network, binding to
  0.0.0.0 would hand that to the room. Anyone who genuinely wants it exposed
  can set HOST, and should put something in front of it that asks who you are.
*/
const HOST = process.env.HOST ?? '127.0.0.1';

// In production this process is the whole app: API plus the built client.
const production = process.env.NODE_ENV === 'production';

try {
  await ensureDataDirs();
} catch (err) {
  // Top-level await means an unhandled rejection here exits silently, and
  // under a restart policy that becomes an invisible crash loop. The usual
  // cause is a volume mounted with the wrong owner, so say that out loud.
  console.error(
    `[server] cannot use the data directory at ${DATA_DIR}: ${(err as Error).message}`,
  );
  console.error(
    '[server] check that it exists and is writable by this user (in Docker, that the volume is owned by `node`), or set ROOM_DATA_DIR elsewhere.',
  );
  process.exit(1);
}

const app = createApp({ serveClient: production });

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] data directory: ${DATA_DIR}`);
  if (production) console.log(`[server] serving the client from ${CLIENT_DIST}`);

  const provider = aiProvider();
  if (provider) {
    console.log(`[server] AI provider: ${provider}`);
  } else {
    console.log('[server] no AI key set — AI features unavailable (see .env.example)');
  }
});

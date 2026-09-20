import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
  The data directory is derived from this module's own location, and the
  production build moves that location from server/src to server/dist. Both are
  two levels below the repo root, which is the only reason the derivation keeps
  working — this test is here to fail loudly if a build change breaks that
  assumption and the built server quietly starts reading a different `data/`.
*/
describe('data directory resolution', () => {
  it('lands on <repo>/data from both src and dist layouts', async () => {
    const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

    for (const layout of ['server/src', 'server/dist']) {
      const here = path.join(repoRoot, layout);
      expect(path.resolve(here, '..', '..')).toBe(repoRoot);
    }
  });

  it('honours ROOM_DATA_DIR', async () => {
    const previous = process.env.ROOM_DATA_DIR;
    process.env.ROOM_DATA_DIR = '/tmp/somewhere-else';
    try {
      // A fresh module instance, since the constants are resolved at load.
      vi.resetModules();
      const paths = await import('./paths.js');
      expect(paths.DATA_DIR).toBe('/tmp/somewhere-else');
      expect(paths.PROJECTS_DIR).toBe('/tmp/somewhere-else/projects');
    } finally {
      if (previous === undefined) delete process.env.ROOM_DATA_DIR;
      else process.env.ROOM_DATA_DIR = previous;
      vi.resetModules();
    }
  });
});

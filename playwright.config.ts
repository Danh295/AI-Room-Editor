import { defineConfig, devices } from '@playwright/test';

/*
  End-to-end tests drive the production build the way `npm start` serves it:
  one server process holding the API and the built client. Each run starts
  from an empty data directory (the starter library is seeded into it), so
  tests never see a developer's own rooms.

  Run `npm run build` first; `npm run e2e` does both.
*/
const PORT = 8799;

export default defineConfig({
  testDir: 'e2e',
  // One server and one data directory: tests share the project list, so they
  // run one at a time rather than racing each other's rooms.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1400, height: 850 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 850 } },
    },
  ],
  webServer: {
    command: 'rm -rf e2e/.data && node server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      ROOM_DATA_DIR: 'e2e/.data',
      GEMINI_API_KEY: '',
    },
  },
});

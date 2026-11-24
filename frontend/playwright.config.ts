import { defineConfig, devices } from '@playwright/test';

/* The money path, offline: e2e/server.mjs boots the real API with RAWG,
   SteamGridDB, the image CDN and Ollama stubbed; Vite proxies /api to it.
   Ports differ from `npm run dev` so a running dev server is not disturbed. */
const API_PORT = 3110;
const UI_PORT = 5184;
const UI = `http://127.0.0.1:${UI_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: UI, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/server.mjs',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { E2E_API_PORT: String(API_PORT), E2E_UI_ORIGIN: UI },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${UI_PORT} --strictPort`,
      url: UI,
      env: { API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});

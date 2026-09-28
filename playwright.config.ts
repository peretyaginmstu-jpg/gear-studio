import { defineConfig, devices } from '@playwright/test';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
// Runs against the static export in out/; build it first (npm run build or build:pages).
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:4173${base}/`, acceptDownloads: true, locale: 'ru-RU', ...devices['Desktop Chrome'] },
  webServer: { command: 'node scripts/serve-static.mjs out 4173', url: `http://localhost:4173${base}/`, reuseExistingServer: !process.env.CI },
});

import { defineConfig, devices } from '@playwright/test';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
// Runs against the static export in out/; build it first (npm run build or build:pages).
// Reduced motion keeps the landing preview still: CI renders WebGL in software, and a spinning model starves the page.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Model checks and the first WebGL frame wait on software rendering in CI; 5 s is too tight on two cores.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:4173${base}/`, acceptDownloads: true, locale: 'ru-RU', contextOptions: { reducedMotion: 'reduce' }, ...devices['Desktop Chrome'] },
  webServer: { command: 'node scripts/serve-static.mjs out 4173', url: `http://localhost:4173${base}/`, reuseExistingServer: !process.env.CI },
});

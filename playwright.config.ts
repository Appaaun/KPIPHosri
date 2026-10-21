import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 180000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
  },
  workers: 1,
  reporter: 'list',
});

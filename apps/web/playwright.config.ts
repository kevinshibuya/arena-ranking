import { defineConfig, devices } from '@playwright/test';

// Run through `pnpm smoke`, which starts the stack and sets SMOKE_BASE_URL.
export default defineConfig({
  testDir: './smoke',
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    trace: 'retain-on-failure',
  },
  outputDir: '.smoke-results',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

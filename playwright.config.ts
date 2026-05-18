/**
 * Playwright end-to-end test configuration. Runs headless Chromium against
 * the ./e2e directory with a 30-second per-test timeout.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    headless: true,
  },
});

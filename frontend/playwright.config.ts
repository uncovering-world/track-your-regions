import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    // Record every first attempt and keep the recording only where that
    // attempt failed. `on-first-retry`, which this replaces, traces the
    // *retry* - and in the case worth reading, the flake, the retry is the
    // attempt that passed, so what survived explained nothing about the
    // failure (#447). Measured cost of tracing every first attempt: the
    // 11 smoke specs go from 2.9 min to 3.3 min on an idle machine, +14%,
    // which is what the numbers in the budget comment above already carry.
    trace: 'retain-on-first-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Without this, an action whose target never appears (e.g. a locator
    // for data that isn't in the database) inherits the full test-level
    // `timeout` above instead of failing on its own. Measured against this
    // suite, the slowest legitimate action - the fixture region button,
    // which waits on an API round trip plus a React re-render - takes under
    // 2s locally; 15s leaves ~8x headroom for slower/GPU-less CI runners
    // while staying well under the 60s test budget.
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'smoke',
      grep: /@smoke/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

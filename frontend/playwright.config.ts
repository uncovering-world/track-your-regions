import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  // Measured on an idle machine, 11 smoke specs against the isolated stack
  // and with the tracing below: 13.9s fastest, 47.3s slowest, most in the
  // thirties. Nearly all of it is the app load each spec pays; the
  // assertions themselves are a click and three expectations. At the
  // previous 60s budget the slowest spec sat at 58% of it - and that was
  // before tracing, which puts it at 79% - so an ordinary load spike (a
  // parallel Docker build, a Semgrep scan, a busy runner) was enough to fail
  // specs that were merely slow, which is what #447 recorded three times.
  // 120s leaves ~2.5x over the slowest measured spec and costs nothing on a
  // green run; only a spec that is genuinely stuck waits longer to say so.
  timeout: 120000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry wherever the lane runs: the specs execute inside the `e2e`
  // service, which sets CI=1 (docker-compose.test.yml), on a developer's
  // machine as much as on a runner. The bare 0 is for a direct `npx playwright
  // test` against a stack that is already up - a debugging shape, where a
  // failure should stand rather than be retried away. What a retry means is
  // decided in scripts/playwright-summary.mjs: a spec that passes on the
  // second attempt is flaky, reported by name, and does not fail the run.
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
    // 2s locally; 15s leaves ~8x headroom for slower/GPU-less CI runners.
    //
    // Deliberately not re-derived from the 120s spec budget above: the two
    // are set from different measurements - this one from what a single
    // action costs, that one from what a whole spec costs - and an action
    // window that tracked the budget would grow every time a spec got
    // slower. Measured under a load spike heavy enough to matter (a Semgrep
    // scan running beside the lane), a click did exceed this window; the
    // retry absorbed it and the run reported the spec as flaky, which is
    // the outcome that window is now allowed to have.
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

import { expect, test } from '@playwright/test';

// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const CURATOR = { email: 'curator@e2e.test', password: 'e2e-curator-password' };
const ARRIVALS = ['Testland Minster', 'Testland Chapel'];

/**
 * The first curator-side smoke spec, and the batch it exists for (#852): sign
 * in as the fixture's curator, tick the page of arrivals the gated source is
 * holding, accept them all, and read the line that says what happened.
 *
 * Signing in goes through the dialog a person uses rather than the API, so the
 * spec exercises the same door, and the review page through the header's own
 * button, which appears once the session is a curator's.
 */
test.describe('Review batch @smoke', () => {
  // The one smoke spec that writes catalogue state, and a write cannot be
  // retried on the same seed: the fixture is seeded once per run, before
  // Playwright starts, and an accepted arrival never returns to `pending`, so
  // a second attempt would wait for a question that is no longer there and
  // fail for a reason that says nothing about the first attempt. Better one
  // honest attempt, whose trace is the record, than a retry that cannot pass.
  // Re-seeding between attempts would need the lane to expose the seed to
  // this container, which it does not today.
  test.describe.configure({ retries: 0 });

  test('a curator accepts a page of arrivals at once', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByLabel('Email').fill(CURATOR.email);
    await page.getByLabel('Password').fill(CURATOR.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign In' })).not.toBeVisible();

    // The header offers the review page once the session is a curator's; a
    // `goto('/review')` would reload the app and race the session's restore.
    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page).toHaveURL(url => new URL(url).pathname === '/review');
    // Both arrivals are questions, and each row carries its box.
    for (const name of ARRIVALS) {
      await expect(page.getByRole('checkbox', { name: `Select ${name}` })).toBeVisible();
    }

    await page.getByRole('checkbox', { name: 'Select the 2 questions loaded' }).click();
    const bar = page.getByRole('region', { name: 'Selected questions' });
    await expect(bar).toContainText('2 arrivals');

    await bar.getByRole('button', { name: 'Accept the proposed changes' }).click();

    // The line afterwards, and the list emptied behind it: two objects nobody
    // had passed are visible to readers now, each with its one point.
    await expect(page.getByText('2 objects published. 2 points now visible.')).toBeVisible();
    await expect(page.getByText('Nothing waiting. Every flagged object has been answered.')).toBeVisible();
    await expect(bar).not.toBeVisible();
  });
});

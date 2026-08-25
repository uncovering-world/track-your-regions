import { expect, test } from '@playwright/test';

// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const FIXTURE_WORLD_VIEW = 9001;

/**
 * The whole path, never a suffix: `/wv/9001` is a suffix of
 * `/discover/wv/9001`, so a suffix match would let the Map assertion pass with
 * Discover still open — the exact confusion these two assertions exist to catch.
 */
async function expectPath(page: import('@playwright/test').Page, path: string) {
  await expect(page).toHaveURL(url => new URL(url).pathname === path);
}

test.describe('Shell Navigation @smoke', () => {
  test('can switch between Map and Discover views', async ({ page }) => {
    // A bare `/` adopts a world view and names it, since only the default one
    // writes no segment and the fixture's is not the default (#644). Nothing
    // under an unnamed world view could be addressed at all, so the root gains
    // the address and the header then carries it across both views.
    await page.goto('/');
    await expectPath(page, `/wv/${FIXTURE_WORLD_VIEW}`);

    await expect(page.getByRole('heading', { name: 'Track Your Regions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Map' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discover' })).toBeVisible();

    await page.getByRole('button', { name: 'Discover' }).click();
    await expectPath(page, `/discover/wv/${FIXTURE_WORLD_VIEW}`);
    await expect(page.getByText('Select a category in the tree')).toBeVisible();

    await page.getByRole('button', { name: 'Map' }).click();
    await expectPath(page, `/wv/${FIXTURE_WORLD_VIEW}`);
    await expect(page.getByText('Select a region')).toBeVisible();
  });

  test('can open and close sign in dialog', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Sign In' })).not.toBeVisible();
  });
});

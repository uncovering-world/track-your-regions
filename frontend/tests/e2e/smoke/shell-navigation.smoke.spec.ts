import { expect, test } from '@playwright/test';

test.describe('Shell Navigation @smoke', () => {
  test('can switch between Map and Discover views', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Track Your Regions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Map' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discover' })).toBeVisible();

    await page.getByRole('button', { name: 'Discover' }).click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page.getByText('Select a category in the tree')).toBeVisible();

    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page).toHaveURL(/\/$/);
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

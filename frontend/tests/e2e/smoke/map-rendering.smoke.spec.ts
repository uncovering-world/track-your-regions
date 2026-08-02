import { expect, type Page, test } from '@playwright/test';

/**
 * The gap these close: every other smoke spec asserts the DOM *around* the map —
 * headings, panels, buttons, counts — so all of them passed while the map was
 * blank on a machine without WebGL. Nothing anywhere claimed a map had actually
 * been painted.
 *
 * Playwright's headless Chromium ships WebGL through SwiftShader with no launch
 * flags (verified: ANGLE / Vulkan / SwiftShader), so a real canvas is the
 * correct expectation here rather than an aspiration — if one fails to appear,
 * the map genuinely did not mount.
 */

// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const FIXTURE_WORLD_VIEW = 9001;
const FIXTURE_REGION = 'Testland';

/** MapLibre puts this class on the canvas it draws into; no canvas, no map. */
const MAP_CANVAS = 'canvas.maplibregl-canvas';

async function expectPaintedMap(page: Page) {
  const canvas = page.locator(MAP_CANVAS).first();
  await expect(canvas).toBeVisible();

  // A canvas that exists at zero size is the shape a broken mount leaves
  // behind, and it would satisfy a bare presence check.
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // The other half of the assertion: the fallback must be absent. Without this
  // the test would still pass on a page that explained itself instead of
  // drawing, which is precisely the state we now render deliberately.
  await expect(page.getByText("The map can't be displayed")).toHaveCount(0);
}

test.describe('Map rendering @smoke', () => {
  test('map mode paints a map canvas', async ({ page }) => {
    await page.goto('/?wv=' + FIXTURE_WORLD_VIEW);

    await expectPaintedMap(page);

    // Repeated after a region is chosen, and worth being exact about what that
    // proves: selection re-renders the map's sources, and this catches the
    // canvas being torn out — an unmount, a throw during the re-render. It does
    // NOT prove the new tiles painted, which would need the map instance's
    // ready state, and the app exposes no handle to it. That is a separate
    // test, not a stronger version of this one.
    await page.getByRole('button', { name: FIXTURE_REGION }).click();
    await expect(page.getByRole('heading', { level: 2 })).not.toHaveText('Select a region');
    await expectPaintedMap(page);
  });

  test('discover mode paints a map canvas', async ({ page }) => {
    await page.goto('/discover?wv=' + FIXTURE_WORLD_VIEW);

    await expect(page.getByText('Select a category in the tree')).toBeVisible();
    await expectPaintedMap(page);
  });
});

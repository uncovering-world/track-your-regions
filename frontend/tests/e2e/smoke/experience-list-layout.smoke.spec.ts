import { expect, test } from '@playwright/test';

// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const FIXTURE_WORLD_VIEW = 9001;
const FIXTURE_REGION = 'Testland';

/**
 * The windowed list positions every row absolutely, so a row whose height the
 * virtualiser has not learned yet is a row drawn on top of its neighbour. Opening
 * a card is exactly that moment: the row grows by some 560 px in one commit, and
 * `measureElement` reports through a `ResizeObserver`, which runs after layout.
 * Measured on the live list before the fix, the row below an opening card was
 * drawn 702 px inside it — its title printed across the card's picture.
 *
 * This asserts the invariant rather than the mechanism: no row may overlap the
 * next, at any frame, while a card is opening.
 */
type Overlap = { worst: number; above: number; below: number; aboveHeight: number };

async function worstOverlap(page: import('@playwright/test').Page): Promise<Overlap> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-index]')]
      .sort((a, b) => Number((a as HTMLElement).dataset.index) - Number((b as HTMLElement).dataset.index));
    let out = { worst: 0, above: -1, below: -1, aboveHeight: 0 };
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1].getBoundingClientRect();
      const b = rows[i].getBoundingClientRect();
      const overlap = Math.round(a.bottom - b.top);
      if (overlap > out.worst) {
        out = {
          worst: overlap,
          above: Number((rows[i - 1] as HTMLElement).dataset.index),
          below: Number((rows[i] as HTMLElement).dataset.index),
          aboveHeight: Math.round(a.height),
        };
      }
    }
    return out;
  });
}

test.describe('Experience list layout @smoke', () => {
  test('no row is ever drawn over the row below it while a card opens', async ({ page }) => {
    await page.goto('/?wv=' + FIXTURE_WORLD_VIEW);
    await page.getByRole('button', { name: FIXTURE_REGION }).click();
    await page.getByRole('button', { name: 'Explore experiences in this region' }).click();
    await expect(page.getByText(/World Heritage Sites \(\d+\)/)).toBeVisible();

    const rows = page.locator('[data-index]');
    await expect(rows.first()).toBeVisible();
    const before = await worstOverlap(page);
    expect(before.worst, 'rows must not overlap before anything is opened').toBeLessThanOrEqual(1);

    // Recorded frame by frame, in the page, because the fault this guards against
    // can last a single frame: the row grows in the mutation phase, the browser
    // lays the rows below out at offsets computed for a collapsed one, paints, and
    // only then does the `ResizeObserver` correct it. Polling from the test — even
    // every 50 ms — steps straight over 16 ms of a title printed across a picture.
    const target = rows.nth(1);
    const targetIndex = Number(await target.getAttribute('data-index'));
    const collapsedHeight = (await target.boundingBox())?.height ?? 0;

    await page.evaluate(() => {
      const w = window as unknown as { __overlaps: number[] };
      w.__overlaps = [];
      let frames = 0;
      const tick = () => {
        const rows = [...document.querySelectorAll('[data-index]')]
          .sort((a, b) => Number((a as HTMLElement).dataset.index) - Number((b as HTMLElement).dataset.index));
        let worst = 0;
        for (let i = 1; i < rows.length; i++) {
          const above = rows[i - 1].getBoundingClientRect();
          const below = rows[i].getBoundingClientRect();
          worst = Math.max(worst, above.bottom - below.top);
        }
        w.__overlaps.push(Math.round(worst));
        if (++frames < 240) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await target.locator('.MuiListItem-root').first().click();
    await page.waitForTimeout(3000);

    const frames = await page.evaluate(() => (window as unknown as { __overlaps: number[] }).__overlaps);
    const worstFrame = Math.max(0, ...frames);
    const overlapFrames = frames.filter((v) => v > 1).length;

    // Not an absolute height: the fixture's experiences carry no picture and no
    // description, so an opened card here is 81 px where a real one is 550-850.
    // What must be true either way is that the row grew and now holds a card,
    // or the frames below were recorded of a list that never moved.
    const tallestRow = await page.evaluate((index) => {
      const row = document.querySelector(`[data-index="${index}"]`);
      return row ? Math.round(row.getBoundingClientRect().height) : 0;
    }, targetIndex);
    expect(tallestRow, 'the click must actually open a card').toBeGreaterThan(collapsedHeight + 10);
    await expect(target.locator('[data-experience-card]')).toHaveCount(1);

    expect(
      worstFrame,
      `a row was drawn inside its neighbour — the card printing over it, in ${overlapFrames} of ${frames.length} frames`,
    ).toBeLessThanOrEqual(1);
  });
});

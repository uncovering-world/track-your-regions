/**
 * Whether a row of the crowded-city window's table is in view, and the one way
 * the window brings a row there: to its nearest edge, so a table already
 * showing the row does not move (#2486, #2576).
 */

/**
 * Whether a row stands outside the screen or outside a box that scrolls around it, or under what
 * sticks to their edges: the table's headings above it and the Apply bar below, which the row's own
 * scroll margins measure (`ROW_SCROLL_MARGINS`), so a row brought into view is never left under them.
 */
export function outOfView(row: HTMLElement): boolean {
  const rect = row.getBoundingClientRect();
  const margins = window.getComputedStyle(row);
  const top = rect.top - (parseFloat(margins.scrollMarginTop) || 0);
  const bottom = rect.bottom + (parseFloat(margins.scrollMarginBottom) || 0);
  let shownTop = 0;
  let shownBottom = window.innerHeight;
  for (let box = row.parentElement; box; box = box.parentElement) {
    const { overflowY } = window.getComputedStyle(box);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const edges = box.getBoundingClientRect();
    shownTop = Math.max(shownTop, edges.top);
    shownBottom = Math.min(shownBottom, edges.bottom);
  }
  return top < shownTop || bottom > shownBottom;
}

/**
 * What a row keeps clear when it is scrolled to: the table's sticky headings above it, and from a
 * tablet's width the window's sticky Apply bar below it (`CrowdedCities.tsx`), two lines high.
 */
export const ROW_SCROLL_MARGINS = { scrollMarginTop: '3rem', scrollMarginBottom: { xs: '1rem', md: '6rem' } } as const;

/** The row scrolled to its nearest edge, only where it is out of view. */
export function bringIntoView(row: HTMLElement | null): void {
  if (row && outOfView(row)) row.scrollIntoView({ block: 'nearest' });
}

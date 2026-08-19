/**
 * One row of the windowed experience list, placed where the virtualiser says.
 *
 * Measurement is the library's: the ref reports the element, and a `ResizeObserver`
 * reports changes. That observer runs *after* layout, which is one frame too late
 * for the commit that opens a card — the row grows by some 560 px while its
 * neighbours still sit at offsets computed for a collapsed one, and the row below
 * is drawn inside the card, printing its title across the picture. Measured on the
 * live list, that overlap reached 702 px.
 *
 * The pre-paint measurement that closes it cannot live here: this component has no
 * state, so React does not re-render it in the commit where a card opens — only
 * `ExperienceListItem`, which owns the readiness the card waits on. It measures its
 * own row in a layout effect and hands it to the virtualiser, and
 * `experience-list-layout.smoke.spec.ts` samples every frame to keep it honest.
 */

import { useCallback } from 'react';
import { Box } from '@mui/material';
import type { Virtualizer } from '@tanstack/react-virtual';

interface VirtualRowProps {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  index: number;
  /** Offset from the list's top, as the virtualiser currently understands it. */
  start: number;
  children: React.ReactNode;
}

/**
 * Places one row at the offset the virtualiser holds for it, and registers it with
 * the library's own `measureElement`. The pre-paint measurement a card opening
 * needs is driven from `ExperienceListItem` — see the note at the top of the file
 * for why it cannot be done here.
 */
export function VirtualRow({ virtualizer, index, start, children }: VirtualRowProps) {
  /**
   * Stable, and that is the whole point.
   *
   * Written inline, this is a new function on every render, so React detaches and
   * reattaches the ref each time — calling `measureElement(null)` and then
   * `measureElement(el)`, and that second call reads `getBoundingClientRect()`.
   * Every mounted row therefore forced a synchronous layout on every render of
   * the list, including the open card, which is the tallest thing on the page.
   *
   * Measured in the browser on the Historic Centre of Saint Petersburg: hovering
   * its places blocked the main thread for **600-860 ms per hover**, which is the
   * stutter the list was reported for. A unit test could not see it — jsdom has
   * no layout, so `getBoundingClientRect` there is free, and the same hover
   * measured 10 ms.
   */
  const measure = useCallback((el: HTMLLIElement | null) => {
    virtualizer.measureElement(el);
  }, [virtualizer]);

  return (
    <Box
      component="li"
      data-index={index}
      ref={measure}
      sx={{
        listStyle: 'none',
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${start}px)`,
      }}
    >
      {children}
    </Box>
  );
}

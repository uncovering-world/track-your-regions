/**
 * One row of a windowed list, placed where the virtualiser says. Shared by the
 * map-mode experience list and Discover's — each owns its virtualiser and hands
 * this the placement.
 *
 * Measurement is the library's: the ref reports the element, and a `ResizeObserver`
 * reports changes. That observer runs *after* layout, which is one frame too late
 * for the commit that opens a card — the row grows by some 560 px while its
 * neighbours still sit at offsets computed for a collapsed one, and the row below
 * is drawn inside the card, printing its title across the picture. Measured on the
 * live list, that overlap reached 702 px.
 *
 * The pre-paint measurement that closes *that* cannot live here: this component
 * has no state of its own, so React does not re-render it in the commit where a
 * card opens — only `ExperienceListItem`, which owns the readiness the card waits
 * on. It measures its own row in a layout effect and hands it to the virtualiser,
 * and `experience-list-layout.smoke.spec.ts` samples every frame to keep it honest.
 * The one pre-paint measurement this component does make is on a change of its
 * own `index` — see the layout effect below (#1914).
 */

import { useCallback, useLayoutEffect, useRef } from 'react';
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
 * Places one row at the offset the virtualiser holds for it, registers it with
 * the library's own `measureElement`, and measures it again, before paint, when
 * it moves to another index. The pre-paint measurement a card opening needs is
 * driven from `ExperienceListItem` — see the note at the top of the file for why
 * it cannot be done here.
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
   * stutter the list was reported for. A unit test cannot see it: happy-dom has
   * no layout, so `getBoundingClientRect` there costs nothing.
   */
  const element = useRef<HTMLLIElement | null>(null);
  const measure = useCallback((el: HTMLLIElement | null) => {
    element.current = el;
    virtualizer.measureElement(el);
  }, [virtualizer]);

  // A row that has moved to another index is measured again, before paint,
  // under the index it now carries (#1914). The virtualiser files a height
  // under the key of whatever row holds the element's `data-index` at the
  // moment it reads it, and `useVirtualizer` hands it the new row order during
  // render, before this commit writes the new `data-index`. A render the
  // router's `startTransition` lets yield — a card opening above the groups
  // shifts every row below it — leaves a window in which a `ResizeObserver`
  // report for one row (a header whose chips re-wrap) is filed under its
  // neighbour's key, and nothing later corrects either: the header keeps its
  // closed height and the first place of its kind is drawn across its chips.
  // Only on a change of index, so a hover's re-render still forces no layout.
  //
  // The misfiled report also left the element in the virtualiser's
  // `elementsCache` under the neighbour's key, and `_measureElement` reads that
  // cache to decide what to observe: the neighbour's own measurement would find
  // this element under its key and *unobserve* it, and this row's would find
  // itself under its own key and skip observing — so the height would be right
  // once and never reported again. Every entry pointing at this element goes
  // first, so the measurement observes it afresh and the neighbour's finds
  // nothing of ours to unobserve.
  const measuredAt = useRef(index);
  useLayoutEffect(() => {
    if (measuredAt.current === index) return;
    measuredAt.current = index;
    const el = element.current;
    if (!el) return;
    for (const [key, node] of virtualizer.elementsCache) {
      if (node === el) virtualizer.elementsCache.delete(key);
    }
    virtualizer.measureElement(el);
  }, [virtualizer, index]);

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

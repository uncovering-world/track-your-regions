import { useLayoutEffect, useState } from 'react';

/**
 * Where a windowed list starts inside its scroll container, which is not its
 * top: whatever stands above the list (a curator's "add a kind" box, 47 px on
 * Europe; "Nothing in this view."; the Undo of an untick, its chunk arriving
 * after the line was asked for) pushes it down. The virtualiser counts its
 * range and `scrollToIndex` from the container's top, so it is given that
 * distance (#556).
 *
 * Measured whenever the box holding what stands above the list changes size,
 * observed rather than listed: a new element above the list moves the
 * measurement by being there. `offsetTop` counts from the nearest positioned
 * ancestor, which is why `RegionDescriptionSection` makes the scroll
 * container `position: relative`, and it is read when the box resizes rather
 * than during render, so a hover's re-render forces no layout. The two
 * elements are held as state, set by their refs, since the list is not drawn
 * while the region loads or holds nothing: the observer starts when both are
 * there.
 */
export function useListStart<Above extends HTMLElement, List extends HTMLElement>() {
  const [above, aboveRef] = useState<Above | null>(null);
  const [list, listRef] = useState<List | null>(null);
  const [listStart, setListStart] = useState(0);
  useLayoutEffect(() => {
    if (!above || !list) return undefined;
    const measure = () => setListStart(list.offsetTop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(above);
    return () => observer.disconnect();
  }, [above, list]);
  return { aboveRef, listRef, listStart };
}

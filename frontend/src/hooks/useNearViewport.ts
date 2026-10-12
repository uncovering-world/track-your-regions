/**
 * Whether an element is on screen or close to it — what lets a list of cards
 * each own a map without holding a WebGL context per card.
 *
 * Browsers keep about a dozen WebGL contexts per tab and evict the oldest past
 * that, which blanks a map and reads as a rendering bug. A card that mounts its
 * map only while it is near the viewport, and unmounts it once scrolled away,
 * keeps the live count to the few cards a screen shows, however long the list.
 *
 * Where the browser has no `IntersectionObserver` (the test DOM), every element
 * counts as near: the map's own WebGL guard decides there.
 */

import { useEffect, useState, type RefObject } from 'react';

export function useNearViewport(ref: RefObject<Element | null>, margin = '300px'): boolean {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      entries => setNear(entries.some(entry => entry.isIntersecting)),
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin]);
  return near;
}

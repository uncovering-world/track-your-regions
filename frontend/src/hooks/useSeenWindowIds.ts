/**
 * Which experiences the reader's window has actually held, accumulated.
 *
 * Windowing is what makes New-badge impressions answerable, and also what makes
 * this hook necessary wherever a list is windowed: before it, rendering a group
 * of 467 stamped all 467 as seen while the reader had passed ten, and the
 * server keeps the *first* impression — so those rows spent the reader's
 * personal week unseen, which is precisely what that week exists to prevent.
 * Accumulated rather than "in view now", because scrolling away does not unsee
 * a row. Shared by the map-mode experience list and Discover's (#573).
 *
 * State rather than a ref, so callers' memos have something real to depend on:
 * a ref mutated in place tells React nothing, and the impressions call would
 * keep reporting the previous set.
 *
 * Flushed on a timer rather than per render, which is what windowing costs
 * here: the set used to change once per region and now changes as the reader
 * scrolls, and each change is a request. `authenticatedLimiter` allows 60 a
 * minute per IP across every authenticated call, and a curator publishing a
 * sync's arrivals in one go is precisely how a region comes to hold hundreds of
 * rows carrying the mark. Ids accumulate between flushes, so this bounds how
 * often the rows are reported, never which of them are.
 *
 * The reset tracker is state, not a ref, which is what makes it restart-safe:
 * the reset key arrives through navigation, which React Router pushes in a
 * transition — a render React may discard and replay. A ref is shared with the
 * committed fiber, so it would keep the new key across a discard while the
 * queued reset went with the discarded tree; state is queued on the same
 * work-in-progress tree as the reset, so the two are discarded and replayed
 * together. The reset runs during render for the same reason the map-mode list
 * resets during render: one commit carrying region B's rows against region A's
 * seen-set would report impressions for rows nobody has seen, and the server
 * keeps the first one.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * How often, at most, the rows the window has held are reported as seen.
 *
 * Long enough that a scroll through a freshly published region is a handful of
 * requests rather than one per render, short enough that a reader who glances
 * and leaves has still been counted.
 */
const SEEN_FLUSH_MS = 800;

/**
 * `resetKey` is compared with `!==`, so it must be a primitive: an object or an
 * array rebuilt per render would never equal the tracked one, and the set would
 * reset on every render instead of ever accumulating.
 */
export function useSeenWindowIds(idsInWindow: number[], resetKey: string | number | null): Set<number> {
  const [seenIds, setSeenIds] = useState<Set<number>>(() => new Set());
  // Rows seen since the last flush, and the flush itself. Cleared by the
  // render-phase reset below, or region A's rows would be reported once the
  // timer came round against region B's list.
  const pendingSeen = useRef<Set<number>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [trackedKey, setTrackedKey] = useState(resetKey);
  if (resetKey !== trackedKey) {
    setTrackedKey(resetKey);
    setSeenIds(new Set());
    pendingSeen.current = new Set();
  }

  useEffect(() => {
    const fresh = idsInWindow.filter(id => !seenIds.has(id) && !pendingSeen.current.has(id));
    for (const id of fresh) pendingSeen.current.add(id);
    if (pendingSeen.current.size === 0 || flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const batch = pendingSeen.current;
      pendingSeen.current = new Set();
      // Empty when a reset cleared the pending set while this was in flight;
      // setting state anyway would report the new list against a set that
      // gained nothing.
      if (batch.size === 0) return;
      setSeenIds(prev => {
        const next = new Set(prev);
        for (const id of batch) next.add(id);
        return next;
      });
    }, SEEN_FLUSH_MS);
  }, [idsInWindow, seenIds]);

  // A flush landing after the list is gone belongs to nobody.
  useEffect(() => () => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    pendingSeen.current = new Set();
  }, []);

  return seenIds;
}

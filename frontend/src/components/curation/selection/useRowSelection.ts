/**
 * Which rows a curator has ticked, and the three ways of ticking them (#852).
 *
 * The selection is transient on purpose — not a query parameter, unlike the
 * filters, the order and the open row (ADR-0051 decision 5). Those name a
 * *list* and a *question*, which a link should reopen; a set of ticks names
 * work in progress, which a link should not replay onto whoever follows it,
 * and Back through forty ticks would be forty steps. It survives *Show more*
 * (the rows stay, the ticks stay) and is cleared, with a notice, when a filter
 * or the search changes: the ticks were made against a list that no longer
 * exists.
 *
 * The three ways: a click toggles one row; shift-click extends from the last
 * row clicked to this one, over the rows *as loaded* — the range is what the
 * curator can see; the header's tri-state box ticks or clears every loaded
 * row. `allMatching` is the fourth thing a selection can be — every row the
 * current filters match, past the loaded pages — and it is a flag over the
 * page's ticks rather than a set of keys, since the client does not hold them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueRow } from '../queueRows';

export interface RowSelection {
  /** The keys ticked, in no order. */
  keys: ReadonlySet<string>;
  /** Every row the filters match, not only the loaded ones. */
  allMatching: boolean;
  /** Toggle one row; with `range`, tick every loaded row between the anchor and it. */
  toggle: (key: string, range?: boolean) => void;
  /** Tick or clear every loaded row. */
  setLoaded: (checked: boolean) => void;
  selectAllMatching: () => void;
  clear: () => void;
}

export function useRowSelection(
  rows: QueueRow[],
  /** The filters as one string — the page's `queue.filterKey`. A change clears the ticks. */
  filterKey: string,
  /** Told when the ticks were cleared because the list changed under them. */
  onCleared: (count: number) => void,
): RowSelection {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const anchor = useRef<string | null>(null);

  // The list changed: clear, and say so if there was anything to clear. The
  // count is read from a ref rather than inside the updater — an updater
  // must be pure, and StrictMode runs it twice — and the ref still holds the
  // previous filter's ticks when this runs: the prune effect below is
  // declared after it, so it commits later.
  const ticked = useRef(keys);
  ticked.current = keys;
  // The same shape for `allMatching`, and for a reason the prune effect below
  // depends on: a filter the curator visited in the last minute answers from
  // the query cache in the same render as the key change, so `rows` and
  // `filterKey` move in one commit and both effects run. The prune effect's
  // closure would still hold the render-time `allMatching`, and re-tick the
  // *new* list right after this effect said the ticks were cleared — unless it
  // reads the ref this effect clears first.
  const wholeList = useRef(allMatching);
  wholeList.current = allMatching;
  const previousFilter = useRef(filterKey);
  useEffect(() => {
    if (previousFilter.current === filterKey) return;
    previousFilter.current = filterKey;
    const count = ticked.current.size;
    if (count > 0 || wholeList.current) onCleared(count);
    wholeList.current = false;
    setKeys(new Set());
    setAllMatching(false);
    anchor.current = null;
  }, [filterKey, onCleared]);

  // A row that left the list — answered by someone else, or by this batch —
  // leaves the selection with it, so the count never names a row the curator
  // cannot see. Not on a stale read: the caller passes the rows it is
  // showing, and through a filter change those are the previous list's until
  // the effect above has cleared everything anyway.
  useEffect(() => {
    setKeys(current => {
      // An all-matching selection is every row the filters match, so a row
      // *Show more* brings in is ticked the moment it arrives — the batch
      // answers it either way, and a box drawn empty would say otherwise.
      // Read off the ref, never the closure: see the note on `wholeList`.
      if (wholeList.current) {
        const every = new Set(rows.map(r => r.key));
        return every.size === current.size && [...every].every(key => current.has(key)) ? current : every;
      }
      const present = new Set(rows.map(r => r.key));
      const kept = [...current].filter(key => present.has(key));
      if (kept.length === current.size) return current;
      return new Set(kept);
    });
  }, [rows, allMatching]);

  const toggle = useCallback((key: string, range = false) => {
    // Read before the updater runs: React applies it lazily, by which time the
    // anchor below is already this key.
    const from = anchor.current;
    setKeys(current => {
      const next = new Set(current);
      if (range && from !== null && from !== key) {
        const a = rows.findIndex(r => r.key === from);
        const b = rows.findIndex(r => r.key === key);
        if (a >= 0 && b >= 0) {
          for (const row of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(row.key);
          return next;
        }
      }
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    anchor.current = key;
    // Ticking by hand narrows an all-matching selection back to the ticks.
    setAllMatching(false);
  }, [rows]);

  const setLoaded = useCallback((checked: boolean) => {
    setKeys(checked ? new Set(rows.map(r => r.key)) : new Set());
    setAllMatching(false);
    anchor.current = null;
  }, [rows]);

  const selectAllMatching = useCallback(() => {
    setKeys(new Set(rows.map(r => r.key)));
    setAllMatching(true);
  }, [rows]);

  const clear = useCallback(() => {
    setKeys(new Set());
    setAllMatching(false);
    anchor.current = null;
  }, []);

  return { keys, allMatching, toggle, setLoaded, selectAllMatching, clear };
}

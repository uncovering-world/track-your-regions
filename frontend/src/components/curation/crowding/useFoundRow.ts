/**
 * The row a dot of the crowded-city map finds (#2576): the place whose dot the
 * pointer, or keyboard focus, rests on, once it has rested there a moment, so
 * a pointer crossing the map on its way to a dot moves no row. Leaving the dot
 * clears it, and the table stays where it is.
 *
 * Bringing the row into view can scroll the page while the map pane is not
 * yet stuck to the top, which moves the map under a pointer that did not
 * move: the browser then says the pointer left its dot, and may say it entered
 * whichever dot now lies under it. Both are the table's doing, not the
 * curator's. A pointer's leave after the pane moved keeps the mark, and a
 * pointer's enter is ignored until the pointer itself has moved from where it
 * stood then. Keyboard focus is never moved by a scroll, so its blur clears
 * the mark and its focus finds a row, whatever the pane did.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DotHover } from './CrowdingMap';

/** How long the pointer rests on a dot before its row is brought into view. */
export const FIND_AFTER_MS = 250;

interface Point { x: number; y: number }

/** How far, in pixels, the pointer moves before it counts as the curator's move again. */
const STILL_PX = 2;

export function useFoundRow(mapPane: RefObject<HTMLElement | null>) {
  const [found, setFound] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Where the map pane stood when the row was found; null while none is.
  const paneTop = useRef<number | null>(null);
  // Where the pointer is now, as its last move put it.
  const pointer = useRef<Point | null>(null);
  // Set while the map has moved under a pointer that stayed: where that pointer stood (null where no
  // move of it was seen yet), and the dot the map brought under it, whose enter waits for the pointer
  // to move. Cleared once the pointer itself moves.
  const held = useRef<{ at: Point | null; waiting: number | null } | null>(null);
  /** The row of `membershipId` found once the pointer has rested on its dot. */
  const findAfterRest = useCallback((membershipId: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      paneTop.current = mapPane.current?.getBoundingClientRect().top ?? null;
      setFound(membershipId);
    }, FIND_AFTER_MS);
  }, [mapPane]);
  useEffect(() => {
    const track = (event: PointerEvent) => {
      const at = { x: event.clientX, y: event.clientY };
      pointer.current = at;
      const kept = held.current;
      if (!kept) return;
      const from = kept.at;
      if (from && Math.abs(at.x - from.x) < STILL_PX && Math.abs(at.y - from.y) < STILL_PX) return;
      held.current = null;
      // The pointer moved within the dot the map brought under it, which sends no second enter:
      // that dot is now the curator's to rest on.
      if (kept.waiting !== null) findAfterRest(kept.waiting);
    };
    window.addEventListener('pointermove', track, { passive: true });
    return () => {
      window.removeEventListener('pointermove', track);
      clearTimeout(timer.current);
    };
  }, [findAfterRest]);
  /** The dot the map's pointer or focus is on now, or null where it left them. */
  const rest = useCallback((membershipId: number | null, by: DotHover) => {
    clearTimeout(timer.current);
    if (membershipId === null) {
      if (held.current) held.current.waiting = null;
      const top = mapPane.current?.getBoundingClientRect().top ?? null;
      const moved = by === 'pointer' && paneTop.current !== null && top !== null && Math.abs(top - paneTop.current) > 1;
      paneTop.current = null;
      if (moved) {
        // The map moved under a pointer that stayed: the dot left it, not the other way round.
        held.current = { at: pointer.current, waiting: null };
        return;
      }
      setFound(null);
      return;
    }
    // A dot the map brought under a pointer that has not moved since is no find of the curator's yet.
    if (by === 'pointer' && held.current) {
      held.current.waiting = membershipId;
      return;
    }
    findAfterRest(membershipId);
  }, [mapPane, findAfterRest]);
  /** Clear the mark and anything pending, as when a place opens. */
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    paneTop.current = null;
    held.current = null;
    setFound(null);
  }, []);
  return { found, rest, clear };
}

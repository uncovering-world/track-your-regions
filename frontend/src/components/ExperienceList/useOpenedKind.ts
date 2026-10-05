/**
 * The kind a place's card was opened from, for a place in several kinds
 * (#1245): the card opens in that kind's row of the region's list
 * (`kindRows.ts`).
 *
 * Held with the place it was opened for, and forgotten only once the
 * selection has actually moved — closed, or another place chosen from the map
 * or the address. Not on any render where the selection merely has not arrived
 * yet: the selection is the address, which the router delivers in a
 * transition (`useAppAddress.ts` § `currentRef`), so the render right after a
 * click still reads the previous selection, and a reset there would throw the
 * clicked kind away before the card opened.
 */

import { useCallback, useEffect, useState } from 'react';

export function useOpenedKind(selectedExperienceId: number | null): {
  openedKindId: number | null;
  /** A row of `placeId` in `kindId` was clicked to open its card, or to move it there. */
  openFrom: (placeId: number, kindId: number) => void;
} {
  const [openedIn, setOpenedIn] = useState<{ placeId: number; kindId: number } | null>(null);

  useEffect(() => {
    setOpenedIn(prev => (prev !== null && prev.placeId === selectedExperienceId ? prev : null));
  }, [selectedExperienceId]);

  const openFrom = useCallback((placeId: number, kindId: number) => setOpenedIn({ placeId, kindId }), []);

  return {
    openedKindId: openedIn !== null && openedIn.placeId === selectedExperienceId ? openedIn.kindId : null,
    openFrom,
  };
}

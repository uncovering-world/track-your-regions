import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewAddress } from '../../../utils/appUrl';
import {
  nextOnMap, placeOfRow, type MapOrigin, type MapStep,
} from './queueMapData';
import { useQueueMapRead } from './useQueueMapRead';

/**
 * The review page's walk on the map after an answer (#2477): the nearest open question the
 * map holds, rather than the list's next row (`nextOnMap`).
 *
 * - **The read** is the map's own (`useQueueMapRead`), enabled only while the map is shown,
 *   and only an answer the chips' current read gives counts, never the previous chips'.
 * - **Where the walk starts.** The question open on the map is kept with its place's point,
 *   across the refresh that takes the place off the map once it is answered.
 * - **`nextAfterAnswer`** answers the row to open once the open one has left the list. It
 *   walks only from the row the map had open, whose point it knows; a row it never had open,
 *   a link to an answered question among them, and every row in the list's view take the
 *   list's choice. Undefined when the map holds no other open question: nothing opens.
 * - **`step`** is where the last walk went, while the question it opened is still open.
 */
export function useMapWalk(address: ReviewAddress, selected: string | null, mapOpen: boolean) {
  const { read } = useQueueMapRead(address, mapOpen);
  const places = mapOpen && !read.isPlaceholderData ? read.data?.places : undefined;

  const openOnMap = useRef<MapOrigin | null>(null);
  useEffect(() => {
    if (selected === null) return;
    const placeId = placeOfRow(selected);
    const place = places?.find(p => p.placeId === placeId);
    if (place) openOnMap.current = { row: selected, placeId: place.placeId, lon: place.lon, lat: place.lat };
    // Kept for the same row while the read no longer holds its place.
    else if (openOnMap.current?.row !== selected) openOnMap.current = null;
  }, [selected, places]);

  const [step, setStep] = useState<MapStep | null>(null);
  const answeredRow = address.row;
  const nextAfterAnswer = useCallback((listChoice: () => string | undefined): string | undefined => {
    const from = openOnMap.current;
    if (!places || from === null || from.row !== answeredRow) return listChoice();
    const next = nextOnMap(places, from);
    landed.current = false;
    setStep(next);
    return next?.row;
  }, [places, answeredRow]);

  // The line belongs to the walk just made: once the selection has landed on the step's row and
  // moved off it, by a click or by Back, the step is over and does not come back with the row.
  const landed = useRef(false);
  useEffect(() => {
    if (step === null) return;
    if (address.row === step.row) landed.current = true;
    else if (landed.current) {
      landed.current = false;
      setStep(null);
    }
  }, [address.row, step]);

  return { step: step?.row === address.row ? step : null, nextAfterAnswer };
}

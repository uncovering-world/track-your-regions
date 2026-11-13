import { useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { lazyChunk } from '../../utils/lazyChunk';
import { ChunkBoundary } from './ChunkBoundary';
import { drawRemovalIn, handleTicks, isCurrentOrigin, useDateLineAt, useRemovedVisits } from './visitRemovals';

/** The chunk once it has arrived, so forgetting a traveller reaches its offer without fetching it. */
let arrived: typeof import('./trips/visitTrips') | undefined;
const loadVisitTrips = () => import('./trips/visitTrips').then(chunk => { arrived = chunk; return chunk; });
const VisitTripsChunk = lazyChunk(loadVisitTrips);

/**
 * A place's trips on its card (#2120), fetched with the card's first opening
 * by a signed-in traveller. Keyed on the traveller and the place, so what the
 * section holds of one place (a removed trip's Undo, a date being changed)
 * never reaches the next one a card steps to, or another traveller.
 */
export function LazyTripsSection({ experienceId }: { experienceId: number }) {
  const { user } = useAuth();
  return (
    <ChunkBoundary>
      <VisitTripsChunk key={`${user?.id}:${experienceId}`} part="trips" experienceId={experienceId} />
    </ChunkBoundary>
  );
}

/**
 * The Undo of the signed-in traveller's last untick that removed trips, drawn
 * where a list stands (`scope` names what it shows), fetched the first time
 * there is one. The list's region is given to the removal here, before the
 * chunk arrives, so a region opened while it loads still drops it.
 */
export function LazyVisitRemovedLine({ scope }: { scope: unknown }) {
  const { user } = useAuth();
  const visits = useRemovedVisits(user?.id);
  useEffect(() => { if (visits) drawRemovalIn(scope); }, [visits, scope]);
  return visits && <ChunkBoundary><VisitTripsChunk part="removed" visits={visits} /></ChunkBoundary>;
}

/**
 * The line offering a date after a tick (#2120), under the row that made it:
 * `at` is the row's place id, or its point's id negated.
 */
export function LazyVisitDateLine({ at }: { at: number }) {
  const { user } = useAuth();
  return useDateLineAt(at, user?.id) && <ChunkBoundary><VisitTripsChunk part="offer" /></ChunkBoundary>;
}

// Every tick's answer: the places it gave a visit, handed to the offer of a
// date in the same chunk, fetched here the first time, to stand under the row
// `at`. Nothing waits on it: the tick is already written, and a chunk that
// does not arrive dates nothing. Handed over through the store, which the
// tick's hook reads, so the hook imports nothing the chunk imports back.
// Forgetting a traveller drops the offer on screen where the chunk is there.
// A traveller forgotten while the chunk was on its way is not offered a date:
// the origin is checked again once it arrives, before anything is stored or
// written.
handleTicks((at, ticked, client, origin) => {
  loadVisitTrips().then(m => { if (isCurrentOrigin(origin)) m.offerDate(at, ticked, client, origin); }, () => {});
}, () => arrived?.forgetOffer());

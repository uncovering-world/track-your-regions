import { useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { lazyChunk } from '../../utils/lazyChunk';
import { ChunkBoundary } from './ChunkBoundary';
import { drawRemovalIn, useRemovedVisits } from './visitRemovals';

const VisitTripsChunk = lazyChunk(() => import('./trips/visitTrips'));

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

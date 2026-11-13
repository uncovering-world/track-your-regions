import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { queryKeys } from '../../../api/queryKeys';
import { invalidateVisitedStatus } from '../../../utils/queryInvalidation';
import { clearRemovedVisits, removedVisitsOf, UNDOES_REMOVAL } from '../visitRemovals';
import {
  addTrip, changeTrip, fetchTrips, removeTrip, restoreVisits, type TripDateBody,
} from '../../../api/trips';

/**
 * A place's trips and the writes on them (#2120). Every write carries the
 * visit-write key, so every visit control waits while one is on its way
 * (`useVisitWritePending`), and refreshes the visits, which a trip can make.
 * `failed` says the last of them did not go through.
 */
export function useTrips(experienceId: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const trips = useQuery({
    queryKey: queryKeys.visited.trips(user?.id, experienceId),
    queryFn: () => fetchTrips(experienceId),
  });
  // Whether the last trip write failed, for the section to say so until the next one starts.
  const [failed, setFailed] = useState(false);
  const written = {
    onMutate: () => setFailed(false),
    onError: () => setFailed(true),
    onSuccess: () => invalidateVisitedStatus(queryClient),
  };
  const add = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: (date: TripDateBody) => addTrip(experienceId, date),
    ...written,
  });
  const change = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: ({ tripId, date }: { tripId: number; date: TripDateBody }) => changeTrip(tripId, date),
    ...written,
  });
  const remove = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: removeTrip,
    ...written,
  });
  return { trips: trips.data, add: add.mutate, change: change.mutate, remove: remove.mutate, failed };
}

/**
 * An untick's Undo: puts back the visits it removed, each with its trips. A
 * visit write that leaves the Undo's line in place while it runs, and takes
 * it away once the visits are back; one that fails leaves the Undo to try again.
 * The visits are read from the removal as the request starts, as the signed-in
 * traveller may see them, so no other traveller's removal is ever sent.
 */
export function useRestoreVisits() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: queryKeys.visited.write,
    meta: { [UNDOES_REMOVAL]: true },
    mutationFn: () => {
      const visits = removedVisitsOf(user?.id);
      if (!visits) throw new Error('No removal of the signed-in traveller to put back');
      return restoreVisits(visits);
    },
    onSuccess: () => {
      clearRemovedVisits();
      invalidateVisitedStatus(queryClient);
    },
  });
}

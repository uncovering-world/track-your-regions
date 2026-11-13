/**
 * A traveller's trips to a place (#2120, ADR-0202): their own data, read and
 * written under /api/users/me. Imported by the trips editor's lazy chunk
 * alone, so a visitor's entry chunk carries none of it.
 */
import type {
  RemovedVisit, TripDateBody, TripRemoved, TripSaved, TripsDated, VisitsRestored, VisitTrips,
} from './client.generated';
import {
  deleteUsersMeTripsByTripId, getUsersMeVisitedExperiencesByExperienceIdTrips, patchUsersMeTripsByTripId,
  postUsersMeTrips, postUsersMeVisitedExperiencesByExperienceIdTrips, postUsersMeVisitsRestore, putUsersMeTrips,
} from './client.generated';

export type {
  RemovedVisit, TickedPlace, Trip, TripDateBody, TripRemoved, TripSaved, TripsDated, VisitsRestored, VisitTrips,
} from './client.generated';

export async function fetchTrips(experienceId: number): Promise<VisitTrips> {
  return getUsersMeVisitedExperiencesByExperienceIdTrips(experienceId);
}

export async function addTrip(experienceId: number, date: TripDateBody): Promise<TripSaved> {
  return postUsersMeVisitedExperiencesByExperienceIdTrips(experienceId, date);
}

export async function changeTrip(tripId: number, date: TripDateBody): Promise<TripSaved> {
  return patchUsersMeTripsByTripId(tripId, date);
}

export async function removeTrip(tripId: number): Promise<TripRemoved> {
  return deleteUsersMeTripsByTripId(tripId);
}

/** An untick's Undo: the visits it removed, each with its trips, put back in one request. */
export async function restoreVisits(visits: RemovedVisit[]): Promise<VisitsRestored> {
  return postUsersMeVisitsRestore({ visits });
}

/** The offer's answer after a tick (#2120): one trip with one date on each place, in one request. */
export async function addTrips(experienceIds: number[], date: TripDateBody): Promise<TripsDated> {
  return postUsersMeTrips({ experienceIds, date });
}

/** The offer's "Change": the trips its line saved, all given one new date in one request. */
export async function changeTrips(tripIds: number[], date: TripDateBody): Promise<TripsDated> {
  return putUsersMeTrips({ trips: tripIds.map(id => ({ id, date })) });
}

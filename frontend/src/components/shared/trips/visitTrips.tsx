import type { RemovedVisit } from '../../../api/trips';
import { TripsSection } from './TripsSection';
import { VisitRemovedLine } from './VisitRemovedLine';

export type VisitTripsPart =
  | { part: 'trips'; experienceId: number }
  | { part: 'removed'; visits: RemovedVisit[] };

/**
 * The trips editor and the untick's Undo line (#2120): one chunk, fetched on
 * a signed-in traveller's first open card or first untick that removed a
 * trip, so a visitor's entry chunk carries none of it (`lazyVisitTrips.tsx`).
 * One default export for both, so the shell holds one loader.
 */
export default function VisitTrips(props: VisitTripsPart) {
  return props.part === 'trips'
    ? <TripsSection experienceId={props.experienceId} />
    : <VisitRemovedLine visits={props.visits} />;
}

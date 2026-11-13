import type { RemovedVisit } from '../../../api/trips';
import { TripsSection } from './TripsSection';
import { VisitDateLine } from './VisitDateLine';
import { VisitRemovedLine } from './VisitRemovedLine';

export { forgetOffer, offerDate } from './offerRuntime';

export type VisitTripsPart =
  | { part: 'trips'; experienceId: number }
  | { part: 'removed'; visits: RemovedVisit[] }
  | { part: 'offer' };

/**
 * The trips editor, the untick's Undo line and the line offering a date
 * after a tick (#2120): one chunk, fetched on a signed-in traveller's first
 * open card, first tick or first untick that removed a trip, so a visitor's
 * entry chunk carries none of it (`lazyVisitTrips.tsx`). One default export
 * for all three, so the shell holds one loader.
 */
export default function VisitTrips(props: VisitTripsPart) {
  if (props.part === 'trips') return <TripsSection experienceId={props.experienceId} />;
  if (props.part === 'removed') return <VisitRemovedLine visits={props.visits} />;
  return <VisitDateLine />;
}

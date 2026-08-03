/**
 * Tells the server which "New" chips a reader has actually been shown.
 *
 * The chip lives for `max(category window, a week from this reader's first
 * sighting)`, and the second half only means anything if someone records the
 * sighting. That is deliberately not a side effect of the read that produced
 * the chips: a GET that writes is a GET that lies about being repeatable, and a
 * timestamp set by a prefetch, a crawler or a warmed cache is not an
 * impression.
 *
 * So the rule here is "report what rendered", and the two ways to get that
 * wrong are reporting too early and reporting twice:
 *
 * - Too early: sending on fetch would stamp rows the reader never reached. The
 *   effect runs after the list has committed, which is the closest thing to
 *   "on screen" available without observing each row.
 * - Twice: only the first impression counts server-side, so a repeat is
 *   harmless there — but it is still a request per render, so ids already sent
 *   in this session are filtered out here.
 */

import { useEffect, useRef } from 'react';
import { markNewBadgesSeen } from '../api/experiences';

export function useNewBadgeImpressions(
  experiences: Array<{ id: number; is_new?: boolean }>,
  enabled: boolean,
  readerId?: number | null,
) {
  // Stops the same ids going out on every re-render. Scoped to the reader
  // rather than to the mount, because the mount is the wrong boundary here:
  // logging in is a dialog, not a route, so nothing unmounts the list when the
  // identity changes. Without the reset below, reader B's first report would
  // have every id reader A had already sent filtered out of it — and since the
  // server keeps only the first impression, B's week on those rows could never
  // start.
  const reported = useRef<Set<number>>(new Set());
  const reportedFor = useRef<number | null | undefined>(readerId);
  if (reportedFor.current !== readerId) {
    reportedFor.current = readerId;
    reported.current = new Set();
  }

  useEffect(() => {
    if (!enabled) return;

    const unreported = experiences
      .filter(e => e.is_new && !reported.current.has(e.id))
      .map(e => e.id);
    if (unreported.length === 0) return;

    // Marked before the call, not after: two renders in flight would otherwise
    // both see an empty set and send the same ids twice.
    unreported.forEach(id => reported.current.add(id));

    // Deliberately unawaited and its failure swallowed. A missed impression
    // costs the reader a chip they would have kept slightly longer; surfacing
    // it would cost them an error message about bookkeeping they never asked
    // for. The ids stay marked, so a failure does not spin.
    markNewBadgesSeen(unreported).catch(() => {});
  }, [experiences, enabled, readerId]);
}

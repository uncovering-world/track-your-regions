import { venueVerdict, type VenueFacts, type VenueRule } from './venueTest.js';
import { nearest } from '../places/nearest.js';

/**
 * P195 (collection) is ownership and points at whatever holds a work — often a department or a
 * dead collector. P159 (headquarters) is deliberately not consulted: it is what pinned umbrella
 * organisations at fake venues. Only P361 (part of) is walked, and only to the *nearest*
 * qualifying ancestor, by the shared walk (`nearest`, `places/nearest.ts`, #1819). The start is what the work's own statement names, and a start nobody fetched is a link
 * nobody could read ('no facts'); an ancestor nobody fetched is no place, since the subset keeps
 * a container's container only when the chain reaches a coordinate (`places/containment.ts`).
 */
export type Resolution = { venue: string; hops: number } | { unresolved: string };

export function resolveVenue(
  start: string,
  facts: (qid: string) => VenueFacts | undefined,
  parents: (qid: string) => string[],
  rule: VenueRule,
  maxHops = 3,
): Resolution {
  const own = facts(start);
  if (own && venueVerdict(own, rule).pass) return { venue: start, hops: 0 };

  const isVenue = (qid: string) => {
    const known = facts(qid);
    return known !== undefined && venueVerdict(known, rule).pass;
  };
  const found = nearest(start, parents, isVenue, maxHops);
  if ('at' in found) return { venue: found.at, hops: found.hops };
  if (found.why === 'ambiguous') return { unresolved: found.unresolved };
  // Nothing up the chain qualifies: the start's own reason, which is what a
  // curator reads beside an unplaced work.
  if (!own) return { unresolved: 'no facts' };
  const verdict = venueVerdict(own, rule);
  return { unresolved: verdict.pass ? 'unreachable' : verdict.reason };
}

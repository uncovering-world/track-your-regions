import { venueVerdict, type VenueFacts } from './venueTest.js';

/**
 * P195 (collection) is ownership and points at whatever holds a work — often a department or a
 * dead collector. P159 (headquarters) is deliberately not consulted: it is what pinned umbrella
 * organisations at fake venues. Only P361 (part of) is walked, and only to the *nearest*
 * qualifying ancestor.
 */
export type Resolution = { venue: string; hops: number } | { unresolved: string };

function getNextFrontier(
  frontier: string[],
  seen: Set<string>,
  parents: (qid: string) => string[],
): string[] {
  const next: string[] = [];
  for (const q of frontier) {
    for (const p of parents(q)) {
      if (!seen.has(p)) {
        seen.add(p);
        next.push(p);
      }
    }
  }
  return next;
}

function getPassingVenues(
  candidates: string[],
  facts: (qid: string) => VenueFacts | undefined,
  museumClasses: ReadonlySet<string>,
): string[] {
  const passing = new Set<string>();
  for (const p of candidates) {
    const f = facts(p);
    if (f && venueVerdict(f, museumClasses).pass) {
      passing.add(p);
    }
  }
  return [...passing];
}

export function resolveVenue(
  start: string,
  facts: (qid: string) => VenueFacts | undefined,
  parents: (qid: string) => string[],
  museumClasses: ReadonlySet<string>,
  maxHops = 3,
): Resolution {
  const own = facts(start);
  if (own && venueVerdict(own, museumClasses).pass) return { venue: start, hops: 0 };

  const seen = new Set<string>([start]);
  let frontier = [start];
  for (let hop = 1; hop <= maxHops; hop++) {
    frontier = getNextFrontier(frontier, seen, parents);
    if (!frontier.length) break;
    const passing = getPassingVenues(frontier, facts, museumClasses);
    if (passing.length === 1) return { venue: passing[0], hops: hop };
    if (passing.length > 1) {
      return { unresolved: `two qualifying ancestors at hop ${hop}: ${passing.join(', ')}` };
    }
  }
  const reason = own ? venueVerdict(own, museumClasses) : { pass: false as const, reason: 'no facts' };
  return { unresolved: 'pass' in reason && reason.pass ? 'unreachable' : (reason as { reason: string }).reason };
}

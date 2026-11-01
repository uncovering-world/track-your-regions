import { isUmbrella, venueVerdict, type VenueFacts, type VenueRule } from './venueTest.js';
import { nearest } from '../places/nearest.js';

/**
 * P195 (collection) is ownership and points at whatever holds a work — often a department or a
 * dead collector. P159 (headquarters) is deliberately not consulted: it is what pinned umbrella
 * organisations at fake venues. Only P361 (part of) is walked, and only to the *nearest*
 * qualifying ancestor, by the shared walk (`nearest`, `places/nearest.ts`, #1819). The start is what the work's own statement names, and a start nobody fetched is a link
 * nobody could read ('no facts'); an ancestor nobody fetched is no place, since the subset keeps
 * a container's container only when the chain reaches a coordinate (`places/containment.ts`).
 */
export type Resolution =
  | { venue: string; hops: number; /** Resolved through the house at the entity's coordinate, not to the entity itself. */ house?: true }
  | { unresolved: string; readingRoom?: true };

/** Why a work kept in a reading room is placed nowhere (`VenueRule.readingRooms`). */
export const READING_ROOM_REASON = 'kept in a library or an archive, not shown in what it is part of';

export function resolveVenue(
  start: string,
  facts: (qid: string) => VenueFacts | undefined,
  parents: (qid: string) => string[],
  rule: VenueRule,
  maxHops = 3,
  houseOf: (qid: string) => string | undefined = () => undefined,
): Resolution {
  const own = facts(start);
  if (own && venueVerdict(own, rule).pass) return { venue: start, hops: 0 };
  // A museum network is never a visit, but its item sits on one of its houses
  // (#1617, `VenueGraph.houseOf`): a work that names the Museo Soumaya hangs at
  // Plaza Carso, where the network's coordinate is. Only where that house is
  // itself a venue; a network whose coordinate sits on no museum of its own
  // stays what the kill-list says of it.
  if (own && isUmbrella(own.classes)) {
    const house = houseOf(start);
    const known = house === undefined ? undefined : facts(house);
    if (house !== undefined && known && venueVerdict(known, rule).pass) return { venue: house, hops: 1, house: true };
  }
  const isReadingRoom = (qid: string) => facts(qid)?.classes.some((c) => rule.readingRooms?.has(c)) ?? false;
  if (isReadingRoom(start)) return { unresolved: READING_ROOM_REASON, readingRoom: true };
  // A department or a fonds of a reading room stops there too: the walk does not climb past one.
  let stoppedAtRoom = false;
  const climb = (qid: string) => {
    if (!isReadingRoom(qid)) return parents(qid);
    stoppedAtRoom = true;
    return [];
  };

  const isVenue = (qid: string) => {
    const known = facts(qid);
    return known !== undefined && venueVerdict(known, rule).pass;
  };
  const found = nearest(start, climb, isVenue, maxHops);
  if ('at' in found) return { venue: found.at, hops: found.hops };
  if (found.why === 'ambiguous') return { unresolved: found.unresolved };
  if (stoppedAtRoom) return { unresolved: READING_ROOM_REASON, readingRoom: true };
  // Nothing up the chain qualifies: the start's own reason, which is what a
  // curator reads beside an unplaced work.
  if (!own) return { unresolved: 'no facts' };
  const verdict = venueVerdict(own, rule);
  return { unresolved: verdict.pass ? 'unreachable' : verdict.reason };
}

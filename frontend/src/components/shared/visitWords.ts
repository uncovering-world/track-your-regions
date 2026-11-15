import type { WholeProgress } from '@tyr/shared/visits';
import type { VisitedStatus } from '../../api/visited';

/**
 * What a place's own visit button reads, in Map mode's card and Discover's
 * panel alike (#2120). It is a place of no parts, so it is visited or not.
 */
export const VISIT_BUTTON_LABEL: Record<VisitedStatus, string> = {
  not_visited: 'Mark Visited',
  partial: 'Partly visited',
  visited: 'Visited',
};

/**
 * Whether a place's card offers "Visited, not sure which part" (#2120): a
 * whole whose detail read says it shows no point of its own. On a whole that
 * does, such as the City of Graz, a tick on that point is the whole's own
 * visit, so its checkbox in the list of places says it, and more precisely.
 * Not while the detail read is on its way.
 */
export function offersWholeTick(place: { has_parts: boolean }, details: { has_own_point: boolean } | undefined): boolean {
  return place.has_parts && details?.has_own_point === false;
}

/** A count as a row, a card or a list header shows it, and the name it is read out by. */
export interface VisitCount {
  /** What the screen shows: "1 of 34", "? of 34", "0 of 34" or "34 places". */
  text: string;
  /** What a screen reader says for it. */
  name: string;
  /** How much of it is visited, 0 to 1, for a bar: nothing where no place is named. */
  share: number;
}

/** "34 places": how many places a place is made of, with no visit in it. */
export function placesCount(total: number): VisitCount {
  const text = `${total.toLocaleString()} places`;
  return { text, name: text, share: 0 };
}

/**
 * A whole's count (ADR-0206), one wording for Map mode's row, Discover's card,
 * the open card's visit chip and its list of places: `leafCount` is the row's
 * `leaf_count`, `progress` the traveller's entry in the visit read, absent for a
 * whole they have not been to. The Struve Geodetic Arc reads "1 of 34" after
 * one station, in Moldova's list as in Finland's, "? of 34" ticked without
 * naming a station, "0 of 34" before any visit, and "34 places" to a visitor
 * who is not signed in. A whole of one offered leaf, or none, shows no count:
 * "? of 1" says nothing a traveller needs.
 */
export function wholeCountLabel(
  leafCount: number | null, progress: WholeProgress | undefined, signedIn: boolean,
): VisitCount | null {
  const total = progress?.total ?? leafCount;
  if (total == null || total < 2) return null;
  if (!signedIn) return placesCount(total);
  const of = total.toLocaleString();
  const visited = progress ? progress.visited : 0;
  if (visited == null) return { text: `? of ${of}`, name: `Visited, places not named, of ${of} places`, share: 0 };
  const text = `${visited.toLocaleString()} of ${of}`;
  return { text, name: `${text} places visited`, share: visited / total };
}

/**
 * The count on a place's open card, in Map mode and Discover alike: none for
 * an edition, seen at any one cast (ADR-0145 decision 5), even one a curator
 * has given parts; a whole's over its leaves, from the visit read; and over
 * its points for any other place shown at more than one.
 */
export function cardVisitCount(
  place: { has_parts: boolean; leaf_count: number | null; cast_points: boolean },
  progress: WholeProgress | undefined,
  points: { visited: number; total: number },
): VisitCount | null {
  if (place.cast_points) return null;
  if (place.has_parts) return wholeCountLabel(place.leaf_count, progress, true);
  return wholeCountLabel(points.total, points.visited > 0 ? points : undefined, true);
}

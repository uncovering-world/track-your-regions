/** The visit meaning shared by the API and the cards (#2120). */
export const VISITED_STATUSES = ['not_visited', 'partial', 'visited'] as const;
export type VisitedStatus = typeof VISITED_STATUSES[number];

/**
 * A place's state from what the traveller has visited of it: `visited` of the
 * `total` points a reader is shown of it (its own and its direct parts'), a
 * point counting when its own place is visited, and whether the place itself
 * is ticked. Every point visited is `visited`, and so is a ticked place a
 * reader is shown no point of. Anything less is `partial`: a serial site with
 * one of its components (Haghpat and Sanahin with two monasteries of three),
 * or a site ticked as a whole. An edition's casts are its own points, so a
 * visit to it marks them all.
 */
export function computeVisitedStatus(visited: number, total: number, ticked: boolean): VisitedStatus {
  if (visited === 0 && !ticked) return 'not_visited';
  if (visited >= total) return 'visited';
  return 'partial';
}

/** How far through a whole's offered leaves the traveller is: `visited` of `total`, `visited` null for "?". */
export interface WholeProgress {
  visited: number | null;
  total: number;
}

/**
 * A whole's count (ADR-0206): `visited` of its `total` offered leaves, a leaf
 * being a place with no parts of its own reached down the part relations at
 * any depth. `visited` is the offered leaves the traveller visited, and "?"
 * (null) when they visited none and the whole is still `touched`, ticked
 * itself or visited below: a tick "not sure which part", a tick on a whole
 * nested in it, or a visit to a leaf since withdrawn, which the traveller never
 * sees as "0 of 33". A whole with no offered leaf, as Wudang's 45 parts that
 * all wait for a curator, has no count (null). The Struve Geodetic Arc after
 * one station reads 1 of 34.
 */
export function wholeProgress(visited: number, total: number, touched: boolean): WholeProgress | null {
  if (total === 0) return null;
  if (visited > 0) return { visited, total };
  return { visited: touched ? null : 0, total };
}

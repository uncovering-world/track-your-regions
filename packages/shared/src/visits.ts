/**
 * The visit meaning shared by the API and the cards (#2120): a place is
 * visited once it or any place below it has a visit (ADR-0206 decision 1),
 * which the backend reads in SQL (`visitedPlacesCtesSql`). One station visits
 * the Struve Geodetic Arc, and how much of it is left is its count
 * (`wholeProgress`), never a lesser state.
 */
export const VISITED_STATUSES = ['not_visited', 'visited'] as const;
export type VisitedStatus = typeof VISITED_STATUSES[number];

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

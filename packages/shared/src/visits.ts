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

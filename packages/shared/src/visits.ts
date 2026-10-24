/** The visit meaning shared by the API and the cards (ADR-0145 decision 5). */
export const VISITED_STATUSES = ['not_visited', 'partial', 'visited'] as const;
export type VisitedStatus = typeof VISITED_STATUSES[number];

/** A cast is the whole work; a serial site's component is only one part of it. */
export function computeVisitedStatus(visited: number, total: number, castPoints = false): VisitedStatus {
  if (visited === 0) return 'not_visited';
  if (castPoints || visited >= total) return 'visited';
  return 'partial';
}

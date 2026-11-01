/**
 * The GADM leaf divisions under a point: the one rule for "which division is
 * this point in", asked by the short-move gate (`shortMove.ts`, ADR-0140) and
 * by the review card that says whether a move crosses a division (#2203).
 * Covers rather than contains, so a point on a shared border is in both, and a
 * set rather than one id for the same reason. A point at sea is in none.
 *
 * `point` is a geometry expression in SRID 4326, answered once per row.
 */
export const leavesSql = (point: string): string =>
  `ARRAY(SELECT d.id FROM administrative_divisions d
          WHERE NOT d.has_children AND ST_Covers(d.geom, ${point}) ORDER BY d.id)`;

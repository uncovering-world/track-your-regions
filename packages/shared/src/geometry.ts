/**
 * A span this wide, in degrees of longitude, is the whole world however it is
 * measured, so no window onto it is a frame.
 *
 * The threshold behind "is this shape near-global or does it cross the
 * antimeridian" (#674): the database measures what it holds in
 * `geometry_focus()` and stores the answer as `focus_bbox` + `anchor_point`;
 * the client measures a shape that exists only in the browser — a boundary
 * being drawn, a cut — in `focusFromGeoJson()`. The two are one rule in two
 * runtimes, and this is the number both read. `near_global_deg()` in
 * `db/init/01-schema.sql` is the database's statement of it, held equal by
 * `backend/src/db/regionFocusAntimeridian.test.ts`.
 */
export const NEAR_GLOBAL_DEG = 350;

/**
 * The hull a region is drawn with until an admin tunes its own: a 50 km buffer
 * around its islands, a concave fit loose enough (0.9) to take in the far ones,
 * and a 0.02° simplification. The server builds a hull with these where no
 * parameters are saved, and the hull editor opens on them and resets to them,
 * so the two must be the same numbers.
 */
export const DEFAULT_HULL_PARAMS = { bufferKm: 50, concavity: 0.9, simplifyTolerance: 0.02 } as const;

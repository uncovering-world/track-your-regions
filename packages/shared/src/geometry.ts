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

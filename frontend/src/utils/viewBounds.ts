/**
 * A map view, and the one question asked of it: is this point inside?
 *
 * Shared rather than list-local because three unrelated places hold a view — the
 * map publishes one, the experience context carries it, and the list filters by
 * it — and `frontend/src/utils/` is where this repository keeps a helper more
 * than one component needs.
 */

/**
 * A map view. Two different conventions arrive here, and both are answered.
 *
 * - **MapLibre's `getBounds()`** keeps `west <= east` and lets the values leave
 *   `[-180, 180]`: it builds the box with `LngLatBounds.extend`, which assigns
 *   `Math.min`/`Math.max` on longitude, from corners `pointLocation` returns
 *   unwrapped around the transform's centre. A view straddling the dateline is
 *   `{west: 175, east: 185}`, and panning on past it gives `{west: 170, east: 210}`.
 * - **This repository's own boxes** — `focus_bbox`, the `bbox` query parameter —
 *   use `west > east` to say the box crosses the antimeridian (CLAUDE.md
 *   § Antimeridian Handling).
 */
export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Whether a point falls inside the view.
 *
 * The longitude test works in the box's own frame rather than in either
 * convention's: the width is measured from `west` eastwards, and the point is
 * shifted into `[west, west + 360)` before being compared with it. That answers
 * both forms above, and it answers them for coordinates the API returns in
 * `[-180, 180]` while the map reasons in unwrapped ones — a place at `-179` is
 * inside `{west: 175, east: 185}`, and its pin is drawn there, because MapLibre
 * renders world copies.
 *
 * The naive `west <= lng && lng <= east` is what this replaces, and it fails in
 * exactly the case the feature exists for: over the dateline it excludes every
 * real longitude, so the list empties beside a screen full of pins.
 */
export function pointInView(lng: number, lat: number, b: ViewBounds): boolean {
  if (lat < b.south || lat > b.north) return false;
  const width = b.west <= b.east ? b.east - b.west : b.east + 360 - b.west;
  // Zoomed out far enough to see the whole world, or further: every longitude is
  // on screen, and the modulo below would otherwise fold the far edge away.
  if (width >= 360) return true;
  const offset = (((lng - b.west) % 360) + 360) % 360;
  return offset <= width;
}

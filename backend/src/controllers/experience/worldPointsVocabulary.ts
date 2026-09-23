/**
 * The two tiers the map's point read answers: `overview`, the heatmap's read,
 * and `markers`, the pins'.
 *
 * The band between the two tiers is the map's own (`MARKER_FADE_START` in the
 * markers' `layers.ts`), and it is named there rather than here: the server
 * answers what it was asked for, and a zoom the client never sends is not a
 * contract.
 *
 * A module of its own, with no imports, because the request's schema
 * (`types/index.ts`), the handler (`worldPointsController.ts`) and the answer's
 * schema (`api/responses/worldPoints.ts`, ADR-0066) all read the list, and a
 * response schema may import only what opens no pool.
 */
export const POINTS_DETAILS = ['overview', 'markers'] as const;
export type PointsDetail = (typeof POINTS_DETAILS)[number];

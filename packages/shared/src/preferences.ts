/**
 * What a visitor chooses for themselves, as both sides read it.
 *
 * `MAPS_APPS` is the Postgres enum `maps_app` (#1604): the maps app a place's
 * "Open in maps" opens in. No choice, `null`, is "ask each time" — every
 * target side by side (ADR-0115). `device` is the device's own maps app (Apple
 * Maps, or the app Android hands a `geo:` link to), and a device that has none
 * falls back to the targets side by side. The backend's generated row type
 * carries the same union from the schema, and
 * `backend/src/db/curationLogActions.test.ts` asks TypeScript whether the two
 * are the same.
 */

export const MAPS_APPS = ['device', 'osm', 'google'] as const;

export type MapsApp = (typeof MAPS_APPS)[number];

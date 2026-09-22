/**
 * What the catalogue client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/experiences.ts` calls, declared once.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * An endpoint still missing here declares its answer on both sides, until its
 * slice of #527 moves it.
 *
 * Imports are held to the list in the header of `curation.ts` beside this
 * file, which also says why.
 */

import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';

export const LocationCurationState = z.enum(CHECK_VALUES.experience_locations.curation_state)
  .describe(
    'Whether readers see the point yet. `pending` is shown to nobody but a curator until it is published.'
    + ' `auto` and `verified` are shown to readers.',
  );
export type LocationCurationState = z.infer<typeof LocationCurationState>;

/** A timestamp as the wire carries it: the handler converts the driver's `Date`. */
const timestamp = z.iso.datetime({ offset: true }).nullable();

/**
 * The keys both location reads send, which is what a screen reads when it does
 * not care which read the point came from.
 *
 * `ordinal` is nullable. A point the source no longer lists has no place in the
 * source's list. Either its withdrawal is recorded, and then no read returns
 * the row, or it is a point whose replacement is still waiting to be published,
 * and then readers do see it (ADR-0025 decision 5).
 */
export const ExperienceLocation = z.strictObject({
  id: z.number().int(),
  experience_id: z.number().int(),
  name: z.string().nullable().describe('The component the source names, such as one fort of a serial nomination.'),
  external_ref: z.string().nullable().describe("The source's own reference, such as `1739-005` for UNESCO."),
  ordinal: z.number().int().nullable().describe(
    "The point's place in the source's list. Null for a point waiting on its replacement to be published,"
    + ' and sorted last. Read it through `locationLabel` rather than doing arithmetic on it.',
  ),
  longitude: z.number(),
  latitude: z.number(),
  created_at: timestamp,
  curated_fields: z.array(z.string()).describe(
    'The fields a curator has claimed on the point, such as `name` and `location`, so a row can say it is corrected.',
  ),
  in_region: z.boolean().describe('Whether the point lies in the region the read was asked about. True where none was named.'),
}).describe('One point of an object.');
export type ExperienceLocation = z.infer<typeof ExperienceLocation>;

export const RegionExperienceLocation = ExperienceLocation.extend({
  region_path: z.string().nullable().describe(
    'The leaf region the point lies in, with its ancestors, such as `Europe > France > Paris`. It is shown for a point'
    + ' outside the region on screen. Null where the point lies in no region of that world view.',
  ),
}).describe('One point as the map and the region list read it.');
export type RegionExperienceLocation = z.infer<typeof RegionExperienceLocation>;

// The two keys the region feed leaves out, because it serves published points
// only. The object's own read serves a curator the unread ones too, and the
// screen that corrects a point has to say which it is holding.
export const ExperienceLocationWithState = ExperienceLocation.extend({
  curation_state: LocationCurationState,
  refused_at: timestamp.describe(
    'Set where a curator turned this unread point down. The state cannot say so, because a refused point stays'
    + ' `pending`: publishing shows an unread point and refuses a turned-down one.',
  ),
}).describe("One point as its object's own read serves it, with where it stands at the gate.");
export type ExperienceLocationWithState = z.infer<typeof ExperienceLocationWithState>;

export const ExperienceLocationsResponse = z.strictObject({
  experienceId: z.number().int(),
  experienceName: z.string(),
  locations: z.array(ExperienceLocationWithState).describe('In the source\'s order, with the points that have no place last.'),
  totalLocations: z.number().int(),
  regionId: z.number().int().nullable().describe('The region `in_region` was asked about, or null where none was named.'),
}).describe("An object's own points.");
export type ExperienceLocationsResponse = z.infer<typeof ExperienceLocationsResponse>;

export const RegionExperienceLocationsResponse = z.strictObject({
  locationsByExperience: z.record(z.string(), z.array(RegionExperienceLocation))
    .describe('Every point of every object the region list shows, keyed by the object id.'),
}).describe("The points of a region's objects, in one read rather than one per object.");
export type RegionExperienceLocationsResponse = z.infer<typeof RegionExperienceLocationsResponse>;

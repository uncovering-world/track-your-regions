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

// The line under a picture: a Commons file credits a photographer and a licence
// with a URL, and every half of that can be missing from the file page.
export const ImageCredit = z.strictObject({
  author: z.string().nullable().describe('The photographer or uploader, as plain text.'),
  license: z.string().nullable().describe('The licence in the words its own name uses: "CC BY-SA 3.0", "Public domain".'),
  licenseUrl: z.string().nullable(),
  detailsUrl: z.string().nullable()
    .describe("The file page or the site's own page for the object: where the full terms are."),
}).describe('Who a picture is credited to, as `ImageCreditLine` draws it (ADR-0043).');
export type ImageCredit = z.infer<typeof ImageCredit>;

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

const SourceMembership = z.enum(CHECK_VALUES.experiences.source_membership);
const Existence = z.enum(CHECK_VALUES.experiences.existence);

export const ExperienceRegionRef = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  world_view_id: z.number().int(),
  world_view_name: z.string(),
}).describe('A region an object can be opened at, in a world view the caller may see.');
export type ExperienceRegionRef = z.infer<typeof ExperienceRegionRef>;

export const Experience = z.strictObject({
  id: z.number().int(),
  external_id: z.string(),
  name: z.string(),
  short_description: z.string().nullable(),
  type: z.string().nullable().describe(
    'The type within the kind, such as `cultural` on a World Heritage site or `cathedral` on a place of worship. Null'
    + ' on a museum, whose kind has no types (ADR-0045).',
  ),
  kind_id: z.number().int().describe("The kind, off the row's membership (#819): what a colour and a group are decided by."),
  country_codes: z.array(z.string()).nullable()
    .describe('Null on a place created by hand without a country, which the columns allow.'),
  country_names: z.array(z.string()).nullable(),
  image_url: z.string().nullable(),
  image_credit: ImageCredit.nullable()
    .describe('Whose photograph this is, beside the picture because a thumbnail in a list is showing it (ADR-0043).'),
  in_danger: z.boolean(),
  danger_since: z.number().int().nullable()
    .describe('The year the site was listed in danger. Null where the listing carries no year.'),
  longitude: z.number(),
  latitude: z.number(),
  kind_name: z.string(),
  kind_priority: z.number().int().describe("The kind's display order, which the list orders by."),
  location_count: z.number().int(),
  treasure_count: z.number().int().describe('Offered and published links to works.'),
  created_at: timestamp.unwrap().optional(),
  is_rejected: z.boolean().optional().describe('Only for a curator whose scope reaches the region.'),
  rejection_reason: z.string().nullable().optional(),
  source_membership: SourceMembership,
  existence: Existence,
  missing_since: timestamp,
  is_new: z.boolean().describe(
    'Whether the reader could first see this recently: published, and inside the kind\'s window or this reader\'s own'
    + ' week (#529).',
  ),
}).describe("One object in a region's list.");
export type Experience = z.infer<typeof Experience>;

export const ExperiencesByRegionResponse = z.strictObject({
  region: z.strictObject({ id: z.number().int(), name: z.string(), world_view_name: z.string() }),
  experiences: z.array(Experience),
  total: z.number().int(),
  lostHidden: z.number().int()
    .describe('How many objects this region holds that no longer exist and are not being shown.'),
  limit: z.number().int(),
  offset: z.number().int(),
}).describe("A page of a region's objects.");
export type ExperiencesByRegionResponse = z.infer<typeof ExperiencesByRegionResponse>;

// A site's extent, as `ST_AsGeoJSON` writes the column: `experiences.boundary`
// is `geometry(MultiPolygon, 4326)`, so there is one geometry type to declare.
const MultiPolygon = z.strictObject({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(z.array(z.number())))),
});

export const ExperienceDetail = z.strictObject({
  id: z.number().int(),
  source_id: z.number().int().describe('The source that brought the row, beside the kind it is shown under.'),
  external_id: z.string(),
  name: z.string(),
  name_local: z.record(z.string(), z.string()).nullable(),
  description: z.string().nullable(),
  short_description: z.string().nullable(),
  type: z.string().nullable(),
  country_codes: z.array(z.string()).nullable()
    .describe('Null on a place created by hand without a country, which the columns allow.'),
  country_names: z.array(z.string()).nullable(),
  image_url: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable()
    .describe("The source's metadata, as an open record until #574 settles its model."),
  created_at: timestamp,
  updated_at: timestamp,
  source_membership: SourceMembership,
  existence: Existence,
  missing_since: timestamp,
  longitude: z.number(),
  latitude: z.number(),
  boundary_geojson: MultiPolygon.nullable()
    .describe("The site's extent from OpenStreetMap, simplified past 5,000 vertices (ADR-0059)."),
  area_km2: z.number().nullable(),
  kind_id: z.number().int(),
  kind_name: z.string(),
  kind_priority: z.number().int(),
  source_name: z.string(),
  source_description: z.string().nullable(),
  regions: z.array(ExperienceRegionRef)
    .describe('The regions whose own lists hold the object, in the world views the caller may see.'),
}).describe('One object, as its own page reads it.');
export type ExperienceDetail = z.infer<typeof ExperienceDetail>;

export const ExperienceSearchResult = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  short_description: z.string().nullable(),
  type: z.string().nullable(),
  kind_id: z.number().int(),
  kind_name: z.string(),
  kind_priority: z.number().int(),
  country_names: z.array(z.string()).nullable(),
  image_url: z.string().nullable(),
  image_credit: ImageCredit.nullable(),
  source_membership: SourceMembership,
  existence: Existence,
  missing_since: timestamp,
  longitude: z.number(),
  latitude: z.number(),
  relevance: z.number(),
  regions: z.array(ExperienceRegionRef).describe(
    'The regions whose own lists hold the object, most specific first. Empty where nothing published places it, and'
    + ' then the answer is not a link.',
  ),
}).describe('One answer of the catalogue search.');
export type ExperienceSearchResult = z.infer<typeof ExperienceSearchResult>;

export const ExperienceSearch = z.strictObject({
  query: z.string(),
  results: z.array(ExperienceSearchResult),
  total: z.number().int(),
}).describe('What the catalogue search found for a name.');
export type ExperienceSearch = z.infer<typeof ExperienceSearch>;

export const ExperienceKind = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  display_priority: z.number().int(),
  experience_count: z.string().describe('How many places the kind offers. A string: PostgreSQL counts in bigint.'),
}).describe('A kind of place a traveller browses by (ADR-0045).');
export type ExperienceKind = z.infer<typeof ExperienceKind>;

export const ExperienceKinds = z.array(ExperienceKind).describe('The kinds a source fills today, in display order.');
export type ExperienceKinds = z.infer<typeof ExperienceKinds>;

export const LinkedPlace = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  kind_id: z.number().int().nullable().describe("The kind the place is shown under, which Discover's address needs."),
  regions: z.array(ExperienceRegionRef),
}).describe('A place another card names, with the regions a link to it is built from (ADR-0042).');
export type LinkedPlace = z.infer<typeof LinkedPlace>;

export const ExperienceTreasure = z.strictObject({
  id: z.number().int(),
  external_id: z.string(),
  name: z.string(),
  treasure_type: z.string(),
  artists: z.array(z.string()).describe('Every maker the source names (#720).'),
  artists_curated: z.boolean().describe('Whether a curator has vouched for the order the makers are stored in (ADR-0040).'),
  curated_fields: z.array(z.string()).describe('The columns a curator has claimed on the work.'),
  venue_count: z.number().int().describe('How many museums hang this work (ADR-0025 decision 2).'),
  year: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_credit: ImageCredit.nullable(),
  is_iconic: z.boolean(),
  found_at: z.strictObject({ qid: z.string(), label: z.string() }).nullable()
    .describe('Where the object was dug up, for the kind whose works are finds (ADR-0058).'),
  found_at_site: LinkedPlace.nullable()
    .describe('The site row that spot names, where the catalogue holds one a reader may open (#894).'),
  sitelinks_count: z.number().int(),
}).describe('A work inside an object: an artwork, an artifact.');
export type ExperienceTreasure = z.infer<typeof ExperienceTreasure>;

export const ExperienceTreasuresResponse = z.strictObject({
  experienceId: z.number().int(),
  treasures: z.array(ExperienceTreasure),
  total: z.number().int(),
}).describe('The works an object holds.');
export type ExperienceTreasuresResponse = z.infer<typeof ExperienceTreasuresResponse>;

export const SiteFind = z.strictObject({
  id: z.number().int(),
  external_id: z.string(),
  name: z.string(),
  treasure_type: z.string(),
  year: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_credit: ImageCredit.nullable(),
  is_iconic: z.boolean(),
  sitelinks_count: z.number().int(),
  shown_at: z.array(LinkedPlace).describe('One entry per building, never empty: a find nobody can go and see is not listed.'),
}).describe('One find dug up at a site (#894).');
export type SiteFind = z.infer<typeof SiteFind>;

export const SiteFindsResponse = z.strictObject({
  experienceId: z.number().int(),
  finds: z.array(SiteFind),
  total: z.number().int(),
}).describe('The finds dug up at a site, and where they are shown.');
export type SiteFindsResponse = z.infer<typeof SiteFindsResponse>;

export const RegionExperienceCount = z.strictObject({
  region_id: z.number().int(),
  region_name: z.string(),
  region_color: z.string().nullable(),
  has_subregions: z.boolean(),
  kind_counts: z.record(z.string(), z.number().int()).describe('How many places each kind counts here, keyed by kind id.'),
}).describe("A region's counts per kind, for Discover's tree.");
export type RegionExperienceCount = z.infer<typeof RegionExperienceCount>;

export const RegionExperienceCounts = z.array(RegionExperienceCount);
export type RegionExperienceCounts = z.infer<typeof RegionExperienceCounts>;

export const NewBadgesSeen = z.strictObject({
  recorded: z.array(z.number().int()).describe('The objects whose first impression this call recorded. Only the first is kept.'),
}).describe('Which New chips were recorded as shown.');
export type NewBadgesSeen = z.infer<typeof NewBadgesSeen>;

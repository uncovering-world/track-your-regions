/**
 * What the visits client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/visited.ts` calls, declared once. That is a
 * reader's visited regions, objects and places, the works they have seen, and
 * how far through an object they are.
 *
 * Each exported schema is the type of the same name in the web's generated client, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';
import { VISITED_STATUSES } from '@tyr/shared/visits';

/** A timestamp as the wire carries it: the handler converts the driver's `Date`. */
const timestamp = z.iso.datetime({ offset: true }).nullable();

export const VisitedRegion = z.strictObject({
  region_id: z.number().int(),
  visited_at: timestamp,
  notes: z.string().nullable(),
}).describe('A region the reader has marked visited.');
export type VisitedRegion = z.infer<typeof VisitedRegion>;

export const VisitedRegions = z.array(VisitedRegion).describe('The reader\'s visited regions, newest first.');
export type VisitedRegions = z.infer<typeof VisitedRegions>;

export const VisitedExperienceIds = z.strictObject({
  visitedIds: z.array(z.number().int()).describe('The objects the reader has visited, wholly or in part.'),
  partialIds: z.array(z.number().int())
    .describe('Those of them visited in part: a serial site with some of its components, or ticked as a whole.'),
  wholeTickedIds: z.array(z.number().int()).describe(
    'The wholes the reader ticked as a whole, without naming a part: "I was there, I don\'t remember which part".'
    + ' Not a whole showing a point of its own, where that tick is the point\'s (#2120).',
  ),
  total: z.number().int(),
}).describe('The objects the reader has visited, and which of them only in part.');
export type VisitedExperienceIds = z.infer<typeof VisitedExperienceIds>;

/**
 * A place a tick gave a visit it did not have (#2120): its id and name, and
 * where the traveller ticked it, which is what the offer of a date after a
 * tick reads to tell a trip from a backfill.
 */
export const TickedPlace = z.strictObject({
  experienceId: z.number().int(),
  name: z.string(),
  longitude: z.number().describe('Where the tick was: the point ticked, or the place\'s own point for a tick on the place.'),
  latitude: z.number(),
}).describe('A place a tick gave a visit it did not have.');
export type TickedPlace = z.infer<typeof TickedPlace>;

export const ExperienceVisitMarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  experienceName: z.string(),
  id: z.number().int().describe('The visit\'s own row.'),
  marked_at: timestamp.describe('When the tick was made, not when the traveller was there: that is a trip\'s (#2120).'),
  notes: z.string().nullable(),
  rating: z.number().int().nullable(),
  ticked: z.array(TickedPlace).describe('The place, when the tick gave it a visit it did not have: none when it only renewed one.'),
}).describe('An object marked visited, or its visit renewed.');
export type ExperienceVisitMarked = z.infer<typeof ExperienceVisitMarked>;

/** A trip's date: a year, a month within it and a day within that, each null where not known (#2120). */
const tripDateFields = {
  year: z.number().int().nullable(),
  month: z.number().int().nullable(),
  day: z.number().int().nullable(),
};

export const Trip = z.strictObject({
  id: z.number().int(),
  ...tripDateFields,
  createdAt: timestamp,
}).describe('One trip to a place, with its approximate date: all three parts null is a trip whose date the traveller does not remember (#2120). Only its traveller reads it.');
export type Trip = z.infer<typeof Trip>;

export const VisitTrips = z.strictObject({
  experienceId: z.number().int(),
  visited: z.boolean().describe('Whether the traveller holds a visit on the place itself.'),
  trips: z.array(Trip).describe('Newest first, a trip whose date is not known last.'),
}).describe('A traveller\'s trips to one place.');
export type VisitTrips = z.infer<typeof VisitTrips>;

export const TripSaved = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  trip: Trip,
}).describe('A trip added, or its date changed.');
export type TripSaved = z.infer<typeof TripSaved>;

export const TripsDated = z.strictObject({
  success: z.literal(true),
  trips: z.array(z.strictObject({ experienceId: z.number().int(), trip: Trip })),
}).describe('Trips added to several places at once, or several trips given one date: what the offer of a date after a tick writes (#2120).');
export type TripsDated = z.infer<typeof TripsDated>;

export const TripRemoved = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  trip: Trip.describe('The trip as it stood, for its Undo, which adds it again.'),
}).describe('A trip removed; the visit stays, with no date if it was the last.');
export type TripRemoved = z.infer<typeof TripRemoved>;

export const RemovedVisit = z.strictObject({
  experienceId: z.number().int(),
  markedAt: timestamp,
  notes: z.string().nullable(),
  rating: z.number().int().nullable(),
  trips: z.array(z.strictObject(tripDateFields)),
}).describe('A visit an untick removed, with its trips, given back whole so its Undo can restore it.');
export type RemovedVisit = z.infer<typeof RemovedVisit>;

export const ExperienceVisitUnmarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  removed: z.array(RemovedVisit),
}).describe('An object no longer marked visited.');
export type ExperienceVisitUnmarked = z.infer<typeof ExperienceVisitUnmarked>;

export const VisitedLocationIds = z.strictObject({
  visitedLocationIds: z.array(z.number().int()),
  byExperience: z.record(z.string(), z.array(z.number().int())).describe('The same places, keyed by the object id.'),
  total: z.number().int(),
}).describe('The places the reader has marked visited.');
export type VisitedLocationIds = z.infer<typeof VisitedLocationIds>;

export const LocationVisitMarked = z.strictObject({
  success: z.literal(true),
  locationId: z.number().int(),
  locationName: z.string().nullable(),
  experienceId: z.number().int(),
  experienceName: z.string(),
  id: z.number().int().describe('The visit\'s own row.'),
  marked_at: timestamp.describe('When the tick was made, not when the traveller was there: that is a trip\'s (#2120).'),
  notes: z.string().nullable(),
  ticked: z.array(TickedPlace).describe("The point's own place, at the point, when the tick gave it a visit it did not have: none when it only renewed one."),
}).describe('A place marked visited, or its visit renewed.');
export type LocationVisitMarked = z.infer<typeof LocationVisitMarked>;

export const LocationVisitUnmarked = z.strictObject({
  success: z.literal(true),
  locationId: z.number().int(),
  experienceId: z.number().int(),
  removed: z.array(RemovedVisit),
}).describe('A place no longer marked visited.');
export type LocationVisitUnmarked = z.infer<typeof LocationVisitUnmarked>;

export const AllLocationsMarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  regionId: z.number().int().nullable().describe('The region the marking was limited to, or null for the whole object.'),
  locationsMarked: z.number().int(),
  ticked: z.array(TickedPlace).describe('The places the marking gave a visit they did not have, each at the first of its points marked.'),
}).describe('Every place of an object, or of it within a region, marked visited.');
export type AllLocationsMarked = z.infer<typeof AllLocationsMarked>;

export const AllLocationsUnmarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  regionId: z.number().int().nullable(),
  locationsUnmarked: z.number().int(),
  removed: z.array(RemovedVisit),
}).describe('Every place of an object, or of it within a region, no longer marked visited.');

export const VisitsRestored = z.strictObject({
  success: z.literal(true),
  restored: z.number().int().describe('How many visits were restored with their trips.'),
}).describe('Visits an untick removed, put back with their trips.');
export type VisitsRestored = z.infer<typeof VisitsRestored>;
export type AllLocationsUnmarked = z.infer<typeof AllLocationsUnmarked>;

export const VisitedStatus = z.enum(VISITED_STATUSES)
  .describe('How far through an object\'s places the reader is.');
export type VisitedStatus = z.infer<typeof VisitedStatus>;

export const LocationWithVisitedStatus = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  ordinal: z.number().int().nullable().describe('Nullable, for the reason given on `ExperienceLocation.ordinal`.'),
  longitude: z.number(),
  latitude: z.number(),
  isVisited: z.boolean(),
  markedAt: timestamp.describe('When the tick on its place was made, not when the traveller was there.'),
  notes: z.string().nullable(),
}).describe('One place of an object, with whether the reader has been there.');
export type LocationWithVisitedStatus = z.infer<typeof LocationWithVisitedStatus>;

export const ExperienceVisitedStatusResponse = z.strictObject({
  experienceId: z.number().int(),
  castPoints: z.boolean().describe('Each point is a cast of the whole work; any visited cast marks the work visited.'),
  visitedStatus: VisitedStatus,
  totalLocations: z.number().int(),
  visitedLocations: z.number().int(),
  locations: z.array(LocationWithVisitedStatus),
}).describe('How far through an object\'s places the reader is, place by place.');
export type ExperienceVisitedStatusResponse = z.infer<typeof ExperienceVisitedStatusResponse>;

export const ViewedTreasureIds = z.strictObject({
  viewedTreasureIds: z.array(z.number().int()),
}).describe('The works the reader has marked seen.');
export type ViewedTreasureIds = z.infer<typeof ViewedTreasureIds>;

export const TreasureViewMarked = z.strictObject({
  success: z.literal(true),
  treasureId: z.number().int(),
  treasureName: z.string(),
  experienceId: z.number().int().nullable().describe('The museum marked visited with it, where the call named one.'),
  experienceName: z.string().nullable(),
}).describe('A work marked seen.');
export type TreasureViewMarked = z.infer<typeof TreasureViewMarked>;

export const TreasureViewUnmarked = z.strictObject({
  success: z.literal(true),
  treasureId: z.number().int(),
}).describe('A work no longer marked seen.');
export type TreasureViewUnmarked = z.infer<typeof TreasureViewUnmarked>;

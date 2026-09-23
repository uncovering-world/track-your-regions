/**
 * What the visits client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/visited.ts` calls, declared once. That is a
 * reader's visited regions, objects and places, the works they have seen, and
 * how far through an object they are.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

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
  visitedIds: z.array(z.number().int()),
  total: z.number().int(),
}).describe('The objects the reader has marked visited.');
export type VisitedExperienceIds = z.infer<typeof VisitedExperienceIds>;

export const ExperienceVisitMarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  experienceName: z.string(),
  id: z.number().int().describe('The visit\'s own row.'),
  visited_at: timestamp,
  notes: z.string().nullable(),
  rating: z.number().int().nullable(),
}).describe('An object marked visited, or its visit renewed.');
export type ExperienceVisitMarked = z.infer<typeof ExperienceVisitMarked>;

export const ExperienceVisitUnmarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
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
  visited_at: timestamp,
  notes: z.string().nullable(),
}).describe('A place marked visited, or its visit renewed.');
export type LocationVisitMarked = z.infer<typeof LocationVisitMarked>;

export const LocationVisitUnmarked = z.strictObject({
  success: z.literal(true),
  locationId: z.number().int(),
  experienceId: z.number().int(),
}).describe('A place no longer marked visited.');
export type LocationVisitUnmarked = z.infer<typeof LocationVisitUnmarked>;

export const AllLocationsMarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  regionId: z.number().int().nullable().describe('The region the marking was limited to, or null for the whole object.'),
  locationsMarked: z.number().int(),
}).describe('Every place of an object, or of it within a region, marked visited.');
export type AllLocationsMarked = z.infer<typeof AllLocationsMarked>;

export const AllLocationsUnmarked = z.strictObject({
  success: z.literal(true),
  experienceId: z.number().int(),
  regionId: z.number().int().nullable(),
  locationsUnmarked: z.number().int(),
}).describe('Every place of an object, or of it within a region, no longer marked visited.');
export type AllLocationsUnmarked = z.infer<typeof AllLocationsUnmarked>;

export const VisitedStatus = z.enum(['not_visited', 'partial', 'visited'])
  .describe('How far through an object\'s places the reader is.');
export type VisitedStatus = z.infer<typeof VisitedStatus>;

export const LocationWithVisitedStatus = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  ordinal: z.number().int().nullable().describe('Nullable, for the reason given on `ExperienceLocation.ordinal`.'),
  longitude: z.number(),
  latitude: z.number(),
  isVisited: z.boolean(),
  visitedAt: timestamp,
  notes: z.string().nullable(),
}).describe('One place of an object, with whether the reader has been there.');
export type LocationWithVisitedStatus = z.infer<typeof LocationWithVisitedStatus>;

export const ExperienceVisitedStatusResponse = z.strictObject({
  experienceId: z.number().int(),
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

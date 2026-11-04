/**
 * What the crowded city's curator calls answer (ADR-0066, ADR-0180): a group's
 * places as its region page shows them, one place in its own circle (#2358),
 * the arrivals the city's display would shadow, and the report of answers
 * applied together (#2282).
 *
 * Each exported schema is the type of the same name in the web's generated
 * client, and the handler's body is held to it by `respond()`.
 *
 * A module of this directory imports only `zod/v4`, the generated row types,
 * vocabulary constants, the schemas of the other modules here, and the pure
 * helpers beside `respond()` in `backend/src/api/`.
 */

import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { PlacementFailure } from './curation.js';
import { ImageCredit } from './experiences.js';

const CrowdingPin = z.enum(CHECK_VALUES.experience_kind_memberships.crowding_pin)
  .describe("A curator's answer: list keeps the place among what a reader is shown and counts it as one of the ten; "
    + 'shadow keeps it in the tail and never counts it (ADR-0180).');

const CrowdingStanding = z.enum(['shown', 'shadowed', 'new'])
  .describe('Where it stands now: on the region page, in its tail, or a new arrival nobody has passed.');

const CrowdingKind = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  limit: z.number().int().describe('How many better-known places of a type shadow a place.'),
  radiusKm: z.number().describe('The radius they are counted within.'),
});

const CrowdingGroupRef = z.strictObject({
  regionId: z.number().int().nullable().describe('The region; null for the places no region places.'),
  regionName: z.string().nullable(),
  kindId: z.number().int(),
  type: z.string().nullable(),
});

export const CrowdingGroupPlace = z.strictObject({
  membershipId: z.number().int(),
  experienceId: z.number().int(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  wikipediaUrl: z.string().nullable().describe('The Wikipedia article the place holds, as its card links it (#2345).'),
  imageUrl: z.string().nullable().describe("The place's picture, as stored: the row draws a thumbnail of it (#2345)."),
  imageCredit: ImageCredit.nullable().describe('Whose photograph the picture is, shown with it.'),
  score: z.number().nullable().describe('Its fame among its kind and type worldwide (ADR-0172); null before it is scored.'),
  standing: CrowdingStanding,
  crowded: z.boolean().describe('In the tail now, or for a new arrival, once passed.'),
  outrankedBy: z.number().int().nullable()
    .describe('How many places of its type within the radius count above it as the rule counts them, whatever its own '
      + 'pin (`crowding_above()`): read for a place in the tail or pinned, null for an unpinned place the region page '
      + 'shows, which fewer than the limit outrank, and for a type its kind exempts.'),
  betterKnown: z.array(z.string())
    .describe('The names of the best known of those, three at most, best known first: what a hover names. '
      + 'Published places only; empty where the count is not read.'),
  ruleCrowded: z.boolean().describe('Where the rule puts it whatever its own pin says: in the tail, or not.'),
  pin: CrowdingPin.nullable(),
  holdsWorks: z.boolean().describe('It holds a work a reader is shown, so it is always shown and takes no pin (ADR-0173).'),
  pinnable: z.boolean().describe('Whether it may take a pin: not while it holds works or its type is exempt.'),
  canAnswer: z.boolean().describe("Whether the caller's scope reaches it, so an answer about it is taken."),
}).describe("One place of a crowded city's group, as its region page would show it.");
export type CrowdingGroupPlace = z.infer<typeof CrowdingGroupPlace>;

export const CrowdingGroup = z.strictObject({
  group: CrowdingGroupRef,
  kind: CrowdingKind,
  typeExempt: z.boolean().describe('The kind never hides a place of this type (ADR-0179): nothing here takes a pin.'),
  places: z.array(CrowdingGroupPlace)
    .describe('Every place of the kind and type in the region and under it, best known first: shown, shadowed and new.'),
  truncated: z.boolean().describe('More places stand in the group than one read lists.'),
}).describe('A crowded city as its region page shows one kind and type (#2358): what a curator sorts.');
export type CrowdingGroup = z.infer<typeof CrowdingGroup>;

export const CrowdingPlaceView = z.strictObject({
  place: CrowdingGroupPlace,
  group: CrowdingGroupRef.describe("The place's group: the leaf region it is listed under, as the shadowed arrivals are grouped."),
  kind: CrowdingKind,
  typeExempt: z.boolean(),
  around: z.array(z.strictObject({
    membershipId: z.number().int(),
    experienceId: z.number().int(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    distanceM: z.number().int().describe('How far it lies from the place, in metres.'),
    standing: CrowdingStanding,
    compared: z.boolean().describe('It counts above the place (`crowding_above()`): what the place is compared with.'),
  })).describe('Every other place of its kind and type within the radius, best known first.'),
  comparedUnlisted: z.number().int()
    .describe('How many of the places it is compared with `around` leaves out: new arrivals outside the caller\'s scope, '
      + 'and ones whose source no longer lists them, which the rule counts and the review queue does not show.'),
}).describe('A place of a crowded city in its own circle (#2358): what the rule compares it with.');
export type CrowdingPlaceView = z.infer<typeof CrowdingPlaceView>;

export const ShadowedArrivals = z.strictObject({
  groups: z.array(z.strictObject({
    regionId: z.number().int().nullable().describe('The leaf region the arrivals lie in; null where no world view places them.'),
    regionName: z.string().nullable(),
    worldViewId: z.number().int().nullable(),
    kindId: z.number().int(),
    kindName: z.string(),
    type: z.string().nullable(),
    arrivals: z.number().int(),
  })),
}).describe('The new arrivals a crowded city would shadow, which the review queue does not ask about, by region, kind and type.');
export type ShadowedArrivals = z.infer<typeof ShadowedArrivals>;

export const CrowdingAnswered = z.strictObject({
  answered: z.array(z.strictObject({
    membershipId: z.number().int(),
    experienceId: z.number().int(),
    name: z.string(),
    answer: z.enum(['list', 'shadow', 'publish', 'refuse', 'clear']),
    pin: CrowdingPin.nullable().describe('The pin the place holds now.'),
    published: z.boolean().describe('The answer published a new arrival.'),
    refused: z.boolean().describe('The answer refused the place from its kind.'),
  })),
  refused: z.array(z.strictObject({
    membershipId: z.number().int(),
    experienceId: z.number().int().nullable(),
    name: z.string().nullable(),
    status: z.number().int().describe('The status a single answer would have had: 409 for a place that takes no pin.'),
    error: z.string(),
  })).describe('The answers the server would not apply, each with its reason. The rest go on without them.'),
  outOfScope: z.number().int().describe("Answers about places outside the curator's scope, counted rather than named."),
  placementFailed: z.array(z.strictObject({
    membershipId: z.number().int(), name: z.string(), worldViews: z.array(PlacementFailure),
  })).describe('The arrivals published whose re-placement did not land.'),
}).describe("The report of a curator's answers to a crowded city, applied together (#2282).");
export type CrowdingAnswered = z.infer<typeof CrowdingAnswered>;

/**
 * What the crowded city's curator calls answer (ADR-0066, ADR-0180): the window
 * over a type around a place, the arrivals the city's display would shadow,
 * and the report of answers applied together (#2282).
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

const CrowdingPin = z.enum(CHECK_VALUES.experience_kind_memberships.crowding_pin)
  .describe("A curator's answer: list keeps the place among what a reader is shown and counts it as one of the ten; "
    + 'shadow keeps it in the tail and never counts it (ADR-0180).');

export const CrowdingWindowRow = z.strictObject({
  membershipId: z.number().int(),
  experienceId: z.number().int(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  distanceM: z.number().int().describe("How far the place lies from the window's centre, in metres."),
  readers: z.number().int().nullable().describe('Readers a year of its Wikipedia articles; null before its first measurement.'),
  guideEditions: z.number().int().nullable().describe('The Wikivoyage editions that use its item.'),
  guideUsed: z.boolean().nullable().describe('Whether a guide uses it: what its fame reads of the guides (ADR-0177).'),
  wikipediaEditions: z.number().int().nullable(),
  score: z.number().nullable().describe('Its fame among its kind and type worldwide (ADR-0172); null before it is scored.'),
  outrankedBy: z.number().int().nullable()
    .describe('How many places of its type within the radius count above it as the rule counts them, whatever its own pin: '
      + 'the better known and those kept in the list, less those kept in the shadow and those holding works. '
      + 'The rule shadows it at the kind\'s limit. Null for a type its kind exempts.'),
  standing: z.enum(['listed', 'shadowed', 'new'])
    .describe('Where it stands now: in the list a reader is shown, in the tail, or a new arrival nobody has passed.'),
  crowded: z.boolean().describe('In the tail now, or for a new arrival, once passed.'),
  ruleCrowded: z.boolean().describe('Where the rule puts it whatever its own pin says: in the tail, or not.'),
  pin: CrowdingPin.nullable(),
  holdsWorks: z.boolean().describe('It holds a work a reader is shown, so it is always shown and takes no pin (ADR-0173).'),
  pinnable: z.boolean().describe('Whether it may take a pin: not while it holds works or its type is exempt.'),
  outranksCentre: z.boolean().nullable()
    .describe("Whether it is counted above the window's place: the places that shadow it (#2228). Null on another type's window."),
  canAnswer: z.boolean().describe("Whether the caller's scope reaches it, so an answer about it is taken."),
}).describe('One place of the type around the window\'s place.');

export const CrowdingWindow = z.strictObject({
  centre: z.strictObject({
    membershipId: z.number().int(),
    experienceId: z.number().int(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    type: z.string().nullable(),
  }).describe('The place the window opened on.'),
  kind: z.strictObject({
    id: z.number().int(),
    name: z.string(),
    limit: z.number().int().describe('How many better-known places of a type shadow a place.'),
    radiusKm: z.number().describe('The radius they are counted within, and the window drawn within.'),
  }),
  type: z.string().nullable().describe('The type the rows are of.'),
  typeExempt: z.boolean().describe('The kind never hides a place of this type (ADR-0179): nothing in this window takes a pin.'),
  types: z.array(z.strictObject({
    type: z.string().nullable(),
    places: z.number().int().describe('How many places of the type lie within the radius.'),
    exempt: z.boolean(),
  })).describe('The types of the kind around the place, for a switch between them: types are judged apart.'),
  rows: z.array(CrowdingWindowRow).describe('Every place of the type within the radius, best known first.'),
}).describe('A crowded city around a place, for a curator to sort into the list and the shadow (#2282).');
export type CrowdingWindow = z.infer<typeof CrowdingWindow>;

export const ShadowedArrivals = z.strictObject({
  groups: z.array(z.strictObject({
    regionId: z.number().int().nullable().describe('The leaf region the arrivals lie in; null where no world view places them.'),
    regionName: z.string().nullable(),
    worldViewId: z.number().int().nullable(),
    kindId: z.number().int(),
    kindName: z.string(),
    type: z.string().nullable(),
    arrivals: z.number().int(),
    membershipIds: z.array(z.number().int()).describe('The arrivals, best known first: the window opens on the first.'),
  })),
}).describe('The new arrivals a crowded city would shadow, which the review queue does not ask about, by region, kind and type.');
export type ShadowedArrivals = z.infer<typeof ShadowedArrivals>;

export const CrowdingAnswered = z.strictObject({
  answered: z.array(z.strictObject({
    membershipId: z.number().int(),
    experienceId: z.number().int(),
    name: z.string(),
    answer: z.enum(['list', 'shadow', 'refuse', 'clear']),
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

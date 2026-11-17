/**
 * A kind's rule as its code states it (#2185): what the kind keeps out, in its
 * declaration's words, and the fame lines its last run admitted by. The card
 * an arrival is answered on shows it behind ⓘ, so a curator who has never
 * read the rule can check it rather than guess it.
 *
 * Each exported schema is the type of the same name in the web's generated
 * client, and the handler's body is held to it by `respond()`.
 *
 * A module of this directory imports only `zod/v4`, the generated row types,
 * vocabulary constants, the schemas of the other modules here, and the pure
 * helpers beside `respond()` in `backend/src/api/`.
 */

import { z } from 'zod/v4';

const WorldLines = z.strictObject({
  pool: z.number().int().describe("How many places of the kind's classes the run read the bars on."),
  editions: z.number().int().describe('The editions bar: Wikipedia articles in this many languages or more.'),
  editionsQuantile: z.number().describe("The editions bar's quantile of the pool: 0.97 lets in the top 3 %."),
  readers: z.number().int().nullable().describe("The readers' bar: this many readers a year or more; null where no year was ever read."),
  readersQuantile: z.number(),
  guidedReaders: z.number().int().nullable().describe(
    "The readers' bar of a place a travel guide or Atlas Obscura uses; null where no year was ever read.",
  ),
  guidedQuantile: z.number(),
  year: z.string().nullable().describe('The readership year the readers were counted over: "2025-11 to 2026-10".'),
  stayShare: z.number().describe('The share of a bar a place the last run admitted stays at: 0.8.'),
  marks: z.array(z.enum(['wikivoyage', 'atlasObscura', 'worldHeritageList'])).describe(
    "What marks a place as one a guide uses, for the guided readers' bar: a Wikivoyage edition's use, an Atlas Obscura entry, "
    + "and for Archaeology a World Heritage listing (ADR-0185).",
  ),
});

const SurroundingsLines = z.strictObject({
  radiusKm: z.number().int().describe('A place is measured against the places of its density within this distance.'),
  best: z.number().int().describe('The reference is the median of this many best places around it.'),
  minLanguages: z.number().int().describe('Wikipedia articles in this many languages or more.'),
  minReaders: z.number().int().describe("About this many readers a year: the readers' floor on the year it was derived on."),
  guideShare: z.number().describe("The Wikivoyage test passes at this share of the reference's guide editions."),
  guideGroupFloor: z.number().int().describe('The Wikivoyage test reads an area of this many places or more.'),
  editionsShare: z.number(),
  editionsGroupFloor: z.number().int(),
  readersShare: z.number(),
  readersGroupFloor: z.number().int(),
  guideOnlyTypes: z.array(z.string()).describe('The types of the kind that enter only when a Wikivoyage edition uses them.'),
  heritageTypes: z.array(z.string()).describe('Of those, the types a heritage designation that still holds lets in as a guide would.'),
  venues: z.strictObject({ radiusM: z.number().int(), share: z.number(), groupFloor: z.number().int() }).nullable().describe(
    "The venue test, for a kind that reads the food-and-drink venues around its places (Squares & streets); null otherwise.",
  ),
  mapped: z.strictObject({
    listedStands: z.boolean().describe('A site the World Heritage List inscribes stands for the map (ADR-0185).'),
    namedRuinWithinM: z.number().int().describe('A ruin or dig mapped within this distance under a word of its name stands for it (ADR-0188).'),
  }).nullable().describe('Where a place of this tier needs an OpenStreetMap object the kind reads as the place (Archaeology, ADR-0179), and what stands for one; null otherwise.'),
});

export const KindRule = z.strictObject({
  keptOut: z.array(z.strictObject({
    reason: z.string(),
    unless: z.enum(['types', 'anyType', 'ownClass', 'anotherClass']).nullable().describe(
      'When the refusal does not hold: a type of `unlessTypes` names the place, any type of the kind does, a class of the '
      + "kind's own names it too, or another class of the kind's own does; null where it always holds.",
    ),
    unlessTypes: z.array(z.string()),
  })).nullable().describe(
    "What the kind's declaration keeps out, in its own words (\"a lighthouse, not a tower\"); null for a kind whose rule is not declared as data.",
  ),
  world: WorldLines.nullable().describe("The world tier's lines, as the kind's last real run read them off its pool; null where no run did."),
  surroundings: SurroundingsLines.nullable().describe('The surroundings tier, for a kind admitted by fame; null otherwise.'),
}).describe("A kind's rule as its code and its last run state it (#2185).");
export type KindRule = z.infer<typeof KindRule>;

/**
 * What the curator's *Parts* and *Part of* sections on a place's card read and
 * answer (#2118): a place's parts and the wholes it is a part of, each with
 * whose word makes it one, the places a curator may add, and the answer to an
 * add or a take-out.
 */

import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { ImageCredit } from './experiences.js';

/** A place as a row of the section or of its search shows it. */
const PartPlace = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  subtitle: z.string().nullable(),
  kind_name: z.string().nullable().describe('The kind the place stands in, first by display order; null for a place in no kind of its own.'),
  waiting: z.boolean().describe('Every kind the place stands in waits for a curator: no reader is shown it yet.'),
  image_url: z.string().nullable(),
  image_credit: ImageCredit.nullable().describe('Whose photograph the picture is, shown with it.'),
  longitude: z.number().nullable(),
  latitude: z.number().nullable(),
});

/** The curator's word on the pair, where there is one. */
const CuratorWord = z.strictObject({
  admission: z.enum(CHECK_VALUES.source_records.admission)
    .describe('admitted: a curator made the place a part; refused: a curator keeps it out while a source names it.'),
  answered_at: z.string().nullable(),
  by_you: z.boolean().describe('The caller gave the word last.'),
  note: z.string().nullable().describe("The curator's own words, kept in both places' histories."),
});

const PartRow = z.strictObject({
  place: PartPlace,
  in_scope: z.boolean().describe(
    'The caller\'s scope reaches the other place, so the pair is theirs to answer; a place outside it is listed only while readers are offered it.',
  ),
  standing: z.boolean().describe('The place is a part of the whole now; false on a row a curator keeps out.'),
  list: z.strictObject({
    reference: z.string().describe('The reference the World Heritage list gives the line ("383bis-001").'),
    name: z.string().nullable().describe('The name the list gives the line, where it is not the place\'s.'),
  }).nullable().describe("UNESCO's list names the place among the whole's components."),
  statement: z.boolean().describe('A Wikidata statement says the place is a part of the whole.'),
  curator: CuratorWord.nullable(),
});

export const PlaceParts = z.strictObject({
  experienceId: z.number().int(),
  name: z.string(),
  in_kind: z.boolean().describe('The place stands in a kind of its own, so its first part makes it a place made of parts.'),
  merged_onto: z.boolean().describe('Another place stands merged into it, so it takes no first part until the merge is undone.'),
  parts: z.array(PartRow).describe('Its parts, standing first, then the places a curator keeps out.'),
  wholes: z.array(PartRow).describe('The wholes it is a part of, then the ones a curator keeps it out of.'),
}).describe("A place's parts and the wholes it is a part of, with whose word makes each one, for the curator's card (#2118).");
export type PlaceParts = z.infer<typeof PlaceParts>;

export const PartCandidates = z.strictObject({
  experienceId: z.number().int(),
  role: z.enum(['part', 'whole']),
  near: z.boolean().describe('No name was asked: the places nearest the anchor, within a kilometre for parts.'),
  candidates: z.array(z.strictObject({
    place: PartPlace,
    distance_m: z.number().nullable().describe('Metres from the nearest of the whole\'s parts, or from the place itself.'),
    near_name: z.string().nullable().describe('The part the distance is measured from; null where it is the place itself.'),
    taken: z.enum(['self', 'already', 'loop', 'scope']).nullable().describe(
      'Why it cannot be chosen: the place itself, a part (or whole) already, a whole of the place at some level, '
      + 'or a place readers are offered outside the caller\'s scope. A place no reader is offered is listed only in scope.',
    ),
    kept_out: z.boolean().describe('A curator keeps it out of the whole: choosing it puts it back.'),
    also_part_of: z.string().nullable().describe('Another whole it is a part of, which it stays a part of.'),
  })),
}).describe('Places a curator may add as a part of a place, or wholes to add it to, nearest first (#2118).');
export type PartCandidates = z.infer<typeof PartCandidates>;

export const PartWordAnswered = z.strictObject({
  wholeId: z.number().int(),
  partId: z.number().int(),
  act: z.enum(['added', 'put_back', 'taken_out']).describe(
    'What the word did: a part added, a kept-out place put back, or a part taken out.',
  ),
  standing: z.boolean().describe('Whether the place is a part of the whole now.'),
  keptOut: z.boolean().describe(
    'Taken out while a source still names it: the curator\'s refusal keeps it out, and no run puts it back.',
  ),
  recordId: z.number().int().nullable().describe(
    'The curator\'s record of the pair the word left standing; null where it withdrew the curator\'s record and the sources decide the pair again.',
  ),
  becameWhole: z.boolean().describe('The place was the whole\'s first part: the whole is now a place made of parts.'),
}).describe("A curator's word that a place is a part of a whole, or is taken out of it, from either place's card (#2118).");
export type PartWordAnswered = z.infer<typeof PartWordAnswered>;

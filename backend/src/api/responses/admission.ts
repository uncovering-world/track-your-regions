/**
 * Why a run admitted a place to a kind, as figures (#2184, #2179): the record
 * the run keeps on the kind's membership (`source_records.admission_evidence`,
 * `services/sync/admissionRecord.ts`), and the Wikivoyage guides that use the
 * place, which a review card lays out as a table beside the run's sentence.
 *
 * Each exported schema is the type of the same name in the web's generated
 * client. Imports are held to the list in the header of `curation.ts` beside
 * this file.
 */

import { z } from 'zod/v4';
import {
  ADMISSION_DECIDERS, ADMISSION_MARKS, ADMISSION_REFERENCES, ADMISSION_TIERS, ADMISSION_UNREAD,
} from '@tyr/shared/admissionEvidence';

const figures = {
  editions: z.number().optional().describe('Wikipedia editions.'),
  readers: z.number().optional().describe('Readers a year, in every counted edition (ADR-0055).'),
  guides: z.number().optional().describe('The Wikivoyage editions that use the place, where the tier counts them (the surroundings tier).'),
  venues: z.number().optional().describe('Cafés, restaurants and bars within the venue radius of the point (ADR-0192).'),
  venuesPer100m: z.number().optional().describe('Cafés, restaurants and bars per 100 m along the street\'s line (ADR-0194).'),
};

const AdmissionFigures = z.strictObject(figures).describe('A place\'s figures, each where the run read it: absent where it read none, never zero for unread.');

const AdmissionReference = z.strictObject({
  kind: z.enum(ADMISSION_REFERENCES)
    .describe('`needed`: the bars of the world tier, what a place needs to get in. `typical`: the medians of the best places around it.'),
  ...figures,
  guidedReaders: z.number().optional().describe('The world tier\'s readers bar for a place a guide marks, where the place carries a mark.'),
  toStay: z.strictObject({ editions: z.number().optional(), readers: z.number().optional(), guidedReaders: z.number().optional() }).optional()
    .describe('What a place the world tier held needed to stay, where it stayed rather than entered (ADR-0175 decision 2).'),
  shares: z.strictObject({
    editions: z.number().optional(), readers: z.number().optional(), guides: z.number().optional(), venues: z.number().optional(),
  }).optional().describe('The share of each median a surroundings test asks, where it is not the whole: 1.5 times the readers, a quarter of the guides.'),
  radiusKm: z.number().optional().describe('How far around the place its surroundings reach.'),
  best: z.number().int().optional().describe('How many of the best places around set each median.'),
  around: z.number().int().optional().describe('How many places of its density lie within the radius.'),
}).describe('What the place\'s figures were measured against.');

const AdmissionWork = z.strictObject({
  qid: z.string(),
  label: z.string(),
  editions: z.number().optional(),
  readers: z.number().optional(),
  burst: z.boolean().optional().describe('Whether its year is a burst: a quarter in one week, or months that swing.'),
  needed: z.strictObject({ editions: z.number().optional(), readers: z.number().optional() }).optional()
    .describe('The bar its figure cleared.'),
}).describe('The famous work or find whose figures admitted the place that holds it (ADR-0056, ADR-0164).');

export const AdmissionRecord = z.strictObject({
  tier: z.enum(ADMISSION_TIERS),
  decided: z.enum(ADMISSION_DECIDERS).describe(
    'What admitted the place: its editions, its readers, its readers over the bar for a place a guide marks (`guided`), the'
    + ' guides that use it, the cafés and bars around it, a famous work or find it holds, or `kept` where a held place was'
    + ' kept because the run could not read what decides it.',
  ),
  cleared: z.array(z.enum(ADMISSION_DECIDERS)).optional().describe('Every test the place passed, the deciding one first, where it passed more than one.'),
  stayed: z.boolean().optional().describe('Whether a place the tier held stayed by the stay share of a bar or test rather than entering.'),
  unread: z.enum(ADMISSION_UNREAD).optional().describe('What the run could not read, where `decided` is `kept`.'),
  place: AdmissionFigures,
  reference: AdmissionReference.nullable(),
  marks: z.array(z.enum(ADMISSION_MARKS)).optional().describe('The guide\'s marks the world tier read of the place.'),
  categories: z.array(z.string()).optional().describe('English Wikipedia\'s monuments categories that named the place (#2171).'),
  work: AdmissionWork.optional(),
  osm: z.strictObject({ tag: z.string(), element: z.string() }).optional()
    .describe('The OpenStreetMap object that stood in for a class of a site: the tag and the element (#895).'),
  namedRuin: z.strictObject({ name: z.string(), element: z.string() }).optional()
    .describe('The ruin OpenStreetMap maps near the place under its name, where no object carries its item (ADR-0188).'),
}).describe('Why the run admitted the place to the kind, as figures (#2184).');
export type AdmissionRecord = z.infer<typeof AdmissionRecord>;

export const GuideLink = z.strictObject({
  title: z.string().describe('The article\'s title as a reader reads it.'),
  url: z.string().describe('The article on its edition\'s own host.'),
  lang: z.string().describe('The edition\'s language, as its host names it: en for en.wikivoyage.org.'),
}).describe('A Wikivoyage article that uses the place.');
export type GuideLink = z.infer<typeof GuideLink>;

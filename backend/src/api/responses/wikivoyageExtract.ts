/**
 * What the Wikivoyage extraction answers (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/admin/wikivoyageExtract.ts` calls, declared once.
 * That is an extraction started, followed and cancelled, the page caches it
 * can start from, and the interview a model holds with the admin about a page
 * it could not read on its own.
 *
 * An interview question and the regions extracted from a page come from a
 * model, and the controller reads them key by key, so a key a model added
 * reaches nobody.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const ExtractionStarted = z.strictObject({
  started: z.literal(true),
  operationId: z.string(),
}).describe('An extraction, started in the background.');
export type ExtractionStarted = z.infer<typeof ExtractionStarted>;

export const ExtractionCancelled = z.strictObject({
  cancelled: z.boolean().describe('False when no extraction was running.'),
}).describe('A stop asked of the extraction.');
export type ExtractionCancelled = z.infer<typeof ExtractionCancelled>;

export const WikivoyageCache = z.strictObject({
  name: z.string(),
  sizeBytes: z.number().int(),
  modifiedAt: z.iso.datetime({ offset: true }),
}).describe('A saved copy of the pages an extraction fetched, which a later one can start from.');
export type WikivoyageCache = z.infer<typeof WikivoyageCache>;

export const WikivoyageCacheDeleted = z.strictObject({
  deleted: z.literal(true),
}).describe('A saved copy of the pages, deleted.');
export type WikivoyageCacheDeleted = z.infer<typeof WikivoyageCacheDeleted>;

export const RegionPreview = z.strictObject({
  name: z.string(),
  isLink: z.boolean().describe('The page names it with a link, so it has a page of its own.'),
  children: z.array(z.string()),
  pageExists: z.boolean().optional(),
  childPageExists: z.record(z.string(), z.boolean()).optional().describe('Whether each child has a page, by name.'),
}).describe('One region a model read off a page, with its children.');
export type RegionPreview = z.infer<typeof RegionPreview>;

export const InterviewQuestion = z.strictObject({
  text: z.string(),
  options: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  recommended: z.number().int().nullable().describe('The option the model would pick, by index.'),
  relatedRules: z.array(z.strictObject({ id: z.number().int(), text: z.string() })).optional()
    .describe('Learned rules bearing on the question, which the admin can delete from here.'),
}).describe('A question a model asks the admin about a page, with options to click.');
export type InterviewQuestion = z.infer<typeof InterviewQuestion>;

export const PendingQuestion = z.strictObject({
  id: z.number().int(),
  pageTitle: z.string(),
  sourceUrl: z.string(),
  currentQuestion: InterviewQuestion.nullable().describe('Null while the model is still writing it.'),
  extractedRegions: z.array(RegionPreview),
}).describe('A page waiting on the admin\'s answer; the extraction goes on meanwhile.');
export type PendingQuestion = z.infer<typeof PendingQuestion>;

export const ImportedWorldView = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  sourceType: z.string(),
  reviewComplete: z.boolean().describe('The import\'s review is finished.'),
}).describe('A world view an extraction imported.');
export type ImportedWorldView = z.infer<typeof ImportedWorldView>;

export const ExtractionStatus = z.strictObject({
  running: z.boolean(),
  operationId: z.string().optional(),
  status: z.enum(['extracting', 'enriching', 'importing', 'matching', 'complete', 'failed', 'cancelled']).optional(),
  statusMessage: z.string().optional(),
  regionsFetched: z.number().int().optional(),
  estimatedTotal: z.number().int().optional(),
  currentPage: z.string().optional(),
  apiRequests: z.number().int().optional(),
  cacheHits: z.number().int().optional(),
  createdRegions: z.number().int().optional(),
  totalRegions: z.number().int().optional(),
  countriesMatched: z.number().int().optional(),
  totalCountries: z.number().int().optional(),
  subdivisionsDrilled: z.number().int().optional(),
  noCandidates: z.number().int().optional(),
  worldViewId: z.number().int().nullable().optional(),
  startedAt: z.number().int().optional().describe('Milliseconds since the epoch.'),
  aiApiCalls: z.number().int().optional(),
  aiPromptTokens: z.number().int().optional(),
  aiCompletionTokens: z.number().int().optional(),
  aiTotalCost: z.number().optional(),
  pendingQuestions: z.array(PendingQuestion).optional(),
  importedWorldViews: z.array(ImportedWorldView).describe('Newest first.'),
  caches: z.array(WikivoyageCache).describe('Newest first.'),
}).describe('The latest extraction as it stands, with the world views imported and the caches kept. Only `running` and the two lists are sent while no extraction is known since the server started.');
export type ExtractionStatus = z.infer<typeof ExtractionStatus>;

export const ExtractionAnswer = z.strictObject({
  pageTitle: z.string().optional().describe('Absent only when a rule was deleted and its question has gone meanwhile.'),
  resolved: z.boolean().optional(),
  extractedRegions: z.array(RegionPreview).optional(),
  currentQuestion: InterviewQuestion.nullable().optional(),
  ruleSaved: z.string().nullable().optional().describe('A rule the answer taught, in general words.'),
  ruleDeleted: z.literal(true).optional(),
  ruleId: z.number().int().optional().describe('The rule deleted.'),
}).describe('A page\'s question after the admin answered it, accepted the page, skipped it, or deleted a rule it leaned on.');
export type ExtractionAnswer = z.infer<typeof ExtractionAnswer>;

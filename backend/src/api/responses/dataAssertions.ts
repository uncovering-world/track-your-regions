/**
 * What the Catalogue Checks calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/admin/dataAssertions.ts` calls, declared once —
 * the report of every assertion over the catalogue's rows, and one assertion as
 * accepting its number leaves it.
 *
 * The vocabulary an assertion is filed and judged by (`AssertionArea`,
 * `AssertionKind`, `AssertionStatus`) is declared here too, and the assertions
 * in `controllers/admin/dataAssertions/` take their types from it, so a new
 * area or status cannot reach the panel without reaching this schema first.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const AssertionArea = z.enum(['places', 'regions', 'boundaries', 'objects', 'pictures'])
  .describe('What an assertion is about, so a growing list stays readable.');
export type AssertionArea = z.infer<typeof AssertionArea>;

export const AssertionKind = z.enum(['invariant', 'watch'])
  .describe('An `invariant` may match nothing; a `watch` is a number to watch rather than a debt, and cannot be accepted.');
export type AssertionKind = z.infer<typeof AssertionKind>;

export const AssertionStatus = z.enum(['clear', 'holding', 'improved', 'regressed', 'unanswered', 'watch', 'error'])
  .describe('What today\'s number means beside the accepted one. `holding` is debt somebody has answered for; `unanswered` is a rule nobody has answered for yet.');
export type AssertionStatus = z.infer<typeof AssertionStatus>;

export const DataAssertion = z.strictObject({
  id: z.string().describe('Stable across runs and across a rename of the title.'),
  area: AssertionArea,
  title: z.string(),
  kind: AssertionKind,
  meaning: z.string().describe('What a matching row means, and who has to do what about it.'),
  status: AssertionStatus,
  found: z.number().int().describe('Every row that matched, not only the ones in `sample`.'),
  accepted: z.number().int().nullable(),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  acceptedBy: z.string().nullable().describe('The display name of whoever accepted it, where the account still exists.'),
  sample: z.array(z.string()).describe('Up to ten rows, each already said the way a person would say it.'),
  error: z.string().nullable().describe('Why the assertion\'s statement did not run, where it did not.'),
  needsAttention: z.boolean(),
}).describe('One assertion over the catalogue: what it found, and what was accepted.');
export type DataAssertion = z.infer<typeof DataAssertion>;

export const DataAssertionReport = z.strictObject({
  assertions: z.array(DataAssertion).describe('Every assertion, the clean ones included.'),
  needsAttention: z.number().int().describe('Counted by the server, so the badge and the list cannot disagree.'),
  acceptancesUnavailable: z.string().nullable()
    .describe('The sentence to show when the record of accepted numbers could not be read, so every check reports everything it finds. It says whether a migration is owed or the server log names the failure.'),
}).describe('Every assertion over the catalogue\'s rows.');
export type DataAssertionReport = z.infer<typeof DataAssertionReport>;

/**
 * What the admin panel's dump page reads and starts (ADR-0101, #1433): each
 * public dump the catalogue reads, its build in flight, and its recent builds
 * from the ledger.
 */

import { z } from 'zod/v4';
import { OperationProgressAnswer } from './operation.js';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { DUMP_KEYS } from '../../services/dumps/catalog.js';

/** A timestamp as the wire carries it: the handler converts the driver's `Date`. */
const timestamp = z.iso.datetime({ offset: true });


const BuildKind = z.enum(['verify', 'keep', 'rederive', 'sample', 'trial']).describe(
  'A verify build reads and counts; a keeping build runs the dump\'s builder and swaps in what it builds; a re-derive derives the kept build\'s tables again from what it holds, reading no file (#1526); a sample build cuts the first part of the local copy, and a trial runs the builder on that sample and keeps nothing (#1527).',
);

export const DumpBuildProgress = z.strictObject({
  dump: z.enum(DUMP_KEYS),
  kind: BuildKind,
  status: z.enum(['queued', 'resolving', 'reading', 'deriving'])
    .describe('Queued for the dump worker, finding its file, reading it (ADR-0106), or deriving the kept tables again, which reads no file (#1526).'),
  message: z.string(),
  file: z.strictObject({
    fileName: z.string(),
    date: z.string(),
    expectedBytes: z.number().int().nullable(),
  }).nullable(),
  downloaded: z.number().int(),
  read: z.number().int(),
  lines: z.number().int(),
  buildId: z.number().int(),
  heartbeatAt: timestamp.nullable().describe('When the build last said it is alive, every few seconds; null while it waits for the worker.'),
  etaSeconds: z.number().int().nullable()
    .describe('Seconds the step has left at its pace so far, for a step that reads a file (a pass over the dump, the labelling\'s terms spool); null in its first minute and in a step that reads none.'),
  total: z.number().int().nullable()
    .describe('What read is measured against: the dump\'s file in a pass, the terms spool while labelling, the sample\'s size while cutting one; null in a step with no measure (#1519).'),
  stepStartedAt: timestamp.nullable().describe('When the step running now started, so a step with no measure of its own reads as alive; null while queued (#1519).'),
  operation: OperationProgressAnswer.describe('The build in the shape every long operation reports (#1356): its step by ordinal and message, with no step count, measured as `read` is against `total`.'),
}).describe('A dump build queued or running, read from its ledger row whatever process runs it.');
export type DumpBuildProgress = z.infer<typeof DumpBuildProgress>;

export const DumpBuild = z.strictObject({
  id: z.number().int(),
  kind: BuildKind,
  fileName: z.string().nullable().describe('Null for a build that ended before it found its file.'),
  dumpDate: z.string().nullable(),
  mode: z.enum(CHECK_VALUES.dump_builds.mode),
  bytes: z.number().int(),
  lines: z.number().int(),
  checksumKind: z.enum(CHECK_VALUES.dump_builds.checksum_kind).nullable(),
  verified: z.boolean().describe('The published checksum matched, or, where none is published, the size and the end of stream did; never for a re-derive, which reads no file, nor for a sample or a trial, which read no file of the host\'s.'),
  status: z.enum(CHECK_VALUES.dump_builds.status).exclude(['queued']),
  error: z.string().nullable(),
  outcome: z.string().nullable().describe('What a build that ended well did, in words: what it kept, how long each step took, an older copy removed (#1527); null otherwise.'),
  startedAt: timestamp,
  finishedAt: timestamp.nullable(),
}).describe('One build of a dump, from the ledger.');

export const Dumps = z.strictObject({
  dumps: z.array(z.strictObject({
    key: z.enum(DUMP_KEYS),
    source: z.string().describe('Who publishes the dump: Wikidata, English Wikipedia, Wikimedia pageviews.'),
    title: z.string(),
    datedBy: z.enum(['day', 'month']).describe("Whether a file's date is the day of its dump or the month its counts cover."),
    about: z.string(),
    progress: DumpBuildProgress.nullable(),
    builds: z.array(DumpBuild),
    keeps: z.strictObject({
      title: z.string(),
      built: z.strictObject({ dumpDate: z.string(), swappedAt: timestamp }).nullable()
        .describe('The build now in place: its dump date and when it was swapped in.'),
      needs: z.enum(['nothing', 'recompute', 'newer-dump', 'rebuild'])
        .describe('What the copy needs (#1583): nothing; a re-derive, the code now making its derived tables differently; a build from the newer dump the host lists; or a build from the dump, none being in place or the code now keeping or writing it differently.'),
      newestDumpDate: z.string().nullable()
        .describe('The newest complete dump the host lists, YYYY-MM-DD, as last learnt (asked at most once a day); null while not known.'),
      newestChecked: z.enum(['not-yet', 'answered', 'unreachable'])
        .describe('Whether the host has been asked for its newest dump since the backend started, and whether it answered the last time.'),
      rederives: z.boolean().describe('Whether what is kept can be derived again without the dump, which decides whether "Derive again" is offered.'),
      samples: z.boolean().describe('Whether a sample of the local copy can be cut and the build tried on it, which decides whether "Cut a sample" and "Try the build" are offered.'),
      fromCopy: z.boolean().describe('Whether a keeping build may start from the local copy rather than the newest file, which decides whether "Build <date> copy" is offered.'),
    }).nullable().describe('What a keeping build of this dump makes (the local Wikidata subset, readership), or null where nothing is built from it yet.'),
    localCopy: z.strictObject({
      fileName: z.string(),
      date: z.string().describe('The date in the file name as an ISO day (YYYY-MM-DD): the dump\'s day, or the first of the month its counts cover.'),
      bytes: z.number().int(),
    }).nullable().describe('The newest local copy of the dump in DUMPS_DIR, which a build can read instead of the newest file the host lists (#1456); null without one.'),
    sample: z.strictObject({
      fileName: z.string(),
      of: z.string().describe('The local copy it was cut from.'),
      date: z.string().describe('The dump date of that copy, YYYY-MM-DD.'),
      bytes: z.number().int(),
    }).nullable().describe('The newest sample of the dump in DUMPS_DIR, which a trial builds from and throws away (#1527); null without one.'),
  })),
  localCopy: z.boolean().describe('Whether builds keep a local copy (DUMPS_DIR) or read each file as a stream from its host.'),
}).describe('The public dumps the catalogue reads, with their builds (ADR-0101).');
export type Dumps = z.infer<typeof Dumps>;

export const DumpBuildStarted = z.strictObject({
  started: z.literal(true),
  progress: DumpBuildProgress,
}).describe('A dump build started in the background, followed through the dump list.');
export type DumpBuildStarted = z.infer<typeof DumpBuildStarted>;

export const DumpBuildCancelled = z.strictObject({
  cancelled: z.boolean(),
}).describe('Whether a running build of the dump was asked to stop.');
export type DumpBuildCancelled = z.infer<typeof DumpBuildCancelled>;

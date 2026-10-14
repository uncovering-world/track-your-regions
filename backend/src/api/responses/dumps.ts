/**
 * What the admin panel's dump page reads and starts (ADR-0101, #1433): each
 * public dump the catalogue reads, its build in flight, and its recent builds
 * from the ledger.
 */

import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { DUMP_KEYS } from '../../services/dumps/catalog.js';

/** A timestamp as the wire carries it: the handler converts the driver's `Date`. */
const timestamp = z.iso.datetime({ offset: true });


export const DumpBuildProgress = z.strictObject({
  dump: z.enum(DUMP_KEYS),
  kind: z.enum(['verify', 'keep']).describe('A verify build reads and counts; a keeping build runs the dump\'s builder and swaps in what it builds.'),
  status: z.enum(['queued', 'resolving', 'reading']).describe('Queued for the dump worker, finding its file, or reading it (ADR-0106).'),
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
    .describe('Seconds the pass being read has left at its pace so far; null in its first minute, between passes and in a step that reads no file.'),
}).describe('A dump build queued or running, read from its ledger row whatever process runs it.');
export type DumpBuildProgress = z.infer<typeof DumpBuildProgress>;

export const DumpBuild = z.strictObject({
  id: z.number().int(),
  fileName: z.string().nullable().describe('Null for a build that ended before it found its file.'),
  dumpDate: z.string().nullable(),
  mode: z.enum(CHECK_VALUES.dump_builds.mode),
  bytes: z.number().int(),
  lines: z.number().int(),
  checksumKind: z.enum(CHECK_VALUES.dump_builds.checksum_kind).nullable(),
  verified: z.boolean().describe('The published checksum matched, or, where none is published, the size and the end of stream did.'),
  status: z.enum(CHECK_VALUES.dump_builds.status).exclude(['queued']),
  error: z.string().nullable(),
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
    }).nullable().describe('What a keeping build of this dump makes (the local Wikidata subset), or null where nothing is built from it yet.'),
    localCopy: z.strictObject({
      fileName: z.string(),
      date: z.string().describe('The date in the file name: YYYYMMDD, or YYYYMM for a month of counts.'),
      bytes: z.number().int(),
    }).nullable().describe('The newest local copy of the dump in DUMPS_DIR, which a build can read instead of the newest file the host lists (#1456); null without one.'),
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

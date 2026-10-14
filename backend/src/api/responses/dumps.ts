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
  status: z.enum(['resolving', 'reading', 'success', 'failed', 'cancelled']),
  message: z.string(),
  file: z.strictObject({
    fileName: z.string(),
    date: z.string(),
    expectedBytes: z.number().int().nullable(),
  }).nullable(),
  downloaded: z.number().int(),
  read: z.number().int(),
  lines: z.number().int(),
  buildId: z.number().int().nullable(),
}).describe('A dump build in flight, or the last one this process ran.');
export type DumpBuildProgress = z.infer<typeof DumpBuildProgress>;

export const DumpBuild = z.strictObject({
  id: z.number().int(),
  fileName: z.string(),
  dumpDate: z.string(),
  mode: z.enum(CHECK_VALUES.dump_builds.mode),
  bytes: z.number().int(),
  lines: z.number().int(),
  checksumKind: z.enum(CHECK_VALUES.dump_builds.checksum_kind).nullable(),
  verified: z.boolean().describe('The published checksum matched, or, where none is published, the size and the end of stream did.'),
  status: z.enum(CHECK_VALUES.dump_builds.status),
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
    elsewhere: z.strictObject({
      buildId: z.number().int(),
      fileName: z.string(),
      startedAt: timestamp,
      heartbeatAt: timestamp.describe('When the build last said it is alive; it beats every minute.'),
    }).nullable().describe('A build of this dump running in another process (a script, another server), which refuses a new build until it ends (#1463); null when none runs or this process runs it.'),
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

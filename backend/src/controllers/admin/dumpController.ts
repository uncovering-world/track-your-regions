/**
 * The admin panel's dump page (ADR-0101, #1433): the dumps the catalogue
 * reads, a verify build of one, a build that keeps what is made from it (the
 * local Wikidata subset, #1434), deriving what is kept again without the dump
 * (#1526), cutting a sample of the local copy and trying the build on it
 * (#1527), and stopping any of them. A build is queued for
 * the dump worker and followed through its ledger row (ADR-0106). The URL a
 * build fetches comes from the catalog alone (`services/dumps/catalog.ts`); a
 * caller names a dump by its key, which the route's schema holds to the
 * catalog's list.
 */

import type { z } from 'zod/v4';
import type { DumpBuildCancelled, DumpBuildStarted, Dumps } from '../../api/responses/dumps.js';
import { DUMPS } from '../../services/dumps/catalog.js';
import { newestLocalCopy } from '../../services/dumps/localCopies.js';
import { newestSample } from '../../services/dumps/samples.js';
import { buildProgress, cancelBuild, isoDay, startBuild, type DumpBuildProgress } from '../../services/dumps/buildQueue.js';
import { keeperOf, whatTheKeptNeeds } from '../../services/dumps/keepers.js';
import { newestDump, type Newest } from '../../services/dumps/newestOnHost.js';
import {
  closeOrphanedBuilds, recentBuilds, type BuildKind, type BuildRequestRecord, type DumpBuildRow,
} from '../../services/dumps/ledger.js';
import { createError } from '../../middleware/errorHandler.js';
import type { dumpBuildBodySchema, dumpKeyParamSchema } from '../../types/index.js';

type DumpParams = z.output<typeof dumpKeyParamSchema>;
type DumpBuildBody = z.output<typeof dumpBuildBodySchema>;

/** Whether the host was asked for its newest dump since the backend started, and whether it answered. */
function checkedOf(newest: Newest): 'not-yet' | 'answered' | 'unreachable' {
  if (newest.askedAt === null) return 'not-yet';
  return newest.answered ? 'answered' : 'unreachable';
}

async function keepsOf(key: Dumps['dumps'][number]['key']): Promise<Dumps['dumps'][number]['keeps']> {
  const keeper = keeperOf(key);
  if (!keeper) return null;
  const built = await keeper.latest();
  const newest = newestDump(key);
  return {
    title: keeper.title,
    built: built ? { dumpDate: built.dumpDate, swappedAt: built.swappedAt.toISOString() } : null,
    needs: whatTheKeptNeeds(built, newest.date),
    newestDumpDate: newest.date,
    newestChecked: checkedOf(newest),
  };
}

const wireProgress = (progress: DumpBuildProgress | null): Dumps['dumps'][number]['progress'] => (progress
  ? { ...progress, heartbeatAt: progress.heartbeatAt?.toISOString() ?? null, stepStartedAt: progress.stepStartedAt?.toISOString() ?? null }
  : null);


// A row from before migration 101 asked for nothing: it was a verify or keep build the old code ran.
const kindOf = (build: DumpBuildRow): BuildKind => (build.request as BuildRequestRecord | null)?.kind ?? 'verify';

export async function listDumps(): Promise<Dumps> {
  // A build that stopped beating shows as the failure it is, not as running.
  await closeOrphanedBuilds();
  const builds = await recentBuilds();
  const keeps = await Promise.all(DUMPS.map(dump => keepsOf(dump.key)));
  const progress = await Promise.all(DUMPS.map(dump => buildProgress(dump.key)));
  const dir = process.env.DUMPS_DIR?.trim();
  const copies = await Promise.all(DUMPS.map(dump => (dir ? newestLocalCopy(dir, dump.isFileName) : null)));
  const samples = await Promise.all(DUMPS.map(dump => (dir && keeperOf(dump.key) ? newestSample(dir, dump.isFileName) : null)));
  return {
    localCopy: Boolean(process.env.DUMPS_DIR?.trim()),
    dumps: DUMPS.map((dump, index) => ({
      key: dump.key,
      source: dump.source,
      title: dump.title,
      datedBy: dump.datedBy,
      about: dump.about,
      progress: wireProgress(progress[index]),
      builds: builds.filter(build => build.dump === dump.key && build.status !== 'queued').map(build => ({
        id: build.id,
        kind: kindOf(build),
        fileName: build.file_name,
        dumpDate: build.dump_date === null ? null : isoDay(build.dump_date),
        mode: build.mode,
        bytes: Number(build.bytes),
        lines: Number(build.lines),
        checksumKind: build.checksum_kind,
        verified: build.status === 'success' && (kindOf(build) === 'verify' || kindOf(build) === 'keep'),
        status: build.status as Exclude<typeof build.status, 'queued'>,
        error: build.error,
        outcome: build.outcome,
        startedAt: build.started_at.toISOString(),
        finishedAt: build.finished_at?.toISOString() ?? null,
      })),
      keeps: keeps[index],
      localCopy: copies[index],
      sample: samples[index],
    })),
  };
}

export async function startDumpBuild(
  { params: { dump }, body: { from }, caller }: { params: DumpParams; body: DumpBuildBody; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: wireProgress(await startBuild(dump, { startedBy: caller.id, from }))! };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

export async function startDumpKeep(
  { params: { dump }, body: { from }, caller }: { params: DumpParams; body: DumpBuildBody; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: wireProgress(await startBuild(dump, { startedBy: caller.id, kind: 'keep', from }))! };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

export async function startDumpRederive(
  { params: { dump }, caller }: { params: DumpParams; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: wireProgress(await startBuild(dump, { startedBy: caller.id, kind: 'rederive' }))! };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

/** Cut a sample of the dump's local copy (#1527). */
export async function startDumpSample(
  { params: { dump }, caller }: { params: DumpParams; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: wireProgress(await startBuild(dump, { startedBy: caller.id, kind: 'sample' }))! };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

/** Try the dump's build on its sample, keeping nothing (#1527). */
export async function startDumpTrial(
  { params: { dump }, caller }: { params: DumpParams; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: wireProgress(await startBuild(dump, { startedBy: caller.id, kind: 'trial' }))! };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

export async function cancelDumpBuild({ params: { dump } }: { params: DumpParams }): Promise<DumpBuildCancelled> {
  return { cancelled: await cancelBuild(dump) };
}

/**
 * The admin panel's dump page (ADR-0101, #1433): the dumps the catalogue
 * reads, a verify build of one, a build that keeps what is made from it (the
 * local Wikidata subset, #1434), and stopping either. The URL a build fetches comes
 * from the catalog alone (`services/dumps/catalog.ts`); a caller names a dump
 * by its key, which the route's schema holds to the catalog's list.
 */

import type { z } from 'zod/v4';
import type { DumpBuildCancelled, DumpBuildStarted, Dumps } from '../../api/responses/dumps.js';
import { DUMPS } from '../../services/dumps/catalog.js';
import { newestLocalCopy } from '../../services/dumps/localCopies.js';
import { buildProgress, cancelBuild, inFlight, keeperOf, startBuild } from '../../services/dumps/job.js';
import { closeOrphanedBuilds, liveBuildOf, recentBuilds, SERVER_RUNNER } from '../../services/dumps/ledger.js';
import { createError } from '../../middleware/errorHandler.js';
import type { dumpBuildBodySchema, dumpKeyParamSchema } from '../../types/index.js';

type DumpParams = z.output<typeof dumpKeyParamSchema>;
type DumpBuildBody = z.output<typeof dumpBuildBodySchema>;

async function keepsOf(key: Dumps['dumps'][number]['key']): Promise<Dumps['dumps'][number]['keeps']> {
  const keeper = keeperOf(key);
  if (!keeper) return null;
  const built = await keeper.latest();
  return { title: keeper.title, built: built ? { dumpDate: built.dumpDate, swappedAt: built.swappedAt.toISOString() } : null };
}

/** A build of the dump that another process runs and still beats for (#1463), which this one cannot follow. */
async function elsewhereOf(key: Dumps['dumps'][number]['key']): Promise<Dumps['dumps'][number]['elsewhere']> {
  const progress = buildProgress(key);
  if (progress && inFlight(progress)) return null;
  const live = await liveBuildOf(key);
  if (!live) return null;
  return {
    buildId: live.id,
    fileName: live.file_name,
    startedAt: live.started_at.toISOString(),
    heartbeatAt: (live.heartbeat_at ?? live.started_at).toISOString(),
  };
}

export async function listDumps(): Promise<Dumps> {
  // A build that stopped beating shows as the failure it is, not as running.
  await closeOrphanedBuilds();
  const builds = await recentBuilds();
  const keeps = await Promise.all(DUMPS.map(dump => keepsOf(dump.key)));
  const elsewhere = await Promise.all(DUMPS.map(dump => elsewhereOf(dump.key)));
  const dir = process.env.DUMPS_DIR?.trim();
  const copies = await Promise.all(DUMPS.map(dump => (dir ? newestLocalCopy(dir, dump.isFileName) : null)));
  return {
    localCopy: Boolean(process.env.DUMPS_DIR?.trim()),
    dumps: DUMPS.map((dump, index) => ({
      key: dump.key,
      source: dump.source,
      title: dump.title,
      datedBy: dump.datedBy,
      about: dump.about,
      progress: buildProgress(dump.key),
      builds: builds.filter(build => build.dump === dump.key).map(build => ({
        id: build.id,
        fileName: build.file_name,
        dumpDate: build.dump_date instanceof Date ? build.dump_date.toISOString().slice(0, 10) : String(build.dump_date),
        mode: build.mode,
        bytes: Number(build.bytes),
        lines: Number(build.lines),
        checksumKind: build.checksum_kind,
        verified: build.status === 'success',
        status: build.status,
        error: build.error,
        startedAt: build.started_at.toISOString(),
        finishedAt: build.finished_at?.toISOString() ?? null,
      })),
      keeps: keeps[index],
      elsewhere: elsewhere[index],
      localCopy: copies[index],
    })),
  };
}

export async function startDumpBuild(
  { params: { dump }, body: { from }, caller }: { params: DumpParams; body: DumpBuildBody; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: await startBuild(dump, { startedBy: caller.id, runner: SERVER_RUNNER, from }) };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

export async function startDumpKeep(
  { params: { dump }, body: { from }, caller }: { params: DumpParams; body: DumpBuildBody; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: await startBuild(dump, { startedBy: caller.id, runner: SERVER_RUNNER, kind: 'keep', from }) };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

export async function cancelDumpBuild({ params: { dump } }: { params: DumpParams }): Promise<DumpBuildCancelled> {
  return { cancelled: cancelBuild(dump) };
}

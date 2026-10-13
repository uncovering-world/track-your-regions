/**
 * The admin panel's dump page (ADR-0101, #1433): the dumps the catalogue
 * reads, a verify build of one, and stopping it. The URL a build fetches comes
 * from the catalog alone (`services/dumps/catalog.ts`); a caller names a dump
 * by its key, which the route's schema holds to the catalog's list.
 */

import type { z } from 'zod/v4';
import type { DumpBuildCancelled, DumpBuildStarted, Dumps } from '../../api/responses/dumps.js';
import { DUMPS } from '../../services/dumps/catalog.js';
import { buildProgress, cancelBuild, startBuild } from '../../services/dumps/job.js';
import { recentBuilds } from '../../services/dumps/ledger.js';
import { createError } from '../../middleware/errorHandler.js';
import type { dumpKeyParamSchema } from '../../types/index.js';

type DumpParams = z.output<typeof dumpKeyParamSchema>;

export async function listDumps(): Promise<Dumps> {
  const builds = await recentBuilds();
  return {
    localCopy: Boolean(process.env.DUMPS_DIR?.trim()),
    dumps: DUMPS.map(dump => ({
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
    })),
  };
}

export async function startDumpBuild(
  { params: { dump }, caller }: { params: DumpParams; caller: Express.User },
): Promise<DumpBuildStarted> {
  try {
    return { started: true, progress: startBuild(dump, caller.id) };
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'The build could not start', 409);
  }
}

export async function cancelDumpBuild({ params: { dump } }: { params: DumpParams }): Promise<DumpBuildCancelled> {
  return { cancelled: cancelBuild(dump) };
}

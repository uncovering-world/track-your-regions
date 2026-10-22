/**
 * The public dumps the catalogue reads, their builds, a verify build of one
 * (ADR-0101, #1433), a build that keeps what is made from it (#1434),
 * deriving what is kept again without the dump (#1526), cutting a sample
 * of the local copy to try the build on (#1527), and how often the dump worker
 * brings what is kept forward by itself (#1437).
 */

import type { DumpBuildCancelled, DumpBuildStarted, Dumps, DumpSchedule } from '../client.generated';
import {
  getAdminDumps, postAdminDumpsByDumpBuild, postAdminDumpsByDumpCancel, postAdminDumpsByDumpKeep, postAdminDumpsByDumpRederive,
  postAdminDumpsByDumpSample, postAdminDumpsByDumpTrial, putAdminDumpsByDumpSchedule,
} from '../client.generated';

export type { DumpBuild, DumpBuildProgress, Dumps, DumpSchedule, DumpsDumpsItem, DumpsDumpsItemKey } from '../client.generated';

export async function getDumps(): Promise<Dumps> {
  return getAdminDumps();
}

/** Where a build reads from: the newest file the host lists, or the local copy's own (#1456). */
export type DumpBuildFrom = 'newest' | 'local';

export async function startDumpBuild(dump: Parameters<typeof postAdminDumpsByDumpBuild>[0], from: DumpBuildFrom = 'newest'): Promise<DumpBuildStarted> {
  return postAdminDumpsByDumpBuild(dump, { from });
}

export async function startDumpKeep(dump: Parameters<typeof postAdminDumpsByDumpKeep>[0], from: DumpBuildFrom = 'newest'): Promise<DumpBuildStarted> {
  return postAdminDumpsByDumpKeep(dump, { from });
}

export async function startDumpRederive(dump: Parameters<typeof postAdminDumpsByDumpRederive>[0]): Promise<DumpBuildStarted> {
  return postAdminDumpsByDumpRederive(dump);
}

export async function startDumpSample(dump: Parameters<typeof postAdminDumpsByDumpSample>[0]): Promise<DumpBuildStarted> {
  return postAdminDumpsByDumpSample(dump);
}

export async function startDumpTrial(dump: Parameters<typeof postAdminDumpsByDumpTrial>[0]): Promise<DumpBuildStarted> {
  return postAdminDumpsByDumpTrial(dump);
}

export async function cancelDumpBuild(dump: Parameters<typeof postAdminDumpsByDumpCancel>[0]): Promise<DumpBuildCancelled> {
  return postAdminDumpsByDumpCancel(dump);
}

/** Bring what is kept forward every `everyDays` days (1–30), or never by itself (null). */
export async function setDumpSchedule(dump: Parameters<typeof putAdminDumpsByDumpSchedule>[0], everyDays: number | null): Promise<DumpSchedule> {
  return putAdminDumpsByDumpSchedule(dump, { everyDays });
}

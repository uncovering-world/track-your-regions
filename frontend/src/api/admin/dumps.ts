/**
 * The public dumps the catalogue reads, their builds, and a verify build of one
 * (ADR-0101, #1433).
 */

import type { DumpBuildCancelled, DumpBuildStarted, Dumps } from '../client.generated';
import { getAdminDumps, postAdminDumpsByDumpBuild, postAdminDumpsByDumpCancel } from '../client.generated';

export type { DumpBuild, DumpBuildProgress, Dumps, DumpsDumpsItem, DumpsDumpsItemKey } from '../client.generated';

export async function getDumps(): Promise<Dumps> {
  return getAdminDumps();
}

export async function startDumpBuild(dump: Parameters<typeof postAdminDumpsByDumpBuild>[0]): Promise<DumpBuildStarted> {
  return postAdminDumpsByDumpBuild(dump);
}

export async function cancelDumpBuild(dump: Parameters<typeof postAdminDumpsByDumpCancel>[0]): Promise<DumpBuildCancelled> {
  return postAdminDumpsByDumpCancel(dump);
}

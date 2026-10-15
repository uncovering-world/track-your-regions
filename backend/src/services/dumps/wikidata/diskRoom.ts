/**
 * Whether the disk can hold what a subset build's write pass is about to
 * write (#1466). The subset's tables are unlogged (ADR-0105 decision 5), so a
 * database that runs out of disk mid-build crashes and comes back with them
 * empty; the write pass is refused before it starts instead.
 *
 * The first pass knows what every line weighs and what the kept ones do
 * (`ScopeCounts.bytes`, `keptBytes`). What the build writes follows each:
 * the tables follow the kept lines — the compact entity, stored compressed,
 * with the derived tables and their indexes beside it — and the terms spool
 * follows the lines it does not keep, whose labels and descriptions it holds.
 * `TABLES_SHARE` and `SPOOL_SHARE` are those shares: measured on the first
 * 4 GB of the 2026-10-05 dump's JSON, built into Postgres with every index,
 * at 0.37 and 0.0034, and set above that, at 0.45 and 0.005, for a part of
 * the dump whose mix differs. The sample under-counts the labels ring and the
 * class closure, which fill in only over the whole dump, so the first full
 * build's table sizes check the 0.45. `HEADROOM` is what is left free for
 * everything else on the disk.
 */

import { diskOf, sameDisk, type Disk } from '../localCopies.js';
import type { ScopeCounts } from './scope.js';

/** Bytes the tables take per byte of kept dump line. */
export const TABLES_SHARE = 0.45;
/** Bytes the spool takes per byte of dump line the build does not keep. */
export const SPOOL_SHARE = 0.005;
/** Bytes kept free beside the build. */
export const HEADROOM = 20 * 1024 ** 3;

const GB = 1024 ** 3;
const gb = (bytes: number) => `${(bytes / GB).toFixed(0)} GB`;


interface Need {
  dir: string;
  bytes: number;
}

/**
 * Throws, naming the figures, when a disk cannot hold what the build writes
 * to it and the headroom: the spool to `spoolDir`'s disk, the tables to the
 * database's (`dbDir`, a path on it the backend can see: `DB_DISK_DIR`, where
 * compose mounts the database's volume), both to one disk where they share it.
 * Answers what it could not check: without `dbDir` the database's disk is the
 * operator's to watch.
 */
export async function assertRoomToWrite(
  spoolDir: string, counts: Pick<ScopeCounts, 'bytes' | 'keptBytes'>, dbDir = process.env.DB_DISK_DIR?.trim() || undefined,
  /** What an earlier build of the same file already wrote, which a build picking up after it (#1493) does not write again. */
  written: { tables: number; spool: number } = { tables: 0, spool: 0 },
): Promise<string[]> {
  const needs: Need[] = [{ dir: spoolDir, bytes: Math.max(0, (counts.bytes - counts.keptBytes) * SPOOL_SHARE - written.spool) }];
  if (dbDir) needs.push({ dir: dbDir, bytes: Math.max(0, counts.keptBytes * TABLES_SHARE - written.tables) });
  const disks: Array<{ disk: Disk; dir: string; need: number }> = [];
  for (const need of needs) {
    const disk = await diskOf(need.dir);
    const seen = disks.find(entry => sameDisk(entry.disk, disk));
    // Two disks of the same size read as one keep the smaller free space, so
    // a wrong match only makes the check stricter.
    if (seen) {
      seen.need += need.bytes;
      seen.disk = { ...seen.disk, free: Math.min(seen.disk.free, disk.free) };
      seen.dir = `${seen.dir} and ${need.dir}`;
    }
    else disks.push({ disk, dir: need.dir, need: need.bytes });
  }
  for (const { disk: { free }, dir, need } of disks) {
    if (free < need + HEADROOM) {
      throw new Error(
        `The subset would write about ${gb(need)} to the disk of ${dir} and keep ${gb(HEADROOM)} free, but it has ${gb(free)}: free some space and build again`,
      );
    }
  }
  return dbDir ? [] : ['the database\'s disk was not checked: DB_DISK_DIR names no path on it'];
}

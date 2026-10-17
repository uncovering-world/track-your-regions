/**
 * The local copies of a dump in `DUMPS_DIR`, told apart by their date
 * (#1456). Every file the catalog names carries its date as the second part
 * of its name — `wikidata-20261005-all.json.gz`, `enwiki-20261001-page.sql.gz`,
 * `pageviews-202609-user.bz2` — and `copyOf` reads a name's dump and date,
 * with its leftovers: a ranged download's `.part` and its state, and a subset
 * build's terms spool and first-pass result (`.scope`).
 *
 * A dump dated by day keeps one copy: a newer file replaces the older one,
 * since the full entities dump is 156 GB and two of them do not fit where one
 * does. The older copy goes once the newer one is verified, or before the
 * download when the disk cannot hold both. The monthly pageview files are
 * twelve different months, not copies of one another, and stay. One build
 * per dump runs at a time in any process (`job.ts`), so the copy a build of
 * that dump reads is always the newest, and never an older one this removes.
 */

import { readdir, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const LEFTOVER = /(?:\.part(?:\.json(?:\.tmp)?)?|\.terms\.gz|\.scope(?:\.tmp)?)$/;
const DATED = /^([a-z]+)-(\d{6}|\d{8})-(.+)$/;

export interface Copy {
  /** The name with its date taken out: what every copy of the dump shares. */
  dump: string;
  date: string;
}

export function copyOf(name: string): Copy | null {
  const match = DATED.exec(baseName(name));
  return match ? { dump: `${match[1]}-*-${match[3]}`, date: match[2] } : null;
}

/**
 * The files in `dir` that belong to older copies of the dump `fileName` is a
 * file of, with their leftovers. Only a dump a newer file replaces has
 * copies to remove (`datedBy: 'day'`): the monthly pageview files are twelve
 * different months, which readership reads together (ADR-0055 decision 1),
 * and none of them is an older copy of another; readership's build removes
 * each once its month is kept (`retiredCopies`, #1436). `isFileName` is the
 * catalog's test for the dump's files.
 */
export async function olderCopies(dir: string, fileName: string, isFileName: (name: string) => boolean): Promise<string[]> {
  const self = copyOf(fileName);
  if (!self) return [];
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter(name => {
    const copy = copyOf(name);
    return copy !== null && copy.dump === self.dump && copy.date < self.date && isFileName(baseName(name));
  }).sort();
}

/** A copy's own file name, without the leftovers' suffixes. */
function baseName(name: string): string {
  return name.replace(LEFTOVER, '');
}

export async function removeCopies(dir: string, names: string[]): Promise<void> {
  for (const name of names) await rm(join(dir, name), { force: true });
}

/** The bytes free to this process on the disk `dir` is on. */
export async function freeBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

export interface Disk {
  /** The device `stat` reports for the path. */
  device: number;
  /** The filesystem's size as `statfs` reports it: blocks of `bsize` bytes. */
  blocks: number;
  bsize: number;
  free: number;
}

/** The disk `dir` is on, and the bytes free on it. */
export async function diskOf(dir: string): Promise<Disk> {
  const [stats, fs] = await Promise.all([stat(dir), statfs(dir)]);
  return { device: stats.dev, blocks: fs.blocks, bsize: fs.bsize, free: fs.bavail * fs.bsize };
}

/**
 * Whether two paths are on one disk: the same device, or the same filesystem
 * size, which is what tells a container's overlay `/tmp` (an anonymous
 * device) from the Docker volume beside it on the same host disk.
 */
export function sameDisk(a: Disk, b: Disk): boolean {
  return a.device === b.device || (a.blocks === b.blocks && a.bsize === b.bsize);
}

export interface LocalCopy {
  fileName: string;
  /** The copy's date as its name gives it: `YYYYMMDD`, or `YYYYMM` for a month's counts. */
  date: string;
  bytes: number;
}

/**
 * The newest copy in `dir` whose name is one of the dump's files (`isFileName`
 * in the catalog). A ranged download takes that name only once it is whole;
 * a copy written in order before #1455 may still be short, and a build from
 * it brings it to full size first.
 */
export async function newestLocalCopy(dir: string, isFileName: (name: string) => boolean): Promise<LocalCopy | null> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter(isFileName);
  const newest = names.map(name => ({ name, date: copyOf(name)?.date ?? '' })).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!newest) return null;
  const bytes = await stat(join(dir, newest.name)).then(s => s.size).catch(() => null);
  return bytes === null ? null : { fileName: newest.name, date: newest.date, bytes };
}

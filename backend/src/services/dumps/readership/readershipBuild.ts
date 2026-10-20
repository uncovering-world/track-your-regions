/**
 * A keeping build of `pageviews-user` (#1436, ADR-0055): readership over the
 * last twelve complete months.
 *
 * The build resolves the newest month the host has finished and keeps every
 * month of the twelve that ends there and is not kept already from the same
 * file, oldest first. A month is read through `readDump` like any dump, so it
 * is verified by its size and the bzip2 stream's clean end, and kept only once
 * it is; a month that fails leaves the months before it kept, and the next
 * build picks up after them. Months before the twelve are dropped once the
 * twelve are in place.
 *
 * A month's local copy (about 6 GB) is removed once the month is kept, and so
 * is any copy of a month kept already or older than the twelve: the kept rows
 * are what readership reads, and a month read again is downloaded again. Kept,
 * twelve copies would hold some 70 GB beside the entities dump for nothing.
 *
 * One month on this repository's development machine: about half an hour, the
 * single-threaded bzip2 decoder the limit (the Alpine image has no parallel
 * one, `read.ts`). A year from nothing is some six hours; a yearly rebuild
 * reads the months it lacks.
 */

import { readdir } from 'node:fs/promises';
import type { DumpFile } from '../catalog.js';
import { dumpNamed } from '../catalog.js';
import { fetchText, sizeOf } from '../fetch.js';
import { copyOf, removeCopies } from '../localCopies.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { readDump, type ReadOptions } from '../read.js';
import type { FoldTitles } from './foldTitles.js';
import { DAILY_FLOOR, MONTH_FLOOR, MonthSummer } from './monthSummer.js';
import {
  dropMonthsBefore, emptyStaging, foldTitles, keepMonth, keptMonths, redirectsInPlace, refuseShortMonth, stageRows,
} from './readershipMonth.js';

/** How many months readership reads (ADR-0055 decision 1). */
export const READERSHIP_MONTHS = 12;
const STAGE_BATCH = 20_000;

/** `YYYY-MM-01` of the month `back` months before `month`. */
export function monthBefore(month: string, back: number): string {
  const [year, mon] = month.split('-').map(Number);
  const index = year * 12 + (mon - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** The twelve months ending at `newest`, oldest first. */
export function readershipWindow(newest: string): string[] {
  return Array.from({ length: READERSHIP_MONTHS }, (_, i) => monthBefore(newest, READERSHIP_MONTHS - 1 - i));
}

/** The file of a month: `2026-09-01` is `pageviews-202609-user.bz2`. */
export const fileNameOf = (month: string) => `pageviews-${month.slice(0, 4)}${month.slice(5, 7)}-user.bz2`;

const daysIn = (month: string) => {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
};

type BuildOptions = ReadOptions & { buildId: number; onPhase: (message: string) => void; trial?: boolean };

/**
 * The files in a local copy's directory to remove once months are kept: the
 * copy of a month kept, or of a month older than the twelve, with its
 * leftovers (a ranged download's `.part` and state). A copy of a month in the
 * twelve that is not kept stays, since a cut download resumes from it.
 */
export function retiredCopies(names: readonly string[], first: string, kept: ReadonlySet<string>): string[] {
  const isFileName = dumpNamed('pageviews-user')!.isFileName;
  return names.filter(name => {
    const copy = copyOf(name);
    if (!copy || copy.date.length !== 6) return false;
    const fileName = `pageviews-${copy.date}-user.bz2`;
    if (!isFileName(fileName) || !name.startsWith(fileName)) return false;
    return kept.has(fileName) || `${copy.date.slice(0, 4)}-${copy.date.slice(4)}-01` < first;
  }).sort();
}

/** Remove the copies `retiredCopies` names from the local copy's directory, and say so. */
async function retireCopies(options: BuildOptions, first: string, kept: ReadonlySet<string>): Promise<void> {
  if (!options.dumpsDir) return;
  const gone = retiredCopies(await readdir(options.dumpsDir).catch(() => [] as string[]), first, kept);
  if (gone.length === 0) return;
  await removeCopies(options.dumpsDir, gone);
  options.onNote?.(`removed the local copies of the months kept or past the twelve: ${gone.join(', ')}`);
}

/** The host's file of `month`, verified the way the newest one is. */
async function fileOfMonth(month: string, signal: AbortSignal): Promise<DumpFile> {
  const descriptor = dumpNamed('pageviews-user')!;
  const name = fileNameOf(month);
  const file = await descriptor.resolve(url => fetchText(url, signal), url => sizeOf(url, signal), candidate => candidate === name);
  if (!file) throw new Error(`The host no longer lists ${name}, which readership's twelve months need`);
  return file;
}

/** The titles a month stages under the floor, read when the first month that needs them is read, and once. */
function readOnce(options: BuildOptions): () => Promise<FoldTitles> {
  let read: Promise<FoldTitles> | undefined;
  return () => {
    if (!read) {
      options.onPhase('Reading the redirects readership folds...');
      read = foldTitles();
    }
    return read;
  };
}

/** Read one month's file and keep it; answers what was read and kept. */
async function keepOneMonth(file: DumpFile, month: string, folded: () => Promise<FoldTitles>, options: BuildOptions): Promise<{ bytes: number; lines: number; kept: number }> {
  const { buildId } = options;
  await emptyStaging();
  const summer = new MonthSummer({
    days: daysIn(month), floor: MONTH_FLOOR, dailyFloor: DAILY_FLOOR, folded: await folded(), batch: STAGE_BATCH,
    onBatch: rows => stageRows(buildId, rows),
  });
  let kept = 0;
  const read = await readDump(file, {
    line: text => summer.line(text),
    commit: async () => {
      await summer.finish();
      const monthRead = { buildId, month, fileName: file.fileName, lines: summer.lines, editions: summer.editionViews };
      refuseShortMonth(monthRead);
      options.onPhase(`Keeping ${month.slice(0, 7)}: summing ${file.fileName} per item...`);
      kept = await keepMonth(monthRead);
    },
    abort: () => emptyStaging(),
  }, options);
  return { bytes: read.bytes, lines: read.lines, kept };
}

/**
 * Keep the twelve months ending at `file`'s, each not already kept from the
 * same file with the redirects in place (#1650): a month folded with older
 * redirects, or with none, is read again. The newest month's figures are what
 * the build's row records.
 */
export async function buildReadership(file: DumpFile, options: BuildOptions): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  if (options.trial) throw new Error('Readership has no trial build: a month is kept from its whole file');
  const window = readershipWindow(file.date);
  const kept = await keptMonths();
  const redirects = await redirectsInPlace();
  const said: string[] = [];
  let newest = { bytes: 0, lines: 0 };
  let read = 0;
  const folded = readOnce(options);
  for (const [i, month] of window.entries()) {
    const already = kept.get(month);
    if (already?.fileName === fileNameOf(month) && already.redirects === redirects) {
      // Verified when it was kept: the row records those figures, not a read of nothing.
      if (month === file.date) newest = { bytes: file.expectedBytes ?? 0, lines: already.lines };
      continue;
    }
    options.onPhase(`Reading ${fileNameOf(month)} (month ${i + 1} of ${window.length})${options.dumpsDir ? ' into the local copy' : ' from the host'}...`);
    const monthFile = month === file.date ? file : await fileOfMonth(month, options.signal);
    const done = await keepOneMonth(monthFile, month, folded, options);
    await retireCopies(options, window[0], new Set([monthFile.fileName]));
    read++;
    said.push(`${month.slice(0, 7)} ${done.kept.toLocaleString('en')} rows`);
    if (month === file.date) newest = done;
  }
  const dropped = await dropMonthsBefore(window[0]);
  await retireCopies(options, window[0], new Set([...(await keptMonths()).values()].map(m => m.fileName)));
  return { ...newest, checksumActual: null, summary: summaryOf(read, said, dropped, window[0]) };
}

/** What the build did, for its row: the months it kept, or that it kept none, and the months it dropped. */
function summaryOf(read: number, said: readonly string[], dropped: number, first: string): string {
  return [
    read === 0 ? 'every month of the twelve was kept already' : `kept ${said.join(', ')}`,
    ...(dropped > 0 ? [`dropped ${dropped} month${dropped === 1 ? '' : 's'} before ${first.slice(0, 7)}`] : []),
  ].join('; ');
}

/**
 * The readership in place: its newest month, and whether all twelve are there
 * and folded with the redirects in place (#1650); a build reads again the
 * months that are not.
 */
export async function latestReadership(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const kept = await keptMonths();
  if (kept.size === 0) return null;
  const redirects = await redirectsInPlace();
  const months = [...kept.keys()].sort();
  const newest = months[months.length - 1];
  const whole = readershipWindow(newest).every(month => kept.get(month)?.redirects === redirects);
  return { dumpDate: newest, swappedAt: kept.get(newest)!.builtAt, needs: whole ? 'nothing' : 'rebuild' };
}

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
 * A build may instead keep the twelve months ending on a month an admin names
 * (`windowEnd`, #2230), beside the current year: the admission review
 * derives the same bars on two years and measures the churn. Its months are
 * recorded with that window (`readership_month_files.window_end`), the
 * cleanup keeps them whatever their date, and no run reads them: the year in
 * place is the newest month kept with no window, and the counted editions are
 * summed over those months alone. A month holds one window, so two years
 * cannot share one: a year is refused before it is queued where its twelve
 * overlap the year in place, the year to come (the twelve ending on the
 * newest month the host lists, which the next current build reads) or an
 * earlier year kept already, or where it cannot be judged — the host's newest
 * month not known yet, and the year asked for ending after the year in place
 * or no year in place (`refuseOverlappingYear`); every later current build
 * ends on a newer host month, so a year clear of both stays clear.
 *
 * A month's local copy (about 6 GB) is removed once the month is kept, and so
 * is any copy of a month kept already or older than the twelve: the kept rows
 * are what readership reads, and a month read again is downloaded again. Kept,
 * twelve copies would hold some 70 GB beside the entities dump for nothing.
 *
 * One month on this repository's development machine: about half an hour, the
 * single-threaded bzip2 decoder the limit (the worker's image installs no
 * parallel one, `read.ts`). A year from nothing is some six hours; a yearly rebuild
 * reads the months it lacks.
 */

import { readdir } from 'node:fs/promises';
import type { DumpFile } from '../catalog.js';
import { dumpNamed, pageviewsFileName as fileNameOf } from '../catalog.js';
import { fetchText, sizeOf } from '../fetch.js';
import { copyOf, removeCopies } from '../localCopies.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { readDump, type ReadOptions } from '../read.js';
import type { FoldTitles } from './foldTitles.js';
import { DAILY_FLOOR, MONTH_FLOOR, MonthSummer } from './monthSummer.js';
import {
  dropMonthsBefore, emptyStaging, foldTitles, keepMonth, keptMonths, redirectsInPlace, refuseShortMonth, stageRows, type KeptMonth,
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

const daysIn = (month: string) => {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
};

type BuildOptions = ReadOptions & {
  buildId: number;
  onPhase: (message: string) => void;
  trial?: boolean;
  /** The month the year ends on, `YYYY-MM`, for a year kept beside the current one (#2230); absent, the current year. */
  windowEnd?: string;
};

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

/** Read one month's file and keep it under `windowEnd`'s year; answers what was read and kept. */
async function keepOneMonth(
  file: DumpFile, month: string, windowEnd: string | null, folded: () => Promise<FoldTitles>, options: BuildOptions,
): Promise<{ bytes: number; lines: number; kept: number }> {
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
      const monthRead = { buildId, month, fileName: file.fileName, lines: summer.lines, editions: summer.editionViews, windowEnd };
      refuseShortMonth(monthRead);
      options.onPhase(`Keeping ${month.slice(0, 7)}: summing ${file.fileName} per item...`);
      kept = await keepMonth(monthRead);
    },
    abort: () => emptyStaging(),
  }, options);
  return { bytes: read.bytes, lines: read.lines, kept };
}

/**
 * Whether a month kept already needs no read: it came from the file of its
 * name, was folded with the redirects in place (#1650), and was kept for the
 * year being built (#2230) — a month under another window is read again as
 * this year's, since a month holds one window and this year owns the month.
 */
function keptAlready(already: KeptMonth | undefined, month: string, redirects: number | null, windowEnd: string | null): already is KeptMonth {
  return already !== undefined && already.fileName === fileNameOf(month) && already.redirects === redirects && already.windowEnd === windowEnd;
}

/**
 * Keep the twelve months ending at `file`'s, each not already kept from the
 * same file with the redirects in place (#1650): a month folded with older
 * redirects, or with none, is read again. The newest month's figures are what
 * the build's row records. With `windowEnd`, the twelve are an earlier year
 * kept beside the current one (#2230), and `file` is its last month. An
 * earlier year never shares a month with the current one: the queue refuses a
 * year whose twelve overlap the year in place or the year to come, the twelve
 * ending on the newest month the host lists (`refuseOverlappingYear`), and
 * every later current build ends on a newer host month still, so the
 * cleanup's rule — drop the current months before the twelve, keep every
 * month under a window — leaves no month to hand over.
 */
export async function buildReadership(file: DumpFile, options: BuildOptions): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  if (options.trial) throw new Error('Readership has no trial build: a month is kept from its whole file');
  const windowEnd = options.windowEnd === undefined ? null : `${options.windowEnd}-01`;
  if (windowEnd !== null && file.date !== windowEnd) throw new Error(`The year ending ${options.windowEnd} is built from that month's file, not from ${file.fileName}`);
  const window = readershipWindow(file.date);
  const year = await keepMissingMonths(file, window, windowEnd, options);
  const dropped = windowEnd === null ? await dropMonthsBefore(window[0]) : 0;
  await retireCopies(options, window[0], new Set([...(await keptMonths()).values()].map(m => m.fileName)));
  return { ...year.newest, checksumActual: null, summary: summaryOf(year.read, year.said, dropped, window[0], options.windowEnd) };
}

/** Read and keep each month of `window` not kept already, oldest first; answers how many, what they kept, and the figures of `file`'s month. */
async function keepMissingMonths(
  file: DumpFile, window: readonly string[], windowEnd: string | null, options: BuildOptions,
): Promise<{ read: number; said: string[]; newest: { bytes: number; lines: number } }> {
  const kept = await keptMonths();
  const redirects = await redirectsInPlace();
  const said: string[] = [];
  let newest = { bytes: 0, lines: 0 };
  let read = 0;
  const folded = readOnce(options);
  for (const [i, month] of window.entries()) {
    const already = kept.get(month);
    if (keptAlready(already, month, redirects, windowEnd)) {
      // Verified when it was kept: the row records those figures, not a read of nothing.
      if (month === file.date) newest = { bytes: file.expectedBytes ?? 0, lines: already.lines };
      continue;
    }
    options.onPhase(`Reading ${fileNameOf(month)} (month ${i + 1} of ${window.length})${options.dumpsDir ? ' into the local copy' : ' from the host'}...`);
    const monthFile = month === file.date ? file : await fileOfMonth(month, options.signal);
    const done = await keepOneMonth(monthFile, month, windowEnd, folded, options);
    await retireCopies(options, window[0], new Set([monthFile.fileName]));
    read++;
    said.push(`${month.slice(0, 7)} ${done.kept.toLocaleString('en')} rows`);
    if (month === file.date) newest = done;
  }
  return { read, said, newest };
}

const span = (months: readonly string[]) => `${months[0].slice(0, 7)} to ${months[months.length - 1].slice(0, 7)}`;

/**
 * The current years an earlier one is judged against, each by its newest
 * month, `YYYY-MM-01`, or null while not known: the year in place, and the
 * year to come, the twelve ending on the newest month the host lists, which
 * the next current build reads and which may stand a year or more past the
 * one in place.
 */
export interface CurrentYears { inPlace: string | null; toCome: string | null }

const CURRENT = [
  { of: (years: CurrentYears) => years.inPlace, label: 'the current year' },
  { of: (years: CurrentYears) => years.toCome, label: 'the current year to come, the twelve ending on the newest month the host lists' },
];

/**
 * Why the year ending `windowEnd` (`YYYY-MM`) cannot be kept beside the others,
 * or null where it can (#2230): a month holds one window, so its twelve may
 * share none with a current year (`currents`, each where known) nor with an
 * earlier year kept already (`archives`, each by its end, `YYYY-MM`). What
 * cannot be judged is refused rather than let through, since the next current
 * build would take the shared months and leave the rest listed as a year: with
 * neither current year known, any year; with the year to come not known, a
 * year ending after the year in place, which that build may reach — one
 * ending before the year in place needs no word from the host. Asking again
 * for a year kept already, whole or cut short, is a resume and is allowed.
 */
export function yearCollision(windowEnd: string, currents: CurrentYears, archives: readonly string[]): string | null {
  const cannot = `The year ending ${windowEnd} cannot be judged yet: the host's newest month is not known yet`;
  if (currents.inPlace === null && currents.toCome === null) return `${cannot}, and no year is in place`;
  if (currents.toCome === null && `${windowEnd}-01` > currents.inPlace!) {
    return `${cannot}, and the year ending ${windowEnd} ends after the current year (${span(readershipWindow(currents.inPlace!))})`;
  }
  const asked = readershipWindow(`${windowEnd}-01`);
  const shared = (months: readonly string[]) => asked.filter(month => months.includes(month));
  for (const current of CURRENT) {
    const newest = current.of(currents);
    if (newest === null) continue;
    const months = readershipWindow(newest);
    const common = shared(months);
    if (common.length > 0) return `The year ending ${windowEnd} shares ${span(common)} with ${current.label} (${span(months)})`;
  }
  for (const end of archives) {
    if (end === windowEnd) continue;
    const months = readershipWindow(`${end}-01`);
    const common = shared(months);
    if (common.length > 0) return `The year ending ${windowEnd} shares ${span(common)} with the year ending ${end} kept beside the current one (${span(months)})`;
  }
  return null;
}

/**
 * Refuse the year ending `windowEnd` where it would share a month with the
 * year in place, the year to come or an earlier one kept, or where it cannot
 * be judged (`yearCollision`); `newestOnHost` is the newest month the host
 * lists as last learnt, `YYYY-MM-DD`, or null while it is not known.
 */
export async function refuseOverlappingYear(windowEnd: string, newestOnHost: string | null): Promise<void> {
  const latest = await latestReadership();
  const collision = yearCollision(windowEnd, { inPlace: latest?.dumpDate ?? null, toCome: newestOnHost }, await readershipArchives());
  if (collision) throw new Error(collision);
}

/**
 * What the build did, for its row: the months it kept, or that it kept none;
 * the months it dropped; and, for an earlier year, which year and that the
 * current one stands.
 */
export function summaryOf(read: number, said: readonly string[], dropped: number, first: string, windowEnd?: string): string {
  return [
    read === 0 ? 'every month of the twelve was kept already' : `kept ${said.join(', ')}`,
    ...(dropped > 0 ? [`dropped ${dropped} month${dropped === 1 ? '' : 's'} before ${first.slice(0, 7)}`] : []),
    ...(windowEnd ? [`kept the year ending ${windowEnd} beside the current one`] : []),
  ].join('; ');
}

/**
 * The readership in place: its newest month, and whether all twelve are there
 * and folded with the redirects in place (#1650); a build reads again the
 * months that are not. The year in place is the newest month kept with no
 * window, and only such months make it whole (#2230): an earlier year an
 * admin asked for may be newer than anything the current year holds, as
 * before the first current build, and is never what the runs read.
 */
export async function latestReadership(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const kept = await keptMonths();
  const redirects = await redirectsInPlace();
  const months = [...kept.entries()].filter(([, month]) => month.windowEnd === null).map(([month]) => month).sort();
  if (months.length === 0) return null;
  const newest = months[months.length - 1];
  const whole = readershipWindow(newest).every(month => {
    const held = kept.get(month);
    return held !== undefined && held.windowEnd === null && held.redirects === redirects;
  });
  return { dumpDate: newest, swappedAt: kept.get(newest)!.builtAt, needs: whole ? 'nothing' : 'rebuild' };
}

/** The earlier years kept beside the current one (#2230), each by the month it ends on, `YYYY-MM`, oldest first. */
export async function readershipArchives(): Promise<string[]> {
  const kept = await keptMonths();
  return [...new Set([...kept.values()].flatMap(month => (month.windowEnd === null ? [] : [month.windowEnd.slice(0, 7)])))].sort();
}

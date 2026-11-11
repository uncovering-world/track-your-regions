/**
 * The dumps a build can keep something from, and what builds it: the local
 * Wikidata subset from the entities dump (#1434), and readership from the
 * monthly pageview files (#1436), English Wikipedia's structure from its
 * page table's dump and the three of the same date (#1440), and the redirects
 * readership folds from the redirect and page tables of every edition a door
 * counts (#1650), the Wikidata items every Wikivoyage edition uses, the
 * travel-guide witness of a place a visitor goes to (#1768), English
 * Wikivoyage's articles the world-view extraction reads (#2089), and the
 * OpenStreetMap layer cut from the planet (#1437, ADR-0134).
 */

import type { DumpFile, DumpKey } from './catalog.js';
import { buildLayer, hasCurrentPlanet, updateLayer } from './osm/layerBuild.js';
import { latestLayer } from './osm/layerTables.js';
import { DEFAULT_EVERY_DAYS } from './osm/layerSchedule.js';
import { scheduleOf, setScheduleOf, type CopySchedule } from './copySchedule.js';
import type { ReadOptions } from './read.js';
import { buildReadership, latestReadership, readershipArchives, refuseOverlappingYear } from './readership/readershipBuild.js';
import { buildRedirects } from './wikipedia/redirectBuild.js';
import { latestRedirects } from './wikipedia/redirectTables.js';
import { buildWikidataRedirects } from './wikidata/redirectBuild.js';
import { latestWikidataRedirects } from './wikidata/redirectTables.js';
import { buildStructure } from './wikipedia/structureBuild.js';
import { latestStructure } from './wikipedia/structureTables.js';
import { buildSubset, rederiveSubset, type RederiveOptions } from './wikidata/subsetBuild.js';
import type { CopyNeeds } from './wikidata/buildRules.js';
import { latestSubset } from './wikidata/subsetTables.js';
import { buildPages } from './wikivoyage/pageBuild.js';
import { latestPages } from './wikivoyage/pageTables.js';
import { buildUsage } from './wikivoyage/usageBuild.js';
import { latestUsage } from './wikivoyage/usageTables.js';

export interface Kept {
  /** The dump date of the build now in place, and when it was swapped in. */
  dumpDate: string;
  swappedAt: Date;
  /** What it needs to match the code's rules (#1583): nothing, a re-derive, or a build from the dump. */
  needs: CopyNeeds;
  /**
   * What, beyond its dump date, tells two states of the copy apart: for
   * readership, which redirects builds folded its twelve months
   * (`build@date×months`), so a run before the refold and one after it read the
   * same dump date and still record different copies (#2415).
   */
  revision?: string;
}

export interface Keeper {
  /** What a keeping build of the dump makes, for the admin panel. */
  title: string;
  /** Build from `file` and swap the result in, or, as a `trial`, build and throw it away (#1527). */
  build(file: DumpFile, options: ReadOptions & {
    buildId: number; onPhase: (message: string) => void; trial?: boolean;
    /** How far a step that reads a file of its own has got (#1519). */
    onMeasure?: (read: number, total: number) => void;
    /** The month the year built ends on, `YYYY-MM`, for a year kept beside the current one (readership, #2230). */
    windowEnd?: string;
  }):
    Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }>;
  /** The earlier years kept beside the current one, each by the month it ends on, `YYYY-MM`, oldest first (readership, #2230). */
  archives?(): Promise<string[]>;
  /**
   * Refuse the year ending `windowEnd` (`YYYY-MM`) where it would share a month
   * with the current year or an earlier one kept (readership, #2230);
   * `newestOnHost` is the host's newest file's date as last learnt, or null.
   */
  refuseYearEnd?(windowEnd: string, newestOnHost: string | null): Promise<void>;
  /**
   * Whether a sample of the local copy can be cut and the build tried on it
   * (#1527): the subset's build can, readership's cannot, since a month is
   * kept only from its whole file.
   */
  samples: boolean;
  /**
   * Whether a keeping build may start from the local copy instead of the
   * newest file (#1456): the subset's can; readership's year always ends at
   * the newest month, and the only copy it leaves is a month not kept yet.
   */
  fromCopy: boolean;
  /**
   * Bring what is kept forward from a source the keeper holds itself, reading
   * no file of the host's: the OpenStreetMap layer's current planet, brought
   * forward with the daily diffs (#1437). A keeping build from the newest
   * takes this path where `canUpdate` says so, and records no host file,
   * since it read none.
   */
  update?(options: ReadOptions & { buildId: number; onPhase: (message: string) => void; onMeasure?: (read: number, total: number) => void }):
    Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }>;
  canUpdate?(): Promise<boolean>;
  /**
   * How often the dump worker brings the copy forward by itself, which an admin
   * may change or turn off (ADR-0195; the OpenStreetMap layer's since ADR-0134
   * decision 6): once the host has a newer dump and the copy is older than the
   * interval (`copySchedule.ts`), or, for the layer, once the daily diffs pass it.
   */
  schedule: {
    defaultEveryDays: number;
    read(): Promise<CopySchedule>;
    set(everyDays: number | null, adminId: number): Promise<CopySchedule>;
  };
  /** Derive the build in place's tables again from what it holds, without the dump (#1526). */
  rederive?(options: RederiveOptions): Promise<void>;
  /** The build now in place, if any. */
  latest(): Promise<Kept | null>;
  /**
   * Whether a build keeps what it reads step by step rather than swapping it
   * in whole: readership keeps each month as it is read, so a failed build
   * leaves the months before it kept (#2419).
   */
  keepsAsItGoes?: true;
  /**
   * Whether the copy is built with another copy as input and needs a rebuild
   * once that copy moves: readership folds each month with the edition
   * redirects in place, and reads none after they are swapped. Its schedule
   * then queues the rebuild as it queues a newer dump's (`copyDue`), since the
   * redirects' own schedule moved them (ADR-0195).
   */
  followsInputs?: true;
  /**
   * False for a copy no sync run reads: English Wikivoyage's articles, which
   * the world-view extraction reads. Its swap waits for no run, and a run's
   * row does not name it (#2415).
   */
  readByRuns?: false;
}

/**
 * A copy's schedule, read from `dump_schedules` with its default (ADR-0195).
 * Wikidata's entities dump is published weekly and its build takes the worker
 * most of a day, so its copy follows it monthly; every other copy's dump is
 * published monthly, and a week's interval brings it in soon after.
 */
const scheduled = (dump: DumpKey, defaultEveryDays: number): Keeper['schedule'] => ({
  defaultEveryDays,
  read: () => scheduleOf(dump, defaultEveryDays),
  set: (everyDays, adminId) => setScheduleOf(dump, everyDays, adminId),
});

/** The interval a copy follows its dump at where no admin chose one. */
const WEEKLY = 7;
const MONTHLY = 30;

const KEEPERS: Partial<Record<DumpKey, Keeper>> = {
  'wikidata-entities': {
    title: 'The local Wikidata subset', build: buildSubset, rederive: rederiveSubset, latest: latestSubset, samples: true, fromCopy: true,
    schedule: scheduled('wikidata-entities', MONTHLY),
  },
  'pageviews-user': {
    title: 'Readership over the last twelve months', build: buildReadership, latest: latestReadership, archives: readershipArchives,
    refuseYearEnd: refuseOverlappingYear, samples: false, fromCopy: false, keepsAsItGoes: true, followsInputs: true,
    schedule: scheduled('pageviews-user', WEEKLY),
  },
  'enwiki-page': {
    title: 'English Wikipedia\'s articles, categories and category links', build: buildStructure, latest: latestStructure, samples: false, fromCopy: false,
    schedule: scheduled('enwiki-page', WEEKLY),
  },
  'wikipedia-redirects': {
    title: 'The redirects readership counts under an article', build: buildRedirects, latest: latestRedirects, samples: false, fromCopy: false,
    schedule: scheduled('wikipedia-redirects', WEEKLY),
  },
  'wikidata-redirects': {
    title: 'The items Wikidata redirected to another', build: buildWikidataRedirects, latest: latestWikidataRedirects, samples: false, fromCopy: false,
    schedule: scheduled('wikidata-redirects', WEEKLY),
  },
  'wikivoyage-usage': {
    title: 'The items Wikivoyage\'s pages use', build: buildUsage, latest: latestUsage, samples: false, fromCopy: false,
    schedule: scheduled('wikivoyage-usage', WEEKLY),
  },
  'wikivoyage-pages': {
    title: 'English Wikivoyage\'s articles', build: buildPages, latest: latestPages, samples: false, fromCopy: false, readByRuns: false,
    schedule: scheduled('wikivoyage-pages', WEEKLY),
  },
  // A build from the newest brings the kept current planet forward; a build
  // from a weekly copy on disk starts the current planet again from it.
  'osm-planet': {
    title: 'The OpenStreetMap layer', build: buildLayer, update: updateLayer, canUpdate: hasCurrentPlanet, latest: latestLayer,
    schedule: scheduled('osm-planet', DEFAULT_EVERY_DAYS),
    samples: false, fromCopy: true,
  },
};

export const keeperOf = (key: DumpKey): Keeper | null => KEEPERS[key] ?? null;

/**
 * What the copy built from a dump needs, for the admin (#1583): a build from
 * the dump where none is in place, where the code now keeps or writes it
 * differently, or where the host has a newer dump than the one it was built
 * from (`newest`, as last learnt); a re-derive where only the derived tables
 * are made differently.
 */
export function whatTheKeptNeeds(built: Kept | null, newest: string | null): 'nothing' | 'recompute' | 'newer-dump' | 'rebuild' {
  if (!built || built.needs === 'rebuild') return 'rebuild';
  if (newest !== null && newest > built.dumpDate) return 'newer-dump';
  return built.needs;
}

/**
 * The dumps a build can keep something from, and what builds it: the local
 * Wikidata subset from the entities dump (#1434), and readership from the
 * monthly pageview files (#1436), English Wikipedia's structure from its
 * page table's dump and the three of the same date (#1440), and the redirects
 * readership folds from the redirect and page tables of every edition a door
 * counts (#1650), and the Wikivoyage listings Archaeology's readership door
 * reads from every edition's articles (#1768).
 */

import type { DumpFile, DumpKey } from './catalog.js';
import type { ReadOptions } from './read.js';
import { buildReadership, latestReadership } from './readership/readershipBuild.js';
import { buildRedirects } from './wikipedia/redirectBuild.js';
import { latestRedirects } from './wikipedia/redirectTables.js';
import { buildStructure } from './wikipedia/structureBuild.js';
import { latestStructure } from './wikipedia/structureTables.js';
import { buildSubset, rederiveSubset, type RederiveOptions } from './wikidata/subsetBuild.js';
import type { CopyNeeds } from './wikidata/buildRules.js';
import { latestSubset } from './wikidata/subsetTables.js';
import { buildListings } from './wikivoyage/listingBuild.js';
import { latestListings } from './wikivoyage/listingTables.js';

export interface Kept {
  /** The dump date of the build now in place, and when it was swapped in. */
  dumpDate: string;
  swappedAt: Date;
  /** What it needs to match the code's rules (#1583): nothing, a re-derive, or a build from the dump. */
  needs: CopyNeeds;
}

export interface Keeper {
  /** What a keeping build of the dump makes, for the admin panel. */
  title: string;
  /** Build from `file` and swap the result in, or, as a `trial`, build and throw it away (#1527). */
  build(file: DumpFile, options: ReadOptions & {
    buildId: number; onPhase: (message: string) => void; trial?: boolean;
    /** How far a step that reads a file of its own has got (#1519). */
    onMeasure?: (read: number, total: number) => void;
  }):
    Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }>;
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
  /** Derive the build in place's tables again from what it holds, without the dump (#1526). */
  rederive?(options: RederiveOptions): Promise<void>;
  /** The build now in place, if any. */
  latest(): Promise<Kept | null>;
}

const KEEPERS: Partial<Record<DumpKey, Keeper>> = {
  'wikidata-entities': {
    title: 'The local Wikidata subset', build: buildSubset, rederive: rederiveSubset, latest: latestSubset, samples: true, fromCopy: true,
  },
  'pageviews-user': { title: 'Readership over the last twelve months', build: buildReadership, latest: latestReadership, samples: false, fromCopy: false },
  'enwiki-page': {
    title: 'English Wikipedia\'s articles, categories and category links', build: buildStructure, latest: latestStructure, samples: false, fromCopy: false,
  },
  'wikipedia-redirects': {
    title: 'The redirects readership counts under an article', build: buildRedirects, latest: latestRedirects, samples: false, fromCopy: false,
  },
  'wikivoyage-listings': {
    title: 'The items Wikivoyage\'s listings name', build: buildListings, latest: latestListings, samples: false, fromCopy: false,
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

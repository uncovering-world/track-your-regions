/**
 * The dumps a build can keep something from, and what builds it (#1434):
 * the local Wikidata subset from the entities dump. Readership and the
 * Wikipedia tables bring theirs (#1436, #1440).
 */

import type { DumpFile, DumpKey } from './catalog.js';
import type { ReadOptions } from './read.js';
import { buildSubset, rederiveSubset, type RederiveOptions } from './wikidata/subsetBuild.js';
import type { CopyNeeds } from './wikidata/buildRules.js';
import { latestSubset } from './wikidata/subsetTables.js';

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
  /** Derive the build in place's tables again from what it holds, without the dump (#1526). */
  rederive?(options: RederiveOptions): Promise<void>;
  /** The build now in place, if any. */
  latest(): Promise<Kept | null>;
}

const KEEPERS: Partial<Record<DumpKey, Keeper>> = {
  'wikidata-entities': { title: 'The local Wikidata subset', build: buildSubset, rederive: rederiveSubset, latest: latestSubset },
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

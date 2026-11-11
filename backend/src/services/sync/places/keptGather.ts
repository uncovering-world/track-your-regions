/**
 * The place pass's shared steps, kept between runs on the same inputs (#2424,
 * ADR-0196): the gather of places and the surroundings pool, which take about
 * six and seventeen minutes of every run and the same bytes each time the
 * inputs are the same.
 *
 * Every run that makes a step writes it; only a dry run reads one back, and
 * only under the same key: the same builds in place, the same admitted rows
 * and the same code. A real pass always makes both afresh. The steps are kept
 * in the dumps directory (workbench tier: derived, made again at will), one
 * file per step, the older removed when a newer is written.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../../../db/index.js';
import { dumpsDir } from '../../dumps/buildQueue.js';
import { codeHash } from './codeGraph.js';
import { readSliced, writeSliced } from './slicedV8.js';
import { gatherPlaces, type GatheredPlaces, type GatherRequest, type KindShare, type PlaceKind } from './gather.js';
import {
  readSurroundingsPool, type PoolMembers, type SurroundingsGroup, type SurroundingsPool, type SurroundingsPoolRun,
} from './surroundingsPool.js';
import type { SurroundingsCut } from './surroundingsCut.js';
import type { SubjectRunner } from '../publicArt/subjects.js';
import type { KeptGatherNote } from '../types.js';

/** What a kept step is read again by: every input it read, as one hash, and when the builds it names were made. */
export interface GatherKey {
  hash: string;
  /** The builds in place, for the run's log: how many have succeeded, and the newest. */
  builds: string;
}

/** A step a dry run read back rather than made: when it was kept, for the run's log. */
export interface KeptStep<T> {
  value: T;
  keptAt: Date;
}

const DIRECTORY = 'kept-gather';

/**
 * The builds in place: how many dump builds have succeeded and the newest.
 * Every table the gather and the pool read is one a dump build makes (the
 * subset, the readers' months, the redirects, Wikivoyage's usage, the
 * OpenStreetMap layer), so any build that succeeds since a step was kept
 * makes it again — the daily layer diff included — whether or not the step
 * reads what that build made. Counting, not the newest id alone: a build
 * started earlier can finish later.
 */
async function buildsInPlace(): Promise<string> {
  const { rows } = await pool.query<{ builds: string; newest: number | null }>(
    `SELECT count(*)::text AS builds, max(id) AS newest FROM workbench.dump_builds WHERE status = 'success'`,
  );
  return `${rows[0].builds} builds, the newest #${rows[0].newest ?? 'none'}`;
}

/** The rows each kind admits before the run, which its share is asked for by id. */
function admittedOf(requests: readonly GatherRequest[]): string {
  return JSON.stringify(
    requests.map(({ kind, admitted }) => [kind.name, [...admitted].sort()]).sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}

/**
 * The gather's key: the builds, the admitted rows and the code of the gather
 * and of every kind it asks for. Null where the key cannot be read: the run
 * then keeps nothing and reads nothing back, and makes its steps as it would.
 */
export async function gatherKey(requests: readonly GatherRequest[], code: readonly URL[]): Promise<GatherKey | null> {
  try {
    const builds = await buildsInPlace();
    const { hash: codeOf } = await codeHash(code);
    return { hash: sha([builds, admittedOf(requests), codeOf]), builds };
  } catch (error) {
    console.warn(`[Kept gather] no key, so the pass's shared steps are neither kept nor read back: ${(error as Error).message}`);
    return null;
  }
}

/**
 * The pool's key: the gather's, and what the pool is asked for, as data.
 * `venueLine` is a function, so it is not in it: it is the readers' code over
 * the gather, and the gather's key already holds both.
 */
export function poolKey(gather: GatherKey, members: PoolMembers, cut: SurroundingsCut, groups: readonly SurroundingsGroup[]): GatherKey {
  const sorted = (set: ReadonlySet<string> | null | undefined) => (set ? [...set].sort() : null);
  const asked = JSON.stringify({
    classes: sorted(members.classes),
    items: sorted(members.items),
    venues: sorted(members.venues),
    cut,
    groups: groups.map((group) => ({ key: group.key, classes: sorted(group.classes), items: sorted(group.items) })),
  });
  return { hash: sha([gather.hash, asked]), builds: gather.builds };
}

function sha(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${part}\0`);
  return hash.digest('hex');
}

/** The gather as it is kept: a kind is an object with functions, so its share is kept by the kind's name. */
interface KeptPlaces {
  shares: [string, KindShare<unknown>][];
  pooled: number;
  classes: ReadonlySet<string>;
}

type Step = 'places' | 'pool';

function fileOf(directory: string, step: Step, key: GatherKey): string {
  return join(directory, `${step}-${key.hash}.v8`);
}

/** Where steps are kept; null where the deployment names no dumps directory. */
function keptDirectory(): string | null {
  const dumps = dumpsDir();
  return dumps ? join(dumps, DIRECTORY) : null;
}

/**
 * The step kept under the key, where its file holds what a step of its kind
 * holds (`isStep`); null otherwise, the step then made again. The format is
 * this module's, which is part of the code key, so an older format is under
 * another key; the check is for a file that is not what its name says.
 */
async function readStep(step: Step, key: GatherKey, isStep: (value: unknown) => boolean): Promise<KeptStep<unknown> | null> {
  const directory = keptDirectory();
  if (!directory) return null;
  const file = fileOf(directory, step, key);
  try {
    const kept = await readSliced(file) as { keptAt?: unknown; value?: unknown } | null;
    if (typeof kept?.keptAt !== 'string' || !isStep(kept.value)) throw new Error('it does not hold a step of its kind');
    return { value: kept.value, keptAt: new Date(kept.keptAt) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn(`[Kept gather] ${file} could not be read, so the step is made again: ${(error as Error).message}`);
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Whether a value is a kept gather of places: shares by kind name, the count pooled and the classes. */
function isKeptPlaces(value: unknown): value is KeptPlaces {
  return isObject(value) && typeof value.pooled === 'number' && value.classes instanceof Set
    && Array.isArray(value.shares)
    && value.shares.every((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && isObject(entry[1]) && entry[1].pool instanceof Map);
}

/** Whether a value is a kept surroundings pool: its rows and each group's surroundings. */
function isKeptPool(value: unknown): value is SurroundingsPool {
  return isObject(value) && value.rows instanceof Map && value.around instanceof Map && typeof value.seconds === 'number';
}

/**
 * Keep a step under its key, in place of the step's older file. A failure is
 * logged and the run goes on: a step that is not kept is made again next time.
 */
async function writeStep(step: Step, key: GatherKey, value: unknown): Promise<void> {
  const directory = keptDirectory();
  if (!directory) return;
  const file = fileOf(directory, step, key);
  try {
    await mkdir(directory, { recursive: true });
    await writeSliced(`${file}.part`, { keptAt: new Date().toISOString(), value });
    await rename(`${file}.part`, file);
    for (const name of await readdir(directory)) {
      if (name.startsWith(`${step}-`) && join(directory, name) !== file) await rm(join(directory, name), { force: true });
    }
  } catch (error) {
    await rm(`${file}.part`, { force: true }).catch(() => undefined);
    console.warn(`[Kept gather] the ${step} step could not be kept: ${(error as Error).message}`);
  }
}

/** The gather kept under the key, its shares given back to the kinds asked for; null where none is kept or a kind is missing. */
export async function readKeptPlaces(key: GatherKey, requests: readonly GatherRequest[]): Promise<KeptStep<GatheredPlaces> | null> {
  const kept = await readStep('places', key, isKeptPlaces);
  if (!kept) return null;
  const { shares, pooled, classes } = kept.value as KeptPlaces;
  const byName = new Map(shares);
  const restored = new Map<PlaceKind<unknown>, KindShare<unknown>>();
  for (const { kind } of requests) {
    const share = byName.get(kind.name);
    if (!share) return null;
    restored.set(kind, share);
  }
  return { value: { shares: restored, pooled, classes }, keptAt: kept.keptAt };
}

/** Keep the gather of places under its key, each share by its kind's name. */
export async function keepPlaces(key: GatherKey, gathered: GatheredPlaces): Promise<void> {
  const kept: KeptPlaces = {
    shares: [...gathered.shares].map(([kind, share]) => [kind.name, share]),
    pooled: gathered.pooled,
    classes: gathered.classes,
  };
  await writeStep('places', key, kept);
}

/** The surroundings pool kept under the key; null where none is. */
export async function readKeptPool(key: GatherKey): Promise<KeptStep<SurroundingsPool> | null> {
  const kept = await readStep('pool', key, isKeptPool);
  return kept ? { value: kept.value as SurroundingsPool, keptAt: kept.keptAt } : null;
}

/** Keep the surroundings pool under its key, unless it was not read. */
export async function keepPool(key: GatherKey, made: SurroundingsPool): Promise<void> {
  // A pool that was not read (no subset, no year of readers) is no reading to keep.
  if (made.unread) return;
  await writeStep('pool', key, made);
}

/**
 * Whether a pass keeps its shared steps and reads them back: every run on the
 * subset keeps them under their key (`key`); only a dry run that asked for
 * nothing afresh reads one back (`read`), and says so in `note`.
 */
export interface PassKeep {
  key: GatherKey | null;
  read: boolean;
  note: KeptGatherNote;
}

/** The gather of places: read back under its key where the pass reads, else made, and kept under its key either way. */
export async function placesOf(
  keep: PassKeep, requests: readonly GatherRequest[], run: SubjectRunner, gather = gatherPlaces,
): Promise<GatheredPlaces> {
  if (keep.key && keep.read) {
    const kept = await readKeptPlaces(keep.key, requests);
    if (kept) {
      Object.assign(keep.note, { places: kept.keptAt, builds: keep.key.builds });
      run.phase(`Read the gather of places kept at ${kept.keptAt.toISOString()}: the same code, builds and admitted rows`);
      return kept.value;
    }
  }
  const gathered = await gather(run, [...requests]);
  if (keep.key) await keepPlaces(keep.key, gathered);
  return gathered;
}

/** The surroundings pool, the same way, under a key that adds what the pool is asked for. */
export async function poolOf(
  keep: PassKeep, members: PoolMembers, cut: SurroundingsCut, groups: readonly SurroundingsGroup[], run: SurroundingsPoolRun,
  read: (members: PoolMembers, cut: SurroundingsCut, groups: readonly SurroundingsGroup[], run: SurroundingsPoolRun) => Promise<SurroundingsPool>
    = readSurroundingsPool,
): Promise<SurroundingsPool> {
  const key = keep.key && poolKey(keep.key, members, cut, groups);
  if (key && keep.read) {
    const kept = await readKeptPool(key);
    if (kept) {
      Object.assign(keep.note, { pool: kept.keptAt, builds: key.builds });
      run.phase(`Read the surroundings pool kept at ${kept.keptAt.toISOString()}: the same code, builds and question`);
      return kept.value;
    }
  }
  const made = await read(members, cut, groups, run);
  if (key) await keepPool(key, made);
  return made;
}


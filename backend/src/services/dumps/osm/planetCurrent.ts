/**
 * The planet kept current (ADR-0134 decision 1): the weekly planet file
 * brought forward with the planet's daily replication diffs, so a layer is
 * cut from the map as of last midnight rather than as of the Monday the
 * planet was dumped.
 *
 * The current planet is `planet-current.osm.pbf` under `DUMPS_DIR`, beside a
 * small state file that says which daily diff it was brought to and the
 * instant that diff ends. The state lives with the file rather than in the
 * database, so a file that is gone is never taken for one that is there. The
 * name matches no dated name of the catalog, so neither the cleanup of older
 * copies nor the panel's local copy reads it.
 *
 * A daily diff `N` holds every change between the ends of diffs `N - 1` and
 * `N`, each ending at midnight UTC. The weekly planet names only the instant
 * it is current to (`osmosis_replication_timestamp`), so the first diff it
 * needs is the first whose end is after that instant, found by the days
 * between it and the newest diff and checked against that diff's own state.
 * A change the planet already holds is applied again harmlessly. The diffs
 * publish no checksum: each is checked against the host's size, and osmium
 * refuses a gzip stream cut short.
 */

import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OSM_PLANET, type TextReader } from '../catalog.js';
import { downloadTo } from '../fetch.js';
import { OSMIUM, OSMIUM_OUTPUT, runTool } from './tools.js';

const DAILY = `${OSM_PLANET}/replication/day`;
export const CURRENT_PLANET = 'planet-current.osm.pbf';
const CURRENT_STATE = 'planet-current.state.json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the current planet was brought to: the daily diff and the instant it ends. */
export interface CurrentState {
  sequence: number;
  /** ISO instant. */
  timestamp: string;
  /** The weekly planet it was first brought forward from. */
  base: string;
}

/** A daily diff's place in the replication tree: 5153 is `000/005/153`. */
export function sequencePath(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999_999_999) throw new Error(`Refusing a replication sequence that is not one: ${sequence}`);
  const digits = String(sequence).padStart(9, '0');
  return `${digits.slice(0, 3)}/${digits.slice(3, 6)}/${digits.slice(6)}`;
}

/** A replication state file's sequence and end, as osmosis writes it (`timestamp=2026-10-22T00\:00\:00Z`). */
export function parseState(text: string): { sequence: number; timestamp: string } {
  const sequence = /^sequenceNumber=(\d+)$/m.exec(text)?.[1];
  const timestamp = /^timestamp=(.+)$/m.exec(text)?.[1]?.replaceAll('\\', '');
  const instant = timestamp ? new Date(timestamp) : null;
  if (!sequence || !instant || Number.isNaN(instant.getTime())) throw new Error(`Not a replication state: ${text.slice(0, 200)}`);
  return { sequence: Number(sequence), timestamp: instant.toISOString() };
}

/** The newest daily diff's state, or diff `sequence`'s. */
export async function dailyState(read: TextReader, sequence?: number): Promise<{ sequence: number; timestamp: string }> {
  return parseState(await read(sequence === undefined ? `${DAILY}/state.txt` : `${DAILY}/${sequencePath(sequence)}.state.txt`));
}

/**
 * The first daily diff whose end is after `instant`: estimated from the days
 * between it and the newest diff, then moved one diff at a time until its own
 * state and the one before it agree. A replication that paused or skipped
 * days moves it further; the walk only ever goes one way once it has moved,
 * so it ends. Past the newest diff where the planet is already current to it.
 */
export async function firstDiffAfter(instant: string, newest: { sequence: number; timestamp: string }, read: TextReader): Promise<number> {
  const at = Date.parse(instant);
  const behind = Math.ceil((Date.parse(newest.timestamp) - at) / DAY_MS);
  let candidate = Math.min(newest.sequence + 1, Math.max(1, newest.sequence - behind + 1));
  while (candidate <= newest.sequence) {
    if (Date.parse((await dailyState(read, candidate)).timestamp) <= at) {
      candidate += 1;
      continue;
    }
    if (candidate > 1 && Date.parse((await dailyState(read, candidate - 1)).timestamp) > at) {
      candidate -= 1;
      continue;
    }
    return candidate;
  }
  return candidate;
}

/** The current planet's state, or null where there is none or its state does not hold. */
export async function readCurrent(dir: string): Promise<CurrentState | null> {
  try {
    const state = JSON.parse(await readFile(join(dir, CURRENT_STATE), 'utf8')) as CurrentState;
    if (!(await stat(join(dir, CURRENT_PLANET))).isFile()) return null;
    return Number.isInteger(state.sequence) && typeof state.timestamp === 'string' && typeof state.base === 'string' ? state : null;
  } catch {
    return null;
  }
}

export interface BroughtForward {
  path: string;
  state: CurrentState;
  /** How many daily diffs were applied, and their compressed bytes. */
  applied: number;
  bytes: number;
}

/**
 * Bring `from` forward with every daily diff from `first` to the newest, in
 * one pass, into the current planet; answers it and its new state. `from` is
 * the current planet itself or the weekly planet it starts from. The
 * downloaded diffs live in `work` and go with it.
 */
export async function bringForward(
  from: string, first: number, base: string, newest: { sequence: number; timestamp: string },
  options: { dir: string; work: string; signal: AbortSignal; onPhase: (message: string) => void },
): Promise<BroughtForward> {
  const { dir, work, signal } = options;
  const path = join(dir, CURRENT_PLANET);
  const state: CurrentState = { sequence: newest.sequence, timestamp: newest.timestamp, base };
  const written = join(work, CURRENT_STATE);
  if (first > newest.sequence) {
    // Nothing newer to apply: the planet it starts from is the current one.
    await writeFile(written, JSON.stringify(state));
    if (from !== path) await rename(from, path);
    await rename(written, join(dir, CURRENT_STATE));
    return { path, state, applied: 0, bytes: 0 };
  }
  const diffs: string[] = [];
  let bytes = 0;
  for (let sequence = first; sequence <= newest.sequence; sequence += 1) {
    options.onPhase(`Downloading daily diff ${sequence} (${sequence - first + 1} of ${newest.sequence - first + 1})...`);
    const diff = join(work, `${sequence}.osc.gz`);
    bytes += await downloadTo(`${DAILY}/${sequencePath(sequence)}.osc.gz`, diff, signal, () => undefined);
    diffs.push(diff);
  }
  options.onPhase(`Applying ${diffs.length} daily diffs to the planet...`);
  const next = join(work, 'planet-next.osm.pbf');
  await runTool(OSMIUM, ['apply-changes', from, ...diffs, '-o', next, OSMIUM_OUTPUT, '--overwrite'], { signal });
  // The state is written beside the file first and both are renamed in, so a
  // stop between them leaves at worst a state one step behind its file, and
  // a diff applied twice changes nothing.
  await writeFile(written, JSON.stringify(state));
  await rename(next, path);
  await rename(written, join(dir, CURRENT_STATE));
  return { path, state, applied: diffs.length, bytes };
}

/** Forget the current planet: a build that cannot trust it starts again from the weekly planet. */
export async function dropCurrent(dir: string): Promise<void> {
  await rm(join(dir, CURRENT_STATE), { force: true });
  await rm(join(dir, CURRENT_PLANET), { force: true });
}

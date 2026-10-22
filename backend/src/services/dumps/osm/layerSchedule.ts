/**
 * When the OpenStreetMap layer brings itself forward (ADR-0134 decision 6):
 * the dump worker queues an update of the layer by itself once the layer is
 * older than the interval, at most once an interval, and only once an admin's
 * first build has kept a current planet to bring forward: a first build and
 * any download of the weekly planet stay an admin's.
 *
 * A self-queued update waits `QUEUED_LEAD_MS` as a queued row before the
 * worker may take it (`notBefore`), so whoever pulls the machine's checkout
 * sees it coming and can cancel it: a pull in the middle of a build stops the
 * worker's passes.
 */

import { pool } from '../../../db/index.js';
import { fetchText } from '../fetch.js';
import { activeBuildOf, enqueueBuild } from '../ledger.js';
import { hasCurrentPlanet } from './layerBuild.js';
import { dailyState } from './planetCurrent.js';

/**
 * The interval when no admin has chosen one: the planet's own weekly release.
 * It fits ADR-0101's monthly minimum with room to spare, and an update costs
 * the worker about an hour that other builds wait through.
 */
export const DEFAULT_EVERY_DAYS = 7;

/**
 * How old the layer may be for a miss to be read as a fact (ADR-0134
 * decision 4): the default interval and a day. Fixed here, whatever the
 * interval an admin sets, so a longer interval only sends more misses live.
 */
export const LAYER_FRESH_FOR_DAYS = DEFAULT_EVERY_DAYS + 1;

/** How long the host may take to say where its newest daily diff ends, before the look gives up until the next. */
const ASK_FOR_MS = 30_000;

/** How long a self-queued update stays visibly queued before the worker may take it. */
export const QUEUED_LEAD_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LayerSchedule {
  /** The interval in days, or null where the schedule is off. */
  everyDays: number | null;
  /** Whether an admin chose it; otherwise it is the default. */
  chosen: boolean;
}

/** The schedule in force: the admin's where one was chosen, the default otherwise. */
export async function layerSchedule(): Promise<LayerSchedule> {
  const result = await pool.query<{ every_days: number | null }>('SELECT every_days FROM osm_layer_schedule');
  const row = result.rows[0];
  return row ? { everyDays: row.every_days, chosen: true } : { everyDays: DEFAULT_EVERY_DAYS, chosen: false };
}

/** An admin's choice: every `everyDays` days (1–30), or null for off. */
export async function setLayerSchedule(everyDays: number | null, adminId: number): Promise<LayerSchedule> {
  if (everyDays !== null && (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 30)) {
    throw new Error('The interval is a whole number of days from 1 to 30, or off');
  }
  await pool.query(
    `INSERT INTO osm_layer_schedule (singleton, every_days, updated_by, updated_at) VALUES (TRUE, $1, $2, NOW())
     ON CONFLICT (singleton) DO UPDATE SET every_days = EXCLUDED.every_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [everyDays, adminId],
  );
  return { everyDays, chosen: true };
}

export interface ScheduleFacts {
  everyDays: number | null;
  /** The instant the layer in place is current to, or null where none is. */
  layerCurrentTo: Date | null;
  /** Whether a current planet is kept to bring forward. */
  planetKept: boolean;
  /** Whether a build of the planet is queued or running. */
  buildActive: boolean;
  /** When the last self-queued update that did not succeed started, or null: it is not tried again within the interval. */
  lastScheduled: Date | null;
  /** Where the newest daily diff the host publishes ends, or null while not asked. */
  newestDiffEnds: Date | null;
}

/**
 * Whether an update is due: the schedule is on, a layer and a current planet
 * are kept, nothing of the planet is queued or running, the layer is older
 * than the interval, and no self-queued update that failed or was cancelled
 * started within it, so such a one waits for the next interval rather than
 * being tried again at once. A successful one is not counted: the layer's
 * age alone then decides, so the updates do not drift later each cycle.
 * Last, the host must publish a daily diff that ends after the layer: an
 * update with nothing newer would cut the planet again for an hour and leave
 * the layer as old, and be due again at the next look.
 */
export function updateDue(facts: ScheduleFacts, now: Date): boolean {
  if (!dueOnWhatIsKept(facts, now)) return false;
  return facts.newestDiffEnds !== null && facts.layerCurrentTo !== null && facts.newestDiffEnds > facts.layerCurrentTo;
}

/** `updateDue` but for the host: everything this machine knows says an update is due. */
function dueOnWhatIsKept(facts: ScheduleFacts, now: Date): boolean {
  if (facts.everyDays === null || !facts.layerCurrentTo || !facts.planetKept || facts.buildActive) return false;
  const interval = facts.everyDays * DAY_MS;
  if (now.getTime() - facts.layerCurrentTo.getTime() < interval) return false;
  return !facts.lastScheduled || now.getTime() - facts.lastScheduled.getTime() >= interval;
}

/** The facts `updateDue` judges, read from the database and the disk. */
async function scheduleFacts(): Promise<ScheduleFacts> {
  const [{ everyDays }, layer, planetKept, active, last] = await Promise.all([
    layerSchedule(),
    pool.query<{ replicated_at: Date }>('SELECT replicated_at FROM osm_layer_builds ORDER BY swapped_at DESC LIMIT 1'),
    hasCurrentPlanet(),
    activeBuildOf('osm-planet'),
    pool.query<{ started_at: Date | null }>(
      `SELECT max(started_at) AS started_at FROM dump_builds
        WHERE dump = 'osm-planet' AND request->>'scheduled' = 'true' AND status <> 'success'`,
    ),
  ]);
  return {
    everyDays, layerCurrentTo: layer.rows[0]?.replicated_at ?? null, planetKept, buildActive: active !== null,
    lastScheduled: last.rows[0]?.started_at ?? null, newestDiffEnds: null,
  };
}

/**
 * Queue the layer's update where one is due, to start no sooner than
 * `QUEUED_LEAD_MS` from now; answers the build's id, or null where none was
 * due. A build an admin starts in the meantime takes the dump's one slot, and
 * this one is then not queued (the ledger's unique index refuses it).
 */
export async function queueScheduledUpdate(stop: AbortSignal, now = new Date()): Promise<number | null> {
  const facts = await scheduleFacts();
  // The host is asked only when everything kept here says an update is due.
  if (!dueOnWhatIsKept(facts, now)) return null;
  // Bounded, and stopped with the worker: the look holds up the queued builds behind it.
  const asking = AbortSignal.any([stop, AbortSignal.timeout(ASK_FOR_MS)]);
  facts.newestDiffEnds = new Date((await dailyState(url => fetchText(url, asking))).timestamp);
  if (!updateDue(facts, now)) return null;
  const notBefore = new Date(now.getTime() + QUEUED_LEAD_MS).toISOString();
  // A current planet is kept only under DUMPS_DIR, so an update due is always a local one.
  return enqueueBuild('osm-planet', 'local', { kind: 'keep', scheduled: true, notBefore }, null);
}

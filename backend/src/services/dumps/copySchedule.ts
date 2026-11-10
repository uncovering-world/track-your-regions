/**
 * When a copy built from a dump brings itself forward (#2415, ADR-0195): the
 * dump worker queues a keeping build of a copy by itself once the host has a
 * newer dump than the one the copy was built from, and the copy is older than
 * its interval. Each copy has its interval, which an admin may change or turn
 * off on its card; the default lives here (`DEFAULT_EVERY_DAYS_OF`). The
 * OpenStreetMap layer keeps its own trigger, the daily diffs past the layer
 * (`osm/layerSchedule.ts`, ADR-0134 decision 6), and shares the table.
 *
 * A first build stays an admin's: a copy never built is not built by itself.
 * A self-queued build waits `QUEUED_LEAD_MS` as a queued row before the worker
 * may take it, so whoever pulls the machine's checkout sees it coming and can
 * cancel it. It swaps in only while no run reads the copy (`swapGuard.ts`).
 */

import { pool } from '../../db/index.js';
import type { DumpKey } from './catalog.js';
import { activeBuildOf, enqueueBuild } from './ledger.js';
import { newestDump } from './newestOnHost.js';

/** A copy's schedule: the interval in days, or null where it is off, and whether an admin chose it. */
export interface CopySchedule {
  everyDays: number | null;
  chosen: boolean;
}

/** How long a self-queued build stays visibly queued before the worker may take it. */
export const QUEUED_LEAD_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The schedule in force for `dump`: the admin's where one was chosen, `defaultEveryDays` otherwise. */
export async function scheduleOf(dump: DumpKey, defaultEveryDays: number): Promise<CopySchedule> {
  const result = await pool.query<{ every_days: number | null }>('SELECT every_days FROM dump_schedules WHERE dump = $1', [dump]);
  const row = result.rows[0];
  return row ? { everyDays: row.every_days, chosen: true } : { everyDays: defaultEveryDays, chosen: false };
}

/** An admin's choice for `dump`: every `everyDays` days (1–30), or null for off. */
export async function setScheduleOf(dump: DumpKey, everyDays: number | null, adminId: number): Promise<CopySchedule> {
  if (everyDays !== null && (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 30)) {
    throw new Error('The interval is a whole number of days from 1 to 30, or off');
  }
  await pool.query(
    `INSERT INTO dump_schedules (dump, every_days, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (dump) DO UPDATE SET every_days = EXCLUDED.every_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [dump, everyDays, adminId],
  );
  return { everyDays, chosen: true };
}

/** What `copyDue` judges for one copy. */
export interface CopyFacts {
  everyDays: number | null;
  /** The copy in place: its dump's date (an ISO day) and when it was swapped in; null where none was built. */
  kept: { dumpDate: string; swappedAt: Date } | null;
  /** The newest dump's date on the host as the worker last learnt it, an ISO day, or null where none is known. */
  newestOnHost: string | null;
  /** Whether a build of the dump is queued or running. */
  buildActive: boolean;
  /** When the last self-queued build that did not succeed started, or null: it is not tried again within the interval. */
  lastScheduled: Date | null;
  /**
   * Whether a copy that follows another (`followsInputs`) needs a rebuild:
   * readership once the redirects it was folded with moved, or once a month of
   * its twelve is missing. Due without a newer dump of its own, since the
   * input's schedule moved it in the first place, or a build stopped short. The
   * card tells the two causes apart (`inputsMoved` on the Public Dumps response).
   */
  followerStale?: boolean;
}

/**
 * Whether a copy's build is due: the schedule is on, a copy is in place, the
 * host has a newer dump than it was built from, nothing of the dump is queued
 * or running, the copy is older than the interval, and no self-queued build
 * that failed or was cancelled started within it. A copy whose input copy
 * moved, or that lacks a part (`followerStale`), is due without a newer dump or the interval's wait.
 */
export function copyDue(facts: CopyFacts, now: Date): boolean {
  if (facts.everyDays === null || !facts.kept || facts.buildActive) return false;
  const interval = facts.everyDays * DAY_MS;
  const notRetriedYet = !facts.lastScheduled || now.getTime() - facts.lastScheduled.getTime() >= interval;
  if (facts.followerStale) return notRetriedYet;
  if (!facts.newestOnHost || facts.newestOnHost <= facts.kept.dumpDate) return false;
  if (now.getTime() - facts.kept.swappedAt.getTime() < interval) return false;
  return notRetriedYet;
}

/** The facts `copyDue` judges for `dump`, read from the ledger and what the worker learnt of the host. */
export async function copyFacts(
  dump: DumpKey, schedule: CopySchedule, kept: CopyFacts['kept'], followerStale = false,
): Promise<CopyFacts> {
  const [active, newest, last] = await Promise.all([
    activeBuildOf(dump),
    newestDump(dump),
    pool.query<{ started_at: Date | null }>(
      `SELECT max(started_at) AS started_at FROM dump_builds
        WHERE dump = $1 AND request->>'scheduled' = 'true' AND status <> 'success'`,
      [dump],
    ),
  ]);
  return {
    everyDays: schedule.everyDays, kept, newestOnHost: newest.date, buildActive: active !== null,
    lastScheduled: last.rows[0]?.started_at ?? null, followerStale,
  };
}

/** Queue a keeping build of `dump` from its newest dump, to start no sooner than `QUEUED_LEAD_MS` from `now`. */
export function queueScheduledBuild(dump: DumpKey, mode: 'local' | 'stream', now: Date): Promise<number> {
  const notBefore = new Date(now.getTime() + QUEUED_LEAD_MS).toISOString();
  return enqueueBuild(dump, mode, { kind: 'keep', scheduled: true, notBefore }, null);
}

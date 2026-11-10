/**
 * ADR-0175 decision 6: what a place source's world tier keeps from one run to
 * the next, so a run that cannot read a signal admits by what was last read
 * rather than by nothing.
 *
 * - The bars a run admitted by are written on its own sync log
 *   (`experience_sync_logs.world_bars`). A run that reads no readership year
 *   takes the readers' bars of the source's last run that read one.
 * - Each membership's readers and guide's mark are the crowding step's
 *   (`membership_fame`, ADR-0172), which already keeps a signal whose source is
 *   not in place as last measured. Only a signal it dated as read
 *   (`readers_read_at`, `guides_read_at`) is taken: the zero a membership is
 *   ranked at before its first reading is no reading.
 *
 * - Whether a place last stood in the surroundings tier by the venue test is
 *   the note its membership records (`admissionNote`, `standsByVenues`,
 *   ADR-0192), so a run
 *   whose layer keeps no venue keeps those places and no other.
 *
 * Every membership of the source is read, refused ones included: a place the
 * kind refused last time is judged again on what was last read of it.
 */

import { pool } from '../../../db/index.js';
import { MEMBERSHIPS } from '../../../db/membership.js';
import type { ExperienceKindMembershipsRow, ExperienceSyncLogsRow, MembershipFameRow } from '../../../db/schema.generated.js';
import { WORLD_FRAME } from './admissionRegister.js';
import { standsByVenues } from './surroundingsCut.js';
import type { WorldBars, WorldMemory } from './worldBars.js';

/** A source's world tier across runs: what it last read, and where this run's bars are written. */
export interface WorldHistory {
  memory: WorldMemory;
  /** Write the bars this run admits by on its sync log. */
  keep(bars: WorldBars): Promise<void>;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The readers' bars a sync log's record holds, or null where it holds none (a run with no year, or a malformed record). */
export function keptBarsOf(logId: number, record: unknown): WorldMemory['bars'] {
  if (typeof record !== 'object' || record === null) return null;
  const { readers, guidedReaders, year, keptFrom } = record as Record<string, unknown>;
  if (!isCount(readers) || !isCount(guidedReaders) || typeof year !== 'string') return null;
  return { readers, guidedReaders, year, logId: isCount(keptFrom) ? keptFrom : logId };
}

/**
 * What the source's last runs read: the readers' bars of its last real run
 * that read a year (a preview's are its own), and each membership's readers
 * and guide's mark as last read.
 */
export async function readWorldMemory(sourceId: number): Promise<WorldMemory> {
  const log = await pool.query<Pick<ExperienceSyncLogsRow, 'id' | 'world_bars'>>(
    `SELECT id, world_bars FROM experience_sync_logs
      WHERE source_id = $1 AND is_dry_run = FALSE AND jsonb_typeof(world_bars->'readers') = 'number'
      ORDER BY id DESC LIMIT 1`,
    [sourceId],
  );
  const row = log.rows[0];
  const signals = await pool.query<
    Pick<ExperienceKindMembershipsRow, 'external_id'> & Pick<MembershipFameRow, 'readers' | 'guide_editions'>
    & { readers_read: boolean; guides_read: boolean }
  >(
    `SELECT m.external_id, f.readers, f.guide_editions,
            f.readers_read_at IS NOT NULL AS readers_read, f.guides_read_at IS NOT NULL AS guides_read
       FROM ${MEMBERSHIPS} m
       JOIN membership_fame f ON f.membership_id = m.id
      WHERE m.source_id = $1 AND (f.readers_read_at IS NOT NULL OR f.guides_read_at IS NOT NULL)`,
    [sourceId],
  );
  const readers = new Map<string, number>();
  const guided = new Map<string, boolean>();
  for (const signal of signals.rows) {
    if (signal.readers_read) readers.set(signal.external_id, signal.readers);
    if (signal.guides_read) guided.set(signal.external_id, signal.guide_editions >= WORLD_FRAME.guideEditions);
  }
  // The note the run wrote for the curator is the membership's `admissionNote` fact. Its words are the
  // cut's own (standsByVenues); the statement only narrows to the notes that name a venue.
  const notes = await pool.query<Pick<ExperienceKindMembershipsRow, 'external_id'> & { note: string | null }>(
    `SELECT m.external_id, m.facts->>'admissionNote' AS note FROM ${MEMBERSHIPS} m
      WHERE m.source_id = $1 AND m.admission = 'admitted' AND m.facts->>'tier' = 'surroundings'
        AND m.facts->>'admissionNote' LIKE '%venue%'`,
    [sourceId],
  );
  const venued = new Set(notes.rows.filter((r) => standsByVenues(r.note)).map((r) => r.external_id));
  return { bars: row ? keptBarsOf(row.id, row.world_bars) : null, readers, guided, venued };
}

/** Write the bars a run admits by on its sync log; a run with no log has nowhere to keep them. */
export async function keepWorldBars(logId: number | null, bars: WorldBars): Promise<void> {
  if (logId === null) return;
  await pool.query('UPDATE experience_sync_logs SET world_bars = $2::jsonb WHERE id = $1', [logId, JSON.stringify(bars)]);
}

/** The source's world tier across runs, for its run with sync log `logId`. */
export async function worldHistory(sourceId: number, logId: number | null): Promise<WorldHistory> {
  return { memory: await readWorldMemory(sourceId), keep: (bars) => keepWorldBars(logId, bars) };
}

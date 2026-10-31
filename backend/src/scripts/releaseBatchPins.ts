/**
 * Release the pins one unread batch answer made on 2026-09-14 (#1365,
 * ADR-0096), once a curator has read the list.
 *
 *   npm --prefix backend run pins:release-batch -- --curator <user id> --keep <place id,…|none> [--write]
 *
 * Reads the batch from the curation log (`admission_overridden`, 16:33:50–
 * 16:34:00 UTC), follows each row through `experience_merges` to the place that
 * carries it today, and takes the membership of the kind the batch pinned.
 * A place named in `--keep` stays pinned, and the curator's decision is
 * recorded as an `admission_overridden` row, once: a run stopped part-way and
 * run again does not record it twice. `--keep` is required, and `none` is how
 * to keep nothing, so a forgotten flag cannot release the pins a curator kept. Every other pin is released
 * through the membership writer (`releaseAdmissionPin`), with the rule's
 * verdict written in its place and an `admission_pin_released` row naming the
 * batch. Each place is written under its own lock, in its own transaction.
 * Without `--write` it prints what it would do and writes nothing.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../db/index.js';
import { lockExperience } from '../db/experienceWriter.js';
import { releaseAdmissionPin } from '../controllers/experience/membershipWriter.js';

const BATCH_FROM = '2026-09-14T16:33:50Z';
const BATCH_TO = '2026-09-14T16:34:00Z';
// What the script records about how the answer came about: the system's words,
// under `systemNote`, never `note`, which every screen quotes as the curator's.
const NOTE_RELEASED = 'released when the batch answer of 14 September 2026 was read';
const NOTE_KEPT = 'kept when the batch answer of 14 September 2026 was read';

interface BatchPin {
  placeId: number;
  membershipId: number;
  name: string;
  kind: string;
  reason: string;
}

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** The batch's pins as they stand today: the place after any merge, the membership of the kind the batch pinned. */
async function batchPins(): Promise<BatchPin[]> {
  const result = await pool.query<{ place_id: number; membership_id: number; name: string; kind: string; reason: string }>(
    `WITH batch AS (
       SELECT l.experience_id, l.details->>'reason' AS reason
         FROM experience_curation_log l
        WHERE l.action = 'admission_overridden' AND l.created_at BETWEEN $1 AND $2
     ), now_at AS (
       SELECT b.experience_id AS orig, b.reason,
              COALESCE((SELECT m.survivor_id FROM experience_merges m
                         WHERE m.folded_id = b.experience_id AND m.undone_at IS NULL
                         ORDER BY m.id DESC LIMIT 1), b.experience_id) AS place
         FROM batch b
     )
     SELECT n.place AS place_id, km.id AS membership_id, e.name, k.name AS kind, n.reason
       FROM now_at n
       JOIN experiences o ON o.id = n.orig
       JOIN experience_sources s ON s.id = o.source_id
       JOIN experiences e ON e.id = n.place
       JOIN experience_kind_memberships km ON km.experience_id = n.place AND km.kind_id = s.kind_id
       JOIN experience_kinds k ON k.id = km.kind_id
      WHERE km.curated_fields ? 'admission'
      ORDER BY k.name, e.name`,
    [BATCH_FROM, BATCH_TO],
  );
  return result.rows.map(row => ({
    placeId: row.place_id, membershipId: row.membership_id, name: row.name, kind: row.kind, reason: row.reason,
  }));
}

/** Whether this script already recorded the place as kept. */
async function keptAlready(client: PoolClient, pin: BatchPin): Promise<boolean> {
  const found = await client.query(
    `SELECT 1 FROM experience_curation_log
      WHERE experience_id = $1 AND action = 'admission_overridden' AND details->>'systemNote' = $2`,
    [pin.placeId, NOTE_KEPT],
  );
  return (found.rowCount ?? 0) > 0;
}

async function answer(pin: BatchPin, keep: boolean, curatorId: number): Promise<void> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, pin.placeId);
    if (!locked) throw new Error(`place ${pin.placeId} is gone`);
    if (keep && await keptAlready(client, pin)) {
      await client.query('COMMIT');
      return;
    }
    if (!keep) await releaseAdmissionPin(client, locked.lock, pin.membershipId, { admitted: false, reason: pin.reason });
    // The membership named, as the kept-out list reads a refusal's note by it.
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [pin.placeId, curatorId, keep ? 'admission_overridden' : 'admission_pin_released',
        JSON.stringify({ reason: pin.reason, systemNote: keep ? NOTE_KEPT : NOTE_RELEASED, kind: pin.kind, membershipId: pin.membershipId })],
    );
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

async function main(): Promise<void> {
  const curatorId = Number(argument('curator'));
  if (!Number.isInteger(curatorId) || curatorId <= 0) throw new Error('--curator <user id> is required');
  const keepArgument = argument('keep');
  if (!keepArgument || keepArgument.startsWith('--')) throw new Error('--keep <place id,…> is required; --keep none keeps nothing');
  const keep = new Set(keepArgument === 'none' ? [] : keepArgument.split(',').map(Number));
  if ([...keep].some(id => !Number.isInteger(id) || id <= 0)) throw new Error(`--keep names something that is not a place id: ${keepArgument}`);
  const write = process.argv.includes('--write');
  const pins = await batchPins();
  const unknown = [...keep].filter(id => !pins.some(pin => pin.placeId === id));
  if (unknown.length > 0) throw new Error(`--keep names places the batch did not pin: ${unknown.join(', ')}`);
  for (const pin of pins) {
    const kept = keep.has(pin.placeId);
    console.log(`${kept ? 'keep   ' : 'release'}  ${pin.placeId}  ${pin.kind}  ${pin.name}  — the rule: ${pin.reason}`);
    if (write) await answer(pin, kept, curatorId);
  }
  console.log(`${pins.length} pins: ${keep.size} kept, ${pins.length - keep.size} released${write ? '' : ' (dry run: nothing written)'}`);
}

main().then(() => pool.end(), async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exitCode = 1;
});

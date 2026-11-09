import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';

/**
 * A place field's change is never held on a refused membership (#2391),
 * executed against PostgreSQL, since the hold is decided in SQL under the
 * upsert's lock.
 *
 * The fixture is the Karl Marx Monument in Chemnitz as the dev catalogue held
 * it on 2026-11-09: refused by Public art, which a curator passed, and offered
 * by Monuments & memorials. Both sources are gated and both read whom the
 * place commemorates (ADR-0190). Ids are the fixture's own, deleted before
 * and after.
 */

const MONUMENT = 9460;
const MONUMENT_QID = 'Q9460-karl-marx-monument-fixture';

const MARX = { item: 'Q9061', label: 'Karl Marx', articleUrl: null };
const ENGELS = { item: 'Q34666', label: 'Friedrich Engels', articleUrl: null };
const STORED = { via: 'commemorates', subjects: [MARX] };
const RUN = { via: 'commemorates', subjects: [MARX, ENGELS] };
/** An outline around the monument, which no source holds yet. */
const OUTLINE = 'POLYGON((12.9200 50.8350, 12.9212 50.8350, 12.9212 50.8364, 12.9200 50.8364, 12.9200 50.8350))';

let publicArt = 0;
let monuments = 0;
/** Each source's run log: the pointer a run sets names its own run. */
let logs: Record<number, number> = {};

async function sourceNamed(name: string): Promise<{ id: number; kind_id: number }> {
  const result = await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1 AND requires_curation', [name],
  );
  expect(result.rowCount).toBe(1);
  return result.rows[0];
}

const record = (sourceId: number): ExperienceUpsertParams => ({
  sourceId,
  externalId: MONUMENT_QID,
  name: 'Karl Marx Monument',
  nameLocal: { en: 'Karl Marx Monument' },
  subtitle: null,
  description: null,
  type: null,
  tags: [],
  lon: 12.9206,
  lat: 50.8357,
  countryCodes: ['DE'],
  countryNames: ['Germany'],
  imageUrl: null,
  metadata: { wikidataQid: MONUMENT_QID, commemorates: RUN },
});

async function clear(): Promise<void> {
  const ids = Object.values(logs);
  if (ids.length > 0) {
    await pool.query('UPDATE experience_kind_memberships SET pending_change_sync_log_id = NULL WHERE experience_id = $1', [MONUMENT]);
    await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = ANY($1::int[])', [ids]);
    await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [ids]);
    logs = {};
  }
  await pool.query('DELETE FROM experiences WHERE id = $1', [MONUMENT]);
}

/** Each kind's membership as the test sets it: admitted or refused, passed or not. */
async function given(memberships: { publicArt: [string, string]; monuments: [string, string] }): Promise<void> {
  const art = await sourceNamed('Public art');
  const mon = await sourceNamed('Monuments & memorials');
  publicArt = art.id;
  monuments = mon.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, metadata, location)
     VALUES ($1, $2, $3, 'Karl Marx Monument', $4, ST_SetSRID(ST_MakePoint(12.9206, 50.8357), 4326))`,
    [MONUMENT, mon.id, MONUMENT_QID, JSON.stringify({ wikidataQid: MONUMENT_QID, commemorates: STORED })],
  );
  const passed = (state: string) => (state === 'pending' ? null : new Date());
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7), ($1, $8, $9, $4, $10, $11, $12)`,
    [MONUMENT, art.kind_id, art.id, MONUMENT_QID, memberships.publicArt[0], memberships.publicArt[1], passed(memberships.publicArt[1]),
      mon.kind_id, mon.id, memberships.monuments[0], memberships.monuments[1], passed(memberships.monuments[1])],
  );
  for (const source of [art.id, mon.id]) {
    logs[source] = (await pool.query<{ id: number }>(
      `INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run)
       VALUES ($1, 'running', NOW(), FALSE) RETURNING id`, [source],
    )).rows[0].id;
  }
}

const commemorates = async () => (await pool.query<{ value: unknown }>(
  `SELECT metadata -> 'commemorates' AS value FROM experiences WHERE id = $1`, [MONUMENT],
)).rows[0].value;

const pointers = async () => Object.fromEntries((await pool.query<{ source_id: number; pointer: number | null }>(
  `SELECT source_id, pending_change_sync_log_id AS pointer FROM experience_kind_memberships WHERE experience_id = $1`,
  [MONUMENT],
)).rows.map(row => [row.source_id, row.pointer]));

const asked = (outcome: Awaited<ReturnType<typeof upsertExperienceRecord>>) =>
  [...outcome.changeSet.heldFields, ...outcome.changeSet.curatedConflicts].map(f => f.field);

beforeEach(clear);

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a place field's change on a refused membership (#2391)", () => {
  it('is asked once, by the kind that offers the place, and kept as stored by the kind that refused it', async () => {
    await given({ publicArt: ['refused', 'verified'], monuments: ['admitted', 'verified'] });

    const preview = await upsertExperienceRecord(record(publicArt), { dryRun: true });
    const refusing = await upsertExperienceRecord(record(publicArt), { syncLogId: logs[publicArt] });

    // The run that refused the place asks nothing, in its preview as in its run,
    // and the place keeps what it holds.
    expect(asked(preview)).toEqual([]);
    expect(asked(refusing)).toEqual([]);
    expect(refusing.changeSet.changedFields.map(f => f.field)).not.toContain('metadata.commemorates');
    expect(await commemorates()).toEqual(STORED);
    expect((await pointers())[publicArt]).toBeNull();

    // The kind that offers it asks, once.
    const offering = await upsertExperienceRecord(record(monuments), { syncLogId: logs[monuments] });
    expect(asked(offering)).toEqual(['metadata.commemorates']);
    expect(await commemorates()).toEqual(STORED);
    expect(await pointers()).toEqual({ [publicArt]: null, [monuments]: logs[monuments] });
  });

  it('is asked by nobody where every kind refuses the place, and nothing a reader could see is written', async () => {
    // Infant Jesus of Prague and the Rondanini Pietà: kept out by a curator in both kinds.
    await given({ publicArt: ['refused', 'verified'], monuments: ['refused', 'verified'] });

    for (const source of [publicArt, monuments]) {
      const outcome = await upsertExperienceRecord(record(source), { syncLogId: logs[source] });
      expect(asked(outcome)).toEqual([]);
    }
    expect(await commemorates()).toEqual(STORED);
    expect(await pointers()).toEqual({ [publicArt]: null, [monuments]: null });
  });

  it('clears the question a refusing run asked before', async () => {
    await given({ publicArt: ['refused', 'verified'], monuments: ['admitted', 'verified'] });
    await pool.query(
      'UPDATE experience_kind_memberships SET pending_change_sync_log_id = $3 WHERE experience_id = $1 AND source_id = $2',
      [MONUMENT, publicArt, logs[publicArt]],
    );

    await upsertExperienceRecord(record(publicArt), { syncLogId: logs[publicArt] });

    expect((await pointers())[publicArt]).toBeNull();
  });

  it('asks nothing about an outline the refusing run draws', async () => {
    // An outline passes the hold and is written, as a surveyed shape rather
    // than a claim about the place; the kind that turned the place down still
    // raises no question about it.
    await given({ publicArt: ['refused', 'verified'], monuments: ['admitted', 'verified'] });

    const outcome = await upsertExperienceRecord(
      { ...record(publicArt), boundaryWkt: OUTLINE, readsExtents: true }, { syncLogId: logs[publicArt] },
    );

    expect(outcome.changeSet.changedFields.map(f => f.field)).toContain('boundary');
    expect(await pointers()).toEqual({ [publicArt]: null, [monuments]: null });
  });

  it('refreshes a place no reader sees in place, where a passed membership refuses it and the run\'s own is unread', async () => {
    // Shown by no kind: the curator refused it in Public art, and the
    // Monuments arrival is still unread. Nothing to protect, so the run
    // writes and asks nothing; the arrival is the curator's question.
    await given({ publicArt: ['refused', 'verified'], monuments: ['admitted', 'pending'] });

    const outcome = await upsertExperienceRecord(record(monuments), { syncLogId: logs[monuments] });

    expect(asked(outcome)).toEqual([]);
    expect(await commemorates()).toEqual(RUN);
  });

  it('refreshes a place nobody has passed in place, where the run\'s own membership refuses it', async () => {
    // An arrival the kind's rule refused, on a place no curator has read yet:
    // nothing to protect, so the run writes the newest state for whoever reads
    // the place later, and asks nothing.
    await given({ publicArt: ['refused', 'pending'], monuments: ['admitted', 'pending'] });

    const outcome = await upsertExperienceRecord(record(publicArt), { syncLogId: logs[publicArt] });

    expect(asked(outcome)).toEqual([]);
    expect(await commemorates()).toEqual(RUN);
    expect(await pointers()).toEqual({ [publicArt]: null, [monuments]: null });
  });
});

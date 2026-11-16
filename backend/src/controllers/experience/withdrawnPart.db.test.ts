import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { partOfferedSql } from '../../db/readerPredicates.js';
import { writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';
import { withdrawnPointOpenSql } from './reviewQueuePredicates.js';
import { answerLocationStateUnderLock } from './locationStateController.js';
import { partAssertions } from '../admin/dataAssertions/partAssertions.js';

/**
 * A component the World Heritage list stops giving stays shown, on the map and
 * in its site's "k of N", until a curator answers (ADR-0216, #2123), against
 * PostgreSQL: Ancient Thebes as its run writes it, then the list without the
 * Theban Necropolis. The withdrawal is the part's record's, its point stands,
 * and the site's card asks it. Ids are the fixture's own, deleted before and
 * after.
 */

const THEBES = 9970;
const KARNAK = { name: 'Temple of Karnak', externalRef: '87-001', lon: 32.6573, lat: 25.7188 };
const LUXOR = { name: 'Luxor Temple', externalRef: '87-002', lon: 32.6390, lat: 25.6995 };
const NECROPOLIS = { name: 'Theban Necropolis', externalRef: '87-003', lon: 32.6060, lat: 25.7330 };
const TRAVELLER = '00000000-0000-4000-8000-000000009970';

let run: LocationWriteRun;

async function clear(): Promise<void> {
  await pool.query(
    'DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1) OR merged_into_id = $1',
    [THEBES],
  );
  await pool.query('DELETE FROM experiences WHERE id = $1', [THEBES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [TRAVELLER]);
}

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: source.id, components: true };
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9970', 'Ancient Thebes (withdrawal fixture)', ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326))`,
    [THEBES, source.id],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '9970', 'auto', NOW())`,
    [THEBES, source.kind_id, source.id],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});
/** The Theban Necropolis's line: its point, and its record in Ancient Thebes. */
async function necropolis() {
  const { rows } = await pool.query<{
    part_id: number; point_id: number; point_missing: Date | null; ordinal: number | null;
    record_missing: Date | null; listing: string; offered: boolean; asked: boolean;
  }>(
    `SELECT p.part_id, el.id AS point_id, el.missing_since AS point_missing, el.ordinal,
            rec.missing_since AS record_missing, rec.source_membership AS listing,
            ${partOfferedSql('e')} AS offered, ${withdrawnPointOpenSql('el')} AS asked
       FROM experience_parts p
       JOIN experiences e ON e.id = p.part_id
       JOIN source_records rec ON rec.experience_id = p.part_id AND rec.whole_id = p.whole_id AND rec.source_id = 10
       JOIN experience_locations el ON el.experience_id = p.part_id
      WHERE p.whole_id = $1 AND rec.external_id = $2`,
    [THEBES, NECROPOLIS.externalRef],
  );
  return rows[0];
}

describe('a component the list stops giving stays shown until a curator answers', () => {
  /** A curator's verdict on the necropolis's point, as the withdrawn card sends it. */
  async function answer(
    verdict: { membership?: 'former' | 'present'; existence?: 'lost' | 'extant' },
    expected: { membership: 'former' | 'present'; existence: 'lost' | 'extant'; flagged: boolean }
      = { membership: 'present', existence: 'extant', flagged: true },
  ) {
    const curator = (await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user')
       ON CONFLICT (uuid) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`, [TRAVELLER],
    )).rows[0].id;
    const { point_id } = await necropolis();
    return answerLocationStateUnderLock(point_id, THEBES, curator, null, {
      ...verdict, expected,
    });
  }

  /** The part's rows of the catalogue check that holds its record and its points to each other. */
  async function outOfStep(): Promise<unknown[]> {
    const check = partAssertions.find(a => a.id === 'part-gate-out-of-step')!;
    return (await pool.query(`SELECT * FROM (${check.sql}) x WHERE x.whole_id = $1`, [THEBES])).rows;
  }

  beforeEach(async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR, NECROPOLIS], run);
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
  });

  it('keeps the dropped line standing and shown, writes the withdrawal on its record, and asks it', async () => {
    expect(await necropolis()).toMatchObject({
      point_missing: null, ordinal: null, listing: 'present', offered: true, asked: true,
    });
    expect((await necropolis()).record_missing).not.toBeNull();
  });

  it('clears the withdrawal, and the question, when the list gives the line again', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR, NECROPOLIS], run);

    expect(await necropolis()).toMatchObject({ point_missing: null, record_missing: null, offered: true, asked: false });
    expect((await necropolis()).ordinal).not.toBeNull();
  });

  it('hides the part once a curator answers former, on the record and the point', async () => {
    const outcome = await answer({ membership: 'former' });

    expect(outcome.refusal).toBeUndefined();
    const after = await necropolis();
    expect(after).toMatchObject({ listing: 'former', offered: false, asked: false });
    expect(after.point_missing?.toISOString()).toBe(after.record_missing?.toISOString());
    expect(await outOfStep()).toEqual([]);
  });

  it('writes lost on the part, the record keeping its mark', async () => {
    await answer({ existence: 'lost' });

    const { part_id } = await necropolis();
    const end = await pool.query<{ source_id: number; year: number | null }>(
      `SELECT source_id, year FROM place_dates WHERE experience_id = $1 AND slot = 'ended'`, [part_id]);
    // Its end, from Curators, with no year (ADR-0214).
    expect(end.rows).toEqual([{ source_id: 11, year: null }]);
    expect(await necropolis()).toMatchObject({ asked: false, listing: 'present' });
    expect((await necropolis()).record_missing).not.toBeNull();
    expect(await outOfStep()).toEqual([]);
  });

  it('shows the part again when a curator takes former back: still listed', async () => {
    expect((await answer({ membership: 'former' })).result?.offeredToReaders).toBe(false);

    const taken = await answer({ membership: 'present' }, { membership: 'former', existence: 'extant', flagged: true });

    expect(taken.refusal).toBeUndefined();
    expect(taken.result?.offeredToReaders).toBe(true);
    expect(await necropolis()).toMatchObject({ listing: 'present', record_missing: null, point_missing: null, offered: true });
    expect(await outOfStep()).toEqual([]);
  });

  it('shows the part again when a curator takes lost back, and asks again while the list leaves it out', async () => {
    expect((await answer({ existence: 'lost' })).result?.offeredToReaders).toBe(false);

    const taken = await answer({ existence: 'extant' }, { membership: 'present', existence: 'lost', flagged: true });

    expect(taken.refusal).toBeUndefined();
    expect(taken.result?.offeredToReaders).toBe(true);
    const { part_id } = await necropolis();
    const end = await pool.query(`SELECT 1 FROM place_dates WHERE experience_id = $1 AND slot = 'ended'`, [part_id]);
    expect(end.rowCount).toBe(0);
    // Still standing says nothing of the list, which still leaves the line out.
    expect(await necropolis()).toMatchObject({ point_missing: null, offered: true, listing: 'present', asked: true });
    expect((await necropolis()).record_missing).not.toBeNull();
    expect(await outOfStep()).toEqual([]);
  });

  it('takes the mark off the record on a false alarm, the part still shown', async () => {
    await answer({ membership: 'present' });

    expect(await necropolis()).toMatchObject({ record_missing: null, point_missing: null, offered: true, asked: false });
  });
});

describe('a line the list gives under another part of the site is no move', () => {
  it('keeps the old part standing, withdrawn on its record, when a run already made the line a part of its own', async () => {
    // A run before #2182 read the renumbered necropolis as a new component and made it a part of its own.
    const renumbered = { ...NECROPOLIS, externalRef: '87-004', lat: NECROPOLIS.lat + 0.05 };
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR, NECROPOLIS], run);
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR, NECROPOLIS, renumbered], run);
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR, renumbered], run);

    expect(await necropolis()).toMatchObject({ point_missing: null, listing: 'present', offered: true, asked: true });
    expect((await necropolis()).record_missing).not.toBeNull();
  });
});

describe('a component nobody has read goes when the list stops giving it', () => {
  it('marks the line point of an unread part withdrawn, asking nothing', async () => {
    // Under the World Heritage source's gate, the site's new parts arrive unread.
    const gated = (await pool.query<{ requires_curation: boolean }>(
      'SELECT requires_curation FROM experience_sources WHERE id = $1', [run.sourceId],
    )).rows[0].requires_curation;
    await pool.query('UPDATE experience_sources SET requires_curation = TRUE WHERE id = $1', [run.sourceId]);
    try {
      await writeExperienceLocations(THEBES, [KARNAK, LUXOR, NECROPOLIS], run);
      await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    } finally {
      await pool.query('UPDATE experience_sources SET requires_curation = $2 WHERE id = $1', [run.sourceId, gated]);
    }

    const { rows } = await pool.query<{ point_missing: boolean; record_state: string; asked: boolean }>(
      `SELECT el.missing_since IS NOT NULL AS point_missing, rec.curation_state AS record_state,
              ${withdrawnPointOpenSql('el')} AS asked
         FROM source_records rec
         JOIN experience_locations el ON el.experience_id = rec.experience_id
        WHERE rec.whole_id = $1 AND rec.source_id = 10 AND rec.external_id = $2`,
      [THEBES, NECROPOLIS.externalRef],
    );
    expect(rows).toEqual([{ point_missing: true, record_state: 'pending', asked: false }]);
  });
});

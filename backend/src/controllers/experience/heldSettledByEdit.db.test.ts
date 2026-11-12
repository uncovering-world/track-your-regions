import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../db/index.js';
import { creditForOneImage } from '../../services/sync/imageCredit.js';
import { editExperience } from './curationEditController.js';
import { editExperienceBodySchema } from '../../types/index.js';

// Commons is asked whose a saved picture is; the answer is the fixture's.
vi.mock('../../services/sync/imageCredit.js', async (original) => ({
  ...(await original<typeof import('../../services/sync/imageCredit.js')>()),
  creditForOneImage: vi.fn(),
}));
const mockedCredit = creditForOneImage as unknown as ReturnType<typeof vi.fn>;

/**
 * A curator's edit answers the held proposal for the field it sets (#2293),
 * against PostgreSQL. The fixture is a made-up memorial in Monuments &
 * memorials, the Tree of Sadness in Beslan in miniature, whose last run
 * proposed a new subtitle and a new website, or a new picture and its
 * credit, that the gate held. Deleted before and after.
 */

const PLACE = 9470;
const ADMIN = '00000000-0000-4000-8000-000000009470';
const SUBTITLE = { field: 'subtitle', old: 'A memorial.', new: 'A memorial tree.', significance: 'minor', held: true };
const WEBSITE = {
  field: 'metadata.website', old: null, new: 'https://example.org/tree', significance: 'minor', held: true,
};
const TREE_PICTURE = 'https://commons.wikimedia.org/wiki/Special:FilePath/Tree%20of%20Sadness%20fixture.jpg';
const OTHER_PICTURE = 'https://commons.wikimedia.org/wiki/Special:FilePath/Beslan%20memorial%20fixture.jpg';
const TREE_CREDIT = { author: 'A photographer', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null };
const PICTURE = { field: 'imageUrl', old: null, new: TREE_PICTURE, significance: 'minor', held: true };
const CREDIT = { field: 'metadata.imageCredit', old: null, new: TREE_CREDIT, significance: 'minor', held: true };

let adminId = 0;
let syncLog = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [PLACE]);
  await pool.query('DELETE FROM experience_held_decisions WHERE experience_id = $1', [PLACE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  if (syncLog) await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [syncLog]);
  syncLog = 0;
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

const edit = (body: object) => editExperience({
  params: { id: PLACE },
  body: editExperienceBodySchema.parse(body),
  caller: { id: adminId, role: 'admin' } as Express.User,
});

const answers = async () => (await pool.query<{ field: string; answer: string; value: unknown }>(
  'SELECT field, answer, value FROM experience_held_decisions WHERE experience_id = $1 ORDER BY field', [PLACE],
)).rows;

const pointer = async () => (await pool.query<{ pending_change_sync_log_id: number | null }>(
  'SELECT pending_change_sync_log_id FROM source_records WHERE experience_id = $1', [PLACE],
)).rows[0].pending_change_sync_log_id;

/** The run whose proposal the gate held, with `fields` on its changeset. */
async function heldRun(fields: object[]): Promise<void> {
  if (syncLog) {
    await pool.query('UPDATE source_records SET pending_change_sync_log_id = NULL WHERE experience_id = $1', [PLACE]);
    await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [syncLog]);
  }
  syncLog = (await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES (6, 'success', NOW()) RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields)
     VALUES ($1, $2, 'Q9470001', 'held', $3)`,
    [syncLog, PLACE, JSON.stringify(fields)],
  );
  await pool.query(
    'UPDATE source_records SET pending_change_sync_log_id = $2 WHERE experience_id = $1',
    [PLACE, syncLog],
  );
}

beforeEach(async () => {
  await clear();
  mockedCredit.mockReset();
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, subtitle, location)
     VALUES ($1, 6, 'Q9470001', 'Tree of Sadness (fixture)', 'A memorial.',
             ST_SetSRID(ST_MakePoint(44.6, 43.18), 4326))`,
    [PLACE],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, 'Q9470001', 'admitted', 'verified', NOW() FROM experience_sources s WHERE s.id = 6`,
    [PLACE],
  );
  await heldRun([SUBTITLE, WEBSITE]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a curator's edit of a field a run's held proposal names", () => {
  it('refuses the proposal for a value the curator did not take, and leaves the other field asked', async () => {
    await edit({ subtitle: 'The poplar of the school yard.' });

    expect(await answers()).toEqual([{ field: 'subtitle', answer: 'refused', value: 'A memorial tree.' }]);
    expect(await pointer()).toBe(syncLog);
    const log = await pool.query<{ details: { heldSettled?: unknown[] } }>(
      `SELECT details FROM experience_curation_log WHERE experience_id = $1 AND action = 'edited'`, [PLACE],
    );
    expect(log.rows[0].details.heldSettled).toEqual([
      { field: 'subtitle', answer: 'refused', proposed: 'A memorial tree.', fromSyncLogId: syncLog },
    ]);
  });

  it('publishes the proposal the curator typed, and the card goes once nothing is left asked', async () => {
    await edit({ subtitle: 'A memorial tree.', websiteUrl: 'https://example.org/other' });

    expect(await answers()).toEqual([
      { field: 'metadata.website', answer: 'refused', value: 'https://example.org/tree' },
      { field: 'subtitle', answer: 'published', value: 'A memorial tree.' },
    ]);
    expect(await pointer()).toBeNull();
  });

  it('answers a picture and its credit as one: published where the curator saved the run\'s picture', async () => {
    await heldRun([PICTURE, CREDIT]);
    mockedCredit.mockResolvedValue(TREE_CREDIT);

    await edit({ imageUrl: TREE_PICTURE });

    expect(await answers()).toEqual([
      { field: 'imageUrl', answer: 'published', value: TREE_PICTURE },
      { field: 'metadata.imageCredit', answer: 'published', value: TREE_CREDIT },
    ]);
    expect(await pointer()).toBeNull();
  });

  it("gives the credit the picture's answer where Commons now words the credit otherwise", async () => {
    await heldRun([PICTURE, CREDIT]);
    mockedCredit.mockResolvedValue({ ...TREE_CREDIT, license: 'CC BY-SA 4.0 International' });

    await edit({ imageUrl: TREE_PICTURE });

    expect((await answers()).map(row => [row.field, row.answer])).toEqual([
      ['imageUrl', 'published'], ['metadata.imageCredit', 'published'],
    ]);
  });

  it('refuses the picture and its credit where the curator saved another picture', async () => {
    await heldRun([PICTURE, CREDIT]);
    mockedCredit.mockResolvedValue({ ...TREE_CREDIT, author: 'Another photographer' });

    await edit({ imageUrl: OTHER_PICTURE });

    expect((await answers()).map(row => [row.field, row.answer])).toEqual([
      ['imageUrl', 'refused'], ['metadata.imageCredit', 'refused'],
    ]);
  });

  it("leaves the run's credit asked where the saved picture's credit could not be read", async () => {
    await heldRun([PICTURE, CREDIT]);
    mockedCredit.mockResolvedValue(null);

    await edit({ imageUrl: TREE_PICTURE });

    expect(await answers()).toEqual([{ field: 'imageUrl', answer: 'published', value: TREE_PICTURE }]);
    expect(await pointer()).toBe(syncLog);
  });

  it("refuses a credit the run proposed alone for the picture the curator replaced, though Commons named nobody", async () => {
    await heldRun([CREDIT]);
    mockedCredit.mockResolvedValue(null);

    await edit({ imageUrl: OTHER_PICTURE });

    expect(await answers()).toEqual([{ field: 'metadata.imageCredit', answer: 'refused', value: TREE_CREDIT }]);
    expect(await pointer()).toBeNull();
  });

  it('refuses the credit with the picture the curator turned down, though Commons named nobody', async () => {
    await heldRun([PICTURE, CREDIT]);
    mockedCredit.mockResolvedValue(null);

    await edit({ imageUrl: OTHER_PICTURE });

    expect((await answers()).map(row => [row.field, row.answer])).toEqual([
      ['imageUrl', 'refused'], ['metadata.imageCredit', 'refused'],
    ]);
    expect(await pointer()).toBeNull();
  });

  it('leaves a credit asked where the edit did not touch the picture', async () => {
    await heldRun([CREDIT, SUBTITLE]);

    await edit({ subtitle: 'A memorial tree.' });

    expect(await answers()).toEqual([{ field: 'subtitle', answer: 'published', value: 'A memorial tree.' }]);
    expect(await pointer()).toBe(syncLog);
  });

  it('answers nothing it did not set', async () => {
    await edit({ name: 'Tree of Sadness, Beslan (fixture)' });

    expect(await answers()).toEqual([]);
    expect(await pointer()).toBe(syncLog);
  });
});

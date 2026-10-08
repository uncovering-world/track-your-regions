import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Jev's suggestion for the sources card (#1260), against PostgreSQL, with Jev
 * itself stood in for: Rila Monastery as UNESCO (216) and Wikidata (Q207945)
 * describe it, Jev picking UNESCO's name. Asked once per views, kept while they
 * stand, asked again once a source sends something new; and what curators then
 * chose is compared with it.
 */

vi.mock('../../services/jev/jevClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/jev/jevClient.js')>()),
  jevConfigured: () => true,
  askJevChoice: vi.fn(),
}));
// The curator is in scope for the place's sources as they stand — read from
// the database, as the real resolver reads them.
vi.mock('./experienceScope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./experienceScope.js')>()),
  resolveEverySourceScope: vi.fn(async (_user: number, _role: string, id: number) => {
    const { pool: db } = await import('../../db/index.js');
    const rows = await db.query<{ source_id: number }>(
      'SELECT DISTINCT source_id FROM experience_kind_memberships WHERE experience_id = $1 ORDER BY source_id', [id],
    );
    return { permitted: true, logRegionId: null, sourceIds: rows.rows.map(row => row.source_id) };
  }),
}));

import { pool } from '../../db/index.js';
import { askJevChoice, JevAnswerRefused } from '../../services/jev/jevClient.js';
import { resolveEverySourceScope } from './experienceScope.js';
import { getJevUsage } from '../admin/jevUsageController.js';
import { suggestViews } from './viewSuggestionController.js';
import { chooseViewsUnderLock } from './viewChoiceController.js';

const mockedAsk = askJevChoice as unknown as ReturnType<typeof vi.fn>;

const RILA = 9810;
const CURATOR = '00000000-0000-4000-8000-000000009810';
let curatorId = 0;
let unescoView = 0;
let wikidataView = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [RILA]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [RILA]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function membership(source: string, externalId: string, name: string): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at,
       reported_name, reported_location)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW(), $3, ST_SetSRID(ST_MakePoint(23.3402, 42.1333), 4326)
       FROM experience_sources s WHERE s.name = $4 RETURNING id`,
    [RILA, externalId, name, source],
  );
  return row.rows[0].id;
}

const ask = () => suggestViews({ params: { id: RILA }, caller: { id: curatorId, role: 'curator' } as Express.User });

beforeEach(async () => {
  await clear();
  mockedAsk.mockReset();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, '216', 'Rila Monastery', ST_SetSRID(ST_MakePoint(23.3402, 42.1333), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [RILA],
  );
  unescoView = await membership('UNESCO World Heritage Sites', '216', 'Rila Monastery');
  wikidataView = await membership('Places of worship', 'Q207945', 'Monastery of Saint John of Rila');
  mockedAsk.mockResolvedValue({
    choice: `view${unescoView}`, probabilities: {}, confidence: 0.96, model: 'jev-1.13.0', inputTokens: 428,
  });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("Jev's suggestion on the sources card (#1260)", () => {
  it('asks once for the views as they stand, and again once a source sends something new', async () => {
    expect(await ask()).toEqual({ configured: true, suggestions: [{ field: 'name', membershipId: unescoView, confidence: 0.96 }] });
    expect(await ask()).toEqual({ configured: true, suggestions: [{ field: 'name', membershipId: unescoView, confidence: 0.96 }] });
    expect(mockedAsk).toHaveBeenCalledTimes(1);

    await pool.query(`UPDATE experience_kind_memberships SET reported_name = 'Rila Monastery of St John' WHERE id = $1`, [wikidataView]);
    await ask();

    expect(mockedAsk).toHaveBeenCalledTimes(2);
  });

  it('shows no answer about views a source changed while Jev was answering, and still counts the call', async () => {
    mockedAsk.mockImplementation(async () => {
      await pool.query(`UPDATE experience_kind_memberships SET reported_name = 'Rila Monastery of St John' WHERE id = $1`, [wikidataView]);
      return { choice: `view${unescoView}`, probabilities: {}, confidence: 0.96, model: 'jev-1.13.0', inputTokens: 428 };
    });

    expect(await ask()).toEqual({ configured: true, suggestions: [] });
    const stored = await pool.query('SELECT 1 FROM experience_view_suggestions WHERE experience_id = $1', [RILA]);
    expect(stored.rowCount).toBe(1);

    // The next opening asks about the views as they stand now.
    mockedAsk.mockResolvedValue({ choice: `view${unescoView}`, probabilities: {}, confidence: 0.9, model: 'jev-1.13.0', inputTokens: 430 });
    expect((await ask()).suggestions).toHaveLength(1);
    expect(mockedAsk).toHaveBeenCalledTimes(2);
  });

  it('records an answer it refused with what it cost, and does not pay for the same views again', async () => {
    mockedAsk.mockRejectedValue(new JevAnswerRefused('jev-1.13.0', 431));

    expect(await ask()).toEqual({ configured: true, suggestions: [] });
    expect(await ask()).toEqual({ configured: true, suggestions: [] });

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    const stored = await pool.query<{ input_tokens: number; suggested_membership_id: number | null }>(
      'SELECT input_tokens, suggested_membership_id FROM experience_view_suggestions WHERE experience_id = $1', [RILA],
    );
    expect(stored.rows).toEqual([{ input_tokens: 431, suggested_membership_id: null }]);
  });

  it('sends nothing once the place holds a source the curator was not checked for', async () => {
    (resolveEverySourceScope as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ permitted: true, logRegionId: null, sourceIds: [1] });

    expect(await ask()).toEqual({ configured: true, suggestions: [] });
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it('counts what it cost and whether the curator chose what it suggested', async () => {
    const before = await getJevUsage();
    await ask();
    await chooseViewsUnderLock(RILA, curatorId, null, [{ field: 'name', membershipId: wikidataView }],
      (await pool.query<{ source_id: number }>(
        'SELECT DISTINCT source_id FROM experience_kind_memberships WHERE experience_id = $1 ORDER BY source_id', [RILA],
      )).rows.map(row => row.source_id));

    const after = await getJevUsage();

    expect(after.calls - before.calls).toBe(1);
    expect(after.inputTokens - before.inputTokens).toBe(428);
    expect(after.compared - before.compared).toBe(1);
    expect(after.agreed - before.agreed).toBe(0);
  });
});

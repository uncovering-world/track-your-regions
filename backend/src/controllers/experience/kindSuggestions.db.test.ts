import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Jev's reading of which kind an arriving place belongs to (#2342), against
 * PostgreSQL, with Jev and Wikipedia stood in for: the Cellular Jail in Port
 * Blair (Q1052406), arriving in Monuments & memorials and read as a planned
 * kind of the register. Asked once for the place and the kinds as they stand,
 * again once either changes; only while it is arriving; the curator's answer
 * about the planned kind recorded; and the reading compared with what the
 * curator then did.
 */

vi.mock('../../services/jev/jevClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/jev/jevClient.js')>()),
  jevConfigured: () => true,
  askJevChoice: vi.fn(),
}));
vi.mock('../../services/sync/visit/visitReading.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/visit/visitReading.js')>()),
  articleLead: vi.fn(async () => 'The Cellular Jail was a colonial prison in Port Blair, used to exile political prisoners.'),
}));
vi.mock('./experienceScope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./experienceScope.js')>()),
  resolveExperienceScope: vi.fn(async () => ({ permitted: true, logRegionId: null })),
}));

import { pool } from '../../db/index.js';
import { askJevChoice, JevAnswerRefused } from '../../services/jev/jevClient.js';
import { getJevUsage } from '../admin/jevUsageController.js';
import { refuseArrivalUnderLock } from './curatorRefusalController.js';
import { resolveExperienceScope } from './experienceScope.js';
import { answerPlannedKind, suggestKind } from './kindSuggestionController.js';

const mockedAsk = askJevChoice as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;

const JAIL = 92342;
const CURATOR = '00000000-0000-4000-8000-000000092342';
/** A planned kind of the fixture's own, so no loaded register is relied on or disturbed. */
const PLANNED = 'historical-sites-fixture-2342';
let curatorId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [JAIL]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [JAIL]);
  await pool.query('DELETE FROM coverage_kinds WHERE slug = $1', [PLANNED]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

const caller = () => ({ id: curatorId, role: 'curator' } as Express.User);
const ask = () => suggestKind({ params: { id: JAIL }, caller: caller() });
const answer = (belongs: boolean, plannedKind = PLANNED) =>
  answerPlannedKind({ params: { id: JAIL }, body: { plannedKind, belongs }, caller: caller() });
const answered = (choice: string, confidence: number) => ({
  choice, probabilities: {}, confidence, model: 'jev-1.13.0', inputTokens: 3500,
});
const kindsUsage = async () => (await getJevUsage()).byQuestion.find(one => one.question === 'kinds')!;
const monumentsId = async () =>
  (await pool.query<{ id: number }>(`SELECT id FROM experience_kinds WHERE name = 'Monuments & memorials'`)).rows[0].id;

beforeEach(async () => {
  await clear();
  mockedAsk.mockReset();
  mockedAsk.mockResolvedValue(answered(`planned-${PLANNED}`, 0.85));
  mockedScope.mockClear();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO coverage_kinds (slug, name, form, definition, status, issue_number)
     VALUES ($1, 'Historical sites', 'place', 'A place where a significant moment happened, visited for that moment.',
             'proposed', 9999)`,
    [PLANNED],
  );
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, subtitle, location, country_names, metadata)
     SELECT $1, s.id, 'Q92342001', 'Cellular Jail', 'colonial prison in India',
            ST_SetSRID(ST_MakePoint(92.7488, 11.6745), 4326), ARRAY['India'],
            jsonb_build_object('wikipediaUrl', 'https://en.wikipedia.org/wiki/Cellular_Jail')
       FROM experience_sources s WHERE s.name = 'Monuments & memorials'`,
    [JAIL],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state)
     SELECT $1, s.kind_id, s.id, 'Q92342001', 'pending' FROM experience_sources s WHERE s.name = 'Monuments & memorials'`,
    [JAIL],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("Jev's reading of which kind an arriving place belongs to (#2342)", () => {
  it('offers the live kinds and the planned ones with their definitions, and names the planned kind with its issue', async () => {
    expect(await ask()).toEqual({
      configured: true,
      suggestion: {
        reading: 'planned', kind: null, confidence: 0.85,
        plannedKind: { slug: PLANNED, name: 'Historical sites', issue: 9999, belongs: null },
      },
    });

    const question = mockedAsk.mock.calls[0][0];
    expect(question.state).toEqual({
      name: 'Cellular Jail', countries: ['India'], description: 'colonial prison in India',
      wikipedia_lead: 'The Cellular Jail was a colonial prison in Port Blair, used to exile political prisoners.',
    });
    expect(question.criteria[`kind-${await monumentsId()}`]).toMatch(/^Monuments & memorials: /);
    expect(question.criteria[`planned-${PLANNED}`])
      .toBe('Historical sites: A place where a significant moment happened, visited for that moment.');
    // A place is a World Heritage Site by inscription alone, which no curator can add.
    expect(question.criteria['kind-1']).toBeUndefined();
    expect(question.criteria.none).toMatch(/^None of these kinds/);
  });

  it("names a live kind by its id and name, and the place's standing in it where it has one", async () => {
    mockedAsk.mockResolvedValue(answered(`kind-${await monumentsId()}`, 0.7));

    expect((await ask()).suggestion).toEqual({
      reading: 'live', kind: { id: await monumentsId(), name: 'Monuments & memorials', held: 'arriving' }, plannedKind: null, confidence: 0.7,
    });

    const publicArt = (await pool.query<{ id: number }>("SELECT id FROM experience_kinds WHERE name = 'Public art'")).rows[0].id;
    await pool.query('DELETE FROM experience_kind_suggestions WHERE experience_id = $1', [JAIL]);
    mockedAsk.mockResolvedValue(answered(`kind-${publicArt}`, 0.8));
    expect((await ask()).suggestion?.kind).toEqual({ id: publicArt, name: 'Public art', held: null });

    // Kept out of Public art by its rule: refused, which only a refusal is said to be.
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, admission)
       SELECT $1, s.kind_id, s.id, 'Q92342001', 'pending', 'refused' FROM experience_sources s WHERE s.name = 'Public art'`,
      [JAIL]);
    await pool.query('DELETE FROM experience_kind_suggestions WHERE experience_id = $1', [JAIL]);
    expect((await ask()).suggestion?.kind).toEqual({ id: publicArt, name: 'Public art', held: 'kept_out' });
  });

  it('asks once for the place and the kinds as they stand, and again once the register changes', async () => {
    await ask();
    await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(1);

    await pool.query(`UPDATE coverage_kinds SET definition = definition || ' A battlefield, a prison.' WHERE slug = $1`, [PLANNED]);
    await ask();

    expect(mockedAsk).toHaveBeenCalledTimes(2);
  });

  it('shows no answer about a place a curator answered while Jev was reading it', async () => {
    mockedAsk.mockImplementation(async () => {
      await pool.query(
        `UPDATE source_records SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1`,
        [JAIL],
      );
      return answered(`planned-${PLANNED}`, 0.85);
    });

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    const stored = await pool.query('SELECT 1 FROM experience_kind_suggestions WHERE experience_id = $1', [JAIL]);
    expect(stored.rowCount).toBe(1);
  });

  it('asks nothing of a place that is not arriving, and refuses an answer about it', async () => {
    await pool.query(
      `UPDATE source_records SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1`,
      [JAIL],
    );

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    expect(mockedAsk).not.toHaveBeenCalled();
    await expect(answer(true)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("is asked and answered in the arriving source's scope", async () => {
    const monuments = await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Monuments & memorials'`);
    mockedScope.mockResolvedValueOnce({ permitted: false, logRegionId: null });
    await expect(ask()).rejects.toMatchObject({ statusCode: 403 });
    mockedScope.mockResolvedValueOnce({ permitted: false, logRegionId: null });
    await expect(answer(true)).rejects.toMatchObject({ statusCode: 403 });

    expect(mockedScope.mock.calls.map(call => call[3])).toEqual([monuments.rows[0].id, monuments.rows[0].id]);
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it("records the curator's answer about the planned kind, the latest one standing, and shows it on the card", async () => {
    await ask();
    expect(await answer(false)).toEqual({ experienceId: JAIL, plannedKind: PLANNED, belongs: false });
    expect(await answer(true)).toEqual({ experienceId: JAIL, plannedKind: PLANNED, belongs: true });

    const rows = await pool.query<{ belongs: boolean; curator_id: number }>(
      'SELECT belongs, curator_id FROM experience_planned_kind_answers WHERE experience_id = $1', [JAIL],
    );
    expect(rows.rows).toEqual([{ belongs: true, curator_id: curatorId }]);
    expect((await ask()).suggestion?.plannedKind?.belongs).toBe(true);
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  it('refuses an answer about a kind the register does not plan', async () => {
    await expect(answer(true, 'monuments-and-memorials')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('records an answer it refused with what it cost, and does not pay for the same place again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedAsk.mockRejectedValue(new JevAnswerRefused('jev-1.13.0', 3400));

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    expect(await ask()).toEqual({ configured: true, suggestion: null });

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    const stored = await pool.query<{ input_tokens: number; reading: string | null }>(
      'SELECT input_tokens, reading FROM experience_kind_suggestions WHERE experience_id = $1', [JAIL],
    );
    expect(stored.rows).toEqual([{ input_tokens: 3400, reading: null }]);
  });

  it("counts what it cost, and a curator's yes to the planned kind as agreeing", async () => {
    const before = await kindsUsage();
    await ask();
    await answer(true);

    const after = await kindsUsage();
    expect(after.calls - before.calls).toBe(1);
    expect(after.inputTokens - before.inputTokens).toBe(3500);
    expect(after.compared - before.compared).toBe(1);
    expect(after.agreed - before.agreed).toBe(1);
  });

  it('counts a live reading once the arrival is answered, by whether the place is published in that kind', async () => {
    mockedAsk.mockResolvedValue(answered(`kind-${await monumentsId()}`, 0.9));
    const before = await kindsUsage();
    await ask();
    expect((await kindsUsage()).compared - before.compared).toBe(0);

    await pool.query(
      `UPDATE source_records SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1`,
      [JAIL],
    );
    const after = await kindsUsage();
    expect(after.compared - before.compared).toBe(1);
    expect(after.agreed - before.agreed).toBe(1);
  });

  it('counts a reading of no kind as agreeing with an arrival kept out', async () => {
    mockedAsk.mockResolvedValue(answered('none', 0.9));
    const before = await kindsUsage();
    await ask();
    await refuseArrivalUnderLock(JAIL, curatorId, null, {});

    const after = await kindsUsage();
    expect(after.compared - before.compared).toBe(1);
    expect(after.agreed - before.agreed).toBe(1);
  });
});

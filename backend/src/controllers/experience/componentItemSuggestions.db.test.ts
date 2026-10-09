import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Jev's judgement of a site's candidate component items (#1272), against
 * PostgreSQL, with Jev itself stood in for: the Dacian frontier's Bologa with
 * two candidates and Buciumi with one, Jev calling the forts the components
 * and the tower another place. Asked once per candidate as it stands, in one
 * call for the card, kept while the candidate stands, asked again once the
 * finder proposes it with other measures; and what curators then answered is
 * compared with it.
 */

vi.mock('../../services/jev/jevClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/jev/jevClient.js')>()),
  jevConfigured: () => true,
  askJevChoices: vi.fn(),
}));
// The curator is in scope for the site: the real resolver would read grants
// this fixture does not make.
vi.mock('./componentItemController.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./componentItemController.js')>()),
  componentItemsScope: vi.fn(async () => ({ permitted: true, logRegionId: null, found: true })),
}));

import { pool } from '../../db/index.js';
import { askJevChoices } from '../../services/jev/jevClient.js';
import { getJevUsage } from '../admin/jevUsageController.js';
import { answerComponentItemsUnderLock } from './componentItemController.js';
import { suggestComponentItems } from './componentItemSuggestionController.js';

const mockedAsk = askJevChoices as unknown as ReturnType<typeof vi.fn>;

const SITE = 9860;
const CURATOR = '00000000-0000-4000-8000-000000009860';
const BOLOGA_FORT = 'Q98601';
const BOLOGA_TOWER = 'Q98602';
const BUCIUMI_FORT = 'Q98603';

let curatorId = 0;
let membershipId = 0;
let points: Record<string, number> = {};
let proposals: Record<string, number> = {};

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function point(ref: string, name: string, lat: number, lon: number): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'auto') RETURNING id`,
    [SITE, name, ref, lon, lat],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [row.rows[0].id, membershipId],
  );
  return row.rows[0].id;
}

async function proposal(locationId: number, item: string, label: string, metres: number, similarity: number, exact: boolean): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_component_item_proposals
            (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
     VALUES ($1, $2, $3, $4, $5, $6, 'near') RETURNING id`,
    [locationId, item, label, metres, similarity, exact],
  );
  return row.rows[0].id;
}

const ask = () => suggestComponentItems({ params: { id: SITE }, caller: { id: curatorId, role: 'curator' } as Express.User });

const stored = async () => (await pool.query<{ wikidata_item: string; judgement: string | null; input_tokens: number }>(
  `SELECT s.wikidata_item, s.judgement, s.input_tokens FROM experience_component_item_suggestions s
     JOIN experience_locations el ON el.id = s.location_id WHERE el.experience_id = $1 ORDER BY s.id`, [SITE],
)).rows;

const jevSays = (answers: Record<string, { choice: string; confidence: number } | { refused: true }>) => ({
  answers: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, 'refused' in a ? a : { ...a, probabilities: {} }])),
  model: 'jev-1.13.0', inputTokens: 1000,
});

beforeEach(async () => {
  await clear();
  mockedAsk.mockReset();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, country_names)
     VALUES ($1, 1, '9860-fixture', 'Component judgement fixture', ST_SetSRID(ST_MakePoint(22.87, 46.88), 4326), ARRAY['Romania'])`,
    [SITE],
  );
  membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9860-fixture', 'auto', NOW() FROM experience_sources s WHERE s.id = 1 RETURNING id`,
    [SITE],
  )).rows[0].id;
  points = {
    bologa: await point('9860-001', 'Bologa', 46.8853, 22.8752),
    buciumi: await point('9860-002', 'Buciumi', 47.0383, 23.0581),
  };
  proposals = {
    fort: await proposal(points.bologa, BOLOGA_FORT, 'Castrul Bologa', 20, 1, true),
    tower: await proposal(points.bologa, BOLOGA_TOWER, 'Turnul Bologa', 410, 0.52, false),
    buciumi: await proposal(points.buciumi, BUCIUMI_FORT, 'Castrul Buciumi', 35, 0.61, false),
  };
  mockedAsk.mockResolvedValue(jevSays({
    [`p${proposals.fort}`]: { choice: 'same', confidence: 0.93 },
    [`p${proposals.tower}`]: { choice: 'other', confidence: 0.81 },
    [`p${proposals.buciumi}`]: { choice: 'same', confidence: 0.88 },
  }));
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("Jev's judgement of a site's candidate component items (#1272)", () => {
  it('asks about every open candidate in one call, shares the cost out, and asks nothing the second time', async () => {
    const first = await ask();

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    const [state, questions] = mockedAsk.mock.calls[0];
    expect(state).toEqual({ site: 'Component judgement fixture', countries: ['Romania'], kind: 'World Heritage Site' });
    expect(Object.keys(questions)).toEqual([`p${proposals.fort}`, `p${proposals.tower}`, `p${proposals.buciumi}`]);
    expect(questions[`p${proposals.tower}`].instructions).toContain('"Turnul Bologa" (Q98602)');
    expect(questions[`p${proposals.tower}`].instructions).toContain('stands 410 m from the point');
    expect(questions[`p${proposals.tower}`].criteria).toEqual(expect.objectContaining({ same: expect.any(String), other: expect.any(String) }));
    expect(first).toEqual({
      configured: true,
      suggestions: [
        { proposalId: proposals.fort, judgement: 'same', confidence: 0.93 },
        { proposalId: proposals.tower, judgement: 'other', confidence: 0.81 },
        { proposalId: proposals.buciumi, judgement: 'same', confidence: 0.88 },
      ],
    });
    // 1000 tokens over three questions: 334, 333, 333.
    expect((await stored()).map(row => row.input_tokens)).toEqual([334, 333, 333]);

    const second = await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(second.suggestions).toEqual(first.suggestions);
  });

  it('records an answer it refused with no judgement, shows none, and does not ask about that candidate again', async () => {
    mockedAsk.mockResolvedValue(jevSays({
      [`p${proposals.fort}`]: { choice: 'same', confidence: 0.93 },
      [`p${proposals.tower}`]: { refused: true },
      [`p${proposals.buciumi}`]: { choice: 'same', confidence: 0.88 },
    }));

    const first = await ask();
    expect(first.suggestions.map(s => s.proposalId)).toEqual([proposals.fort, proposals.buciumi]);
    expect((await stored()).find(row => row.wikidata_item === BOLOGA_TOWER)).toMatchObject({ judgement: null });

    await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  it('asks again about a candidate the finder proposed with other measures, and not about the rest', async () => {
    await ask();
    // The next pass found the tower 30 m closer.
    await pool.query('UPDATE experience_component_item_proposals SET distance_m = 380 WHERE id = $1', [proposals.tower]);
    mockedAsk.mockResolvedValue(jevSays({ [`p${proposals.tower}`]: { choice: 'other', confidence: 0.85 } }));

    const again = await ask();

    expect(mockedAsk).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockedAsk.mock.calls[1][1])).toEqual([`p${proposals.tower}`]);
    expect(again.suggestions).toContainEqual({ proposalId: proposals.tower, judgement: 'other', confidence: 0.85 });
    expect(again.suggestions).toContainEqual({ proposalId: proposals.fort, judgement: 'same', confidence: 0.93 });
  });

  it('leaves the candidates without a judgement when the call fails, and asks again next time', async () => {
    mockedAsk.mockRejectedValueOnce(new Error('Jev answered 503'));
    expect((await ask()).suggestions).toEqual([]);
    expect(await stored()).toEqual([]);

    const again = await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(2);
    expect(again.suggestions).toHaveLength(3);
  });

  it("counts what it cost and whether the curators' answers took what it suggested", async () => {
    await ask();
    await answerComponentItemsUnderLock(SITE, curatorId, null, [
      { proposalId: proposals.fort, answer: 'accepted' },
      { proposalId: proposals.buciumi, answer: 'refused' },
    ], new Map());

    const usage = await getJevUsage();
    const items = usage.byQuestion.find(q => q.question === 'componentItems')!;
    // The fort confirmed as Jev said; Buciumi turned down against Jev's word;
    // the tower, cleared as moot by the fort's confirmation, was never answered.
    expect(items).toMatchObject({ calls: 3, inputTokens: 1000, compared: 2, agreed: 1 });
    expect(usage.calls).toBeGreaterThanOrEqual(3);
    expect(usage.usd).toBeCloseTo(usage.inputTokens * 0.042 / 1_000_000, 6);
  });
});

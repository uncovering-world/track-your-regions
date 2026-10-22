import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Jev's judgement of two near places with similar names (#1249), against
 * PostgreSQL, with Jev itself stood in for: Durham as the pass proposes it,
 * the World Heritage row "Durham Castle and Cathedral" with the cathedral as a
 * place of worship 139 m off and a public-art row of the same name 20 m off,
 * Jev calling the first a part of the other and the second one place. Asked
 * once per pair as it stands, in one call for the card, kept while the pair
 * stands, asked again once the pass refreshes its measures; and what curators
 * then answered is compared with it.
 */

vi.mock('../../services/jev/jevClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/jev/jevClient.js')>()),
  jevConfigured: () => true,
  askJevChoices: vi.fn(),
}));
// The curator is in scope for the place: the real resolver would read grants
// this fixture does not make.
vi.mock('./mergeProposalController.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mergeProposalController.js')>()),
  mergeProposalsScope: vi.fn(async () => ({ permitted: true, logRegionId: null, found: true, sourceIds: [1, 3, 4] })),
}));

import { pool } from '../../db/index.js';
import { askJevChoices } from '../../services/jev/jevClient.js';
import { getJevUsage } from '../admin/jevUsageController.js';
import { answerMergeProposalsOneByOne } from './mergeProposalController.js';
import { suggestMergeProposals } from './mergeProposalSuggestionController.js';

const mockedAsk = askJevChoices as unknown as ReturnType<typeof vi.fn>;

const SITE = 9750;
const CATHEDRAL = 9751;
const PLAQUE = 9752;
const PLACES = [SITE, CATHEDRAL, PLAQUE];
const CURATOR = '00000000-0000-4000-8000-000000009750';
let curatorId = 0;
const PAIRS = { cathedral: 0, plaque: 0 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merge_proposals WHERE place_a = ANY($1) OR place_b = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function place(id: number, name: string, source: string, lon: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, country_names)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, 54.7745), 4326), ARRAY['United Kingdom']
       FROM experience_sources s WHERE s.name = $5`,
    [id, `fixture-${id}`, name, lon, source],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3`,
    [id, `fixture-${id}`, source],
  );
}

async function propose(a: number, b: number, distance: number, similarity: number, exact: boolean): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO experience_merge_proposals (place_a, place_b, distance_m, name_similarity, exact, reach_m)
     VALUES ($1, $2, $3, $4, $5, 300) RETURNING id`,
    [a, b, distance, similarity, exact],
  );
  return result.rows[0].id;
}

const ask = () => suggestMergeProposals({ params: { id: SITE }, caller: { id: curatorId, role: 'curator' } as Express.User });

const stored = async () => (await pool.query<{
  proposal_id: number | null; place_b: number; judgement: string | null; input_tokens: number; asked: Record<string, unknown>;
}>(
  // By the other place, never by id: one INSERT ... SELECT gives its rows no id order.
  `SELECT s.proposal_id, s.place_b, s.judgement, s.input_tokens, s.asked FROM experience_merge_suggestions s
    WHERE s.place_a = $1 ORDER BY s.place_b, s.id`, [SITE],
)).rows;

const jevSays = (answers: Record<string, { choice: string; confidence: number } | { refused: true }>) => ({
  answers: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, 'refused' in a ? a : { ...a, probabilities: {} }])),
  model: 'jev-1.13.0', inputTokens: 1001,
});

beforeEach(async () => {
  await clear();
  mockedAsk.mockReset();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await place(SITE, 'Durham Castle and Cathedral', 'UNESCO World Heritage Sites', -1.5760);
  await place(CATHEDRAL, 'Durham Cathedral', 'Places of worship', -1.5755);
  await place(PLAQUE, 'Durham Castle and Cathedral', 'Public art', -1.5758);
  PAIRS.cathedral = await propose(SITE, CATHEDRAL, 139, 0.65, false);
  PAIRS.plaque = await propose(SITE, PLAQUE, 20, 1, true);
  mockedAsk.mockResolvedValue(jevSays({
    [`p${PAIRS.cathedral}`]: { choice: 'part_of', confidence: 0.84 },
    [`p${PAIRS.plaque}`]: { choice: 'one', confidence: 0.95 },
  }));
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("Jev's judgement of a place's pairs of near places (#1249)", () => {
  it('asks about every open pair in one call, shares the cost out, and asks nothing the second time', async () => {
    const first = await ask();

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    const [state, questions] = mockedAsk.mock.calls[0];
    expect(state).toEqual({ place: 'Durham Castle and Cathedral', kinds: ['World Heritage Sites'], countries: ['United Kingdom'] });
    expect(Object.keys(questions)).toEqual([`p${PAIRS.cathedral}`, `p${PAIRS.plaque}`]);
    expect(questions[`p${PAIRS.cathedral}`].instructions)
      .toContain('the place "Durham Cathedral" is in Places of worship, in United Kingdom, and has');
    expect(questions[`p${PAIRS.cathedral}`].instructions).toContain('stand 139 m apart');
    expect(questions[`p${PAIRS.plaque}`].instructions).toContain('one and the same name');
    expect(questions[`p${PAIRS.plaque}`].criteria).toEqual(
      expect.objectContaining({ one: expect.any(String), two: expect.any(String), part_of: expect.any(String) }),
    );
    expect(first).toEqual({
      configured: true,
      suggestions: [
        { proposalId: PAIRS.cathedral, judgement: 'part_of', confidence: 0.84 },
        { proposalId: PAIRS.plaque, judgement: 'one', confidence: 0.95 },
      ],
    });
    // 1001 tokens over two questions: 501 for the first asked, 500 for the
    // other. Read by pair: one INSERT ... SELECT gives its rows no id order.
    expect(Object.fromEntries((await stored()).map(row => [row.proposal_id, row.input_tokens])))
      .toEqual({ [PAIRS.cathedral]: 501, [PAIRS.plaque]: 500 });

    const second = await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(second.suggestions).toEqual(first.suggestions);
  });

  it('records an answer it refused with no judgement, shows none, and does not ask about that pair again', async () => {
    mockedAsk.mockResolvedValue(jevSays({
      [`p${PAIRS.cathedral}`]: { refused: true },
      [`p${PAIRS.plaque}`]: { choice: 'one', confidence: 0.95 },
    }));

    const first = await ask();
    expect(first.suggestions.map(s => s.proposalId)).toEqual([PAIRS.plaque]);
    expect((await stored()).find(row => row.proposal_id === PAIRS.cathedral)).toMatchObject({ judgement: null });

    await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  it('asks again about a pair the pass measured anew, and not about the rest', async () => {
    await ask();
    // The next pass found the cathedral 10 m closer.
    await pool.query('UPDATE experience_merge_proposals SET distance_m = 129 WHERE id = $1', [PAIRS.cathedral]);
    mockedAsk.mockResolvedValue(jevSays({ [`p${PAIRS.cathedral}`]: { choice: 'part_of', confidence: 0.88 } }));

    const again = await ask();

    expect(mockedAsk).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockedAsk.mock.calls[1][1])).toEqual([`p${PAIRS.cathedral}`]);
    expect(again.suggestions).toContainEqual({ proposalId: PAIRS.cathedral, judgement: 'part_of', confidence: 0.88 });
    expect(again.suggestions).toContainEqual({ proposalId: PAIRS.plaque, judgement: 'one', confidence: 0.95 });
  });

  it('keeps a paid judgement when a pass drops the pair, and finds it again for the pair proposed anew', async () => {
    await ask();
    // The next pass no longer finds the cathedral within reach: the finder
    // deletes the open proposal, as findMergeProposals does.
    await pool.query('DELETE FROM experience_merge_proposals WHERE id = $1', [PAIRS.cathedral]);
    expect((await stored()).map(row => [row.place_b, row.proposal_id, row.input_tokens])).toEqual([
      [CATHEDRAL, null, 501], [PLAQUE, PAIRS.plaque, 500],
    ]);
    expect(await ask()).toEqual({ configured: true, suggestions: [{ proposalId: PAIRS.plaque, judgement: 'one', confidence: 0.95 }] });
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect((await getJevUsage()).byQuestion.find(q => q.question === 'mergeProposals')).toMatchObject({ calls: 2, inputTokens: 1001 });

    // A later pass proposes the same pair again, with the same measures: the
    // judgement is the pair's, not the row's, so nothing is asked or paid for.
    const again = await propose(SITE, CATHEDRAL, 139, 0.65, false);
    expect((await ask()).suggestions).toContainEqual({ proposalId: again, judgement: 'part_of', confidence: 0.84 });
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  it('records a paid judgement for a pair the pass dropped while the call was in flight, with no proposal', async () => {
    mockedAsk.mockImplementation(async () => {
      // The pass no longer finds the cathedral within reach while Jev is answering.
      await pool.query('DELETE FROM experience_merge_proposals WHERE id = $1', [PAIRS.cathedral]);
      return jevSays({
        [`p${PAIRS.cathedral}`]: { choice: 'part_of', confidence: 0.84 },
        [`p${PAIRS.plaque}`]: { choice: 'one', confidence: 0.95 },
      });
    });
    await ask();
    expect((await stored()).map(row => [row.place_b, row.proposal_id, row.input_tokens])).toEqual([
      [CATHEDRAL, null, 501], [PLAQUE, PAIRS.plaque, 500],
    ]);
    expect((await getJevUsage()).byQuestion.find(q => q.question === 'mergeProposals')).toMatchObject({ calls: 2, inputTokens: 1001 });
    // Proposed anew with the same measures, the pair has its judgement already.
    const again = await propose(SITE, CATHEDRAL, 139, 0.65, false);
    expect((await ask()).suggestions).toContainEqual({ proposalId: again, judgement: 'part_of', confidence: 0.84 });
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  it('records a judgement for the pair as it was asked, so one measured anew while the call was in flight is asked again', async () => {
    mockedAsk.mockImplementation(async () => {
      // The pass refreshes the cathedral's distance while Jev is answering.
      await pool.query('UPDATE experience_merge_proposals SET distance_m = 129 WHERE id = $1', [PAIRS.cathedral]);
      return jevSays({
        [`p${PAIRS.cathedral}`]: { choice: 'part_of', confidence: 0.84 },
        [`p${PAIRS.plaque}`]: { choice: 'one', confidence: 0.95 },
      });
    });
    const first = await ask();
    // The answer is shown once, as the answer to the question that was asked.
    expect(first.suggestions).toHaveLength(2);
    expect((await stored()).find(row => row.place_b === CATHEDRAL)?.asked).toMatchObject({ distanceM: 139 });

    mockedAsk.mockResolvedValue(jevSays({ [`p${PAIRS.cathedral}`]: { choice: 'part_of', confidence: 0.88 } }));
    const again = await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockedAsk.mock.calls[1][1])).toEqual([`p${PAIRS.cathedral}`]);
    expect(again.suggestions).toContainEqual({ proposalId: PAIRS.cathedral, judgement: 'part_of', confidence: 0.88 });
  });

  it('leaves the pairs without a judgement when the call fails, and asks again next time', async () => {
    mockedAsk.mockRejectedValueOnce(new Error('Jev answered 503'));
    expect((await ask()).suggestions).toEqual([]);
    expect(await stored()).toEqual([]);

    const again = await ask();
    expect(mockedAsk).toHaveBeenCalledTimes(2);
    expect(again.suggestions).toHaveLength(2);
  });

  it("counts what it cost and whether the curators' answers took what it suggested", async () => {
    await ask();
    // The cathedral recorded as the part, as Jev said; the plaque kept as two
    // places against Jev's word.
    await answerMergeProposalsOneByOne(SITE, curatorId, null, [
      { proposalId: PAIRS.cathedral, answer: 'part_of', partId: CATHEDRAL },
      { proposalId: PAIRS.plaque, answer: 'two' },
    ], [1, 3, 4]);

    const usage = await getJevUsage();
    const pairs = usage.byQuestion.find(q => q.question === 'mergeProposals')!;
    expect(pairs).toMatchObject({ calls: 2, inputTokens: 1001, compared: 2, agreed: 1 });
    expect(usage.calls).toBeGreaterThanOrEqual(2);
    expect(usage.usd).toBeCloseTo(usage.inputTokens * 0.042 / 1_000_000, 6);
  });
});

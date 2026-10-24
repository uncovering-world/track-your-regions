import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Jev's reading of an arriving place (#1768), against PostgreSQL, with Jev and
 * Wikipedia stood in for: the Lupanar of Pompeii (Q157747) arriving in
 * Archaeology, read as a part of a larger place. Asked once for the place as
 * it stands, again once it is renamed; only while it is arriving; and what the
 * curator then answered is compared with it.
 */

vi.mock('../../services/jev/jevClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/jev/jevClient.js')>()),
  jevConfigured: () => true,
  askJevChoice: vi.fn(),
}));
vi.mock('../../services/sync/visit/visitReading.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/visit/visitReading.js')>()),
  articleLead: vi.fn(async () => 'The Lupanar of Pompeii is a ruined building in the Roman city of Pompeii.'),
}));
// The curator is in scope for every source; which source is asked about is
// what the scope tests below pin.
vi.mock('./experienceScope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./experienceScope.js')>()),
  resolveExperienceScope: vi.fn(async () => ({ permitted: true, logRegionId: null })),
}));

import { pool } from '../../db/index.js';
import { askJevChoice, JevAnswerRefused } from '../../services/jev/jevClient.js';
import { getJevUsage } from '../admin/jevUsageController.js';
import { articleLead } from '../../services/sync/visit/visitReading.js';
import { resolveExperienceScope } from './experienceScope.js';
import { refuseArrivalUnderLock } from './curatorRefusalController.js';
import { suggestVisit } from './visitSuggestionController.js';

const mockedAsk = askJevChoice as unknown as ReturnType<typeof vi.fn>;
const mockedLead = articleLead as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;

const LUPANAR = 9768;
const CURATOR = '00000000-0000-4000-8000-000000009768';
let curatorId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [LUPANAR]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [LUPANAR]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

const ask = () => suggestVisit({ params: { id: LUPANAR }, caller: { id: curatorId, role: 'curator' } as Express.User });
const answered = (reading: string, confidence: number) => ({
  choice: reading, probabilities: {}, confidence, model: 'jev-1.13.0', inputTokens: 812,
});

beforeEach(async () => {
  await clear();
  mockedAsk.mockReset();
  mockedAsk.mockResolvedValue(answered('part', 0.75));
  mockedLead.mockClear();
  mockedScope.mockClear();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, country_names, metadata)
     SELECT $1, s.id, 'Q157747', 'Lupanar', ST_SetSRID(ST_MakePoint(14.48733, 40.74950), 4326), ARRAY['Italy'],
            jsonb_build_object('wikipediaUrl', 'https://en.wikipedia.org/wiki/Lupanar_(Pompeii)',
                               'osm', jsonb_build_object('tag', 'historic=archaeological_site'))
       FROM experience_sources s WHERE s.name = 'Archaeology'`,
    [LUPANAR],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state)
     SELECT $1, s.kind_id, s.id, 'Q157747', 'pending' FROM experience_sources s WHERE s.name = 'Archaeology'`,
    [LUPANAR],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("Jev's reading of an arriving place (#1768)", () => {
  it('reads the place with its kinds, its tag and its article lead, and records the lead', async () => {
    expect(await ask()).toEqual({ configured: true, suggestion: { reading: 'part', confidence: 0.75 } });

    expect(mockedAsk.mock.calls[0][0].state).toEqual({
      name: 'Lupanar', countries: ['Italy'], kinds: ['Archaeology'], openstreetmap_tag: 'historic=archaeological_site',
      wikipedia_lead: 'The Lupanar of Pompeii is a ruined building in the Roman city of Pompeii.',
    });
    const stored = await pool.query<{ reading: string; article_lead: string; input_tokens: number }>(
      'SELECT reading, article_lead, input_tokens FROM experience_visit_suggestions WHERE experience_id = $1', [LUPANAR],
    );
    expect(stored.rows).toEqual([{
      reading: 'part', input_tokens: 812,
      article_lead: 'The Lupanar of Pompeii is a ruined building in the Roman city of Pompeii.',
    }]);
  });

  it('asks once for the place as it stands, and again once it is renamed', async () => {
    await ask();
    expect(await ask()).toEqual({ configured: true, suggestion: { reading: 'part', confidence: 0.75 } });
    expect(mockedAsk).toHaveBeenCalledTimes(1);

    await pool.query(`UPDATE experiences SET name = 'Lupanar of Pompeii' WHERE id = $1`, [LUPANAR]);
    await ask();

    expect(mockedAsk).toHaveBeenCalledTimes(2);
  });

  it('shows no answer about a place renamed while Jev was answering, and still counts the call', async () => {
    mockedAsk.mockImplementation(async () => {
      await pool.query(`UPDATE experiences SET name = 'Lupanar of Pompeii' WHERE id = $1`, [LUPANAR]);
      return answered('part', 0.75);
    });

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    const stored = await pool.query('SELECT 1 FROM experience_visit_suggestions WHERE experience_id = $1', [LUPANAR]);
    expect(stored.rowCount).toBe(1);
  });

  it('shows no answer about a place a curator answered while Jev was reading it', async () => {
    mockedAsk.mockImplementation(async () => {
      await pool.query(
        `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1`,
        [LUPANAR],
      );
      return answered('part', 0.75);
    });

    expect(await ask()).toEqual({ configured: true, suggestion: null });
  });

  it('asks nothing of a place that is not arriving', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1`,
      [LUPANAR],
    );

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it('asks nothing of a place on the World Heritage list, and records nothing (#1926)', async () => {
    // The place is also a World Heritage site, as the Pont du Gard is.
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'whs-9768-fixture', 'verified', NOW() FROM experience_sources s WHERE s.id = 1`,
      [LUPANAR],
    );

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    expect(mockedAsk).not.toHaveBeenCalled();
    const stored = await pool.query('SELECT 1 FROM experience_visit_suggestions WHERE experience_id = $1', [LUPANAR]);
    expect(stored.rowCount).toBe(0);
  });

  it('shows no reading stored before the place was known as World Heritage (#1926)', async () => {
    // A reading recorded for the place as it stands...
    expect((await ask()).suggestion).toEqual({ reading: 'part', confidence: 0.75 });
    mockedAsk.mockClear();
    // ...then a World Heritage membership the place is not admitted to, which
    // leaves what the reading was recorded for as it was: the stored reading
    // would be served, were the list not read first.
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, admission)
       SELECT $1, s.kind_id, s.id, 'whs-9768-fixture', 'pending', 'refused' FROM experience_sources s WHERE s.id = 1`,
      [LUPANAR],
    );

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it("is asked in the arriving source's scope, not in the scope of the place's other kinds", async () => {
    // The place is also an art museum the curator does not look after.
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q157747', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [LUPANAR],
    );

    expect((await ask()).suggestion).toEqual({ reading: 'part', confidence: 0.75 });
    const archaeology = await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Archaeology'`);
    expect(mockedScope.mock.calls.map(call => call[3])).toEqual([archaeology.rows[0].id]);

    mockedScope.mockResolvedValueOnce({ permitted: false, logRegionId: null });
    await expect(ask()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('asks nothing and records nothing while the article lead cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedLead.mockRejectedValueOnce(new Error('[Wikipedia] the lead of Lupanar (Pompeii) could not be read: 429'));

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    expect(mockedAsk).not.toHaveBeenCalled();
    const stored = await pool.query('SELECT 1 FROM experience_visit_suggestions WHERE experience_id = $1', [LUPANAR]);
    expect(stored.rowCount).toBe(0);

    // The next opening reads it and asks.
    expect((await ask()).suggestion).toEqual({ reading: 'part', confidence: 0.75 });
  });

  it('records an answer it refused with what it cost, and does not pay for the same place again', async () => {
    mockedAsk.mockRejectedValue(new JevAnswerRefused('jev-1.13.0', 805));

    expect(await ask()).toEqual({ configured: true, suggestion: null });
    expect(await ask()).toEqual({ configured: true, suggestion: null });

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    const stored = await pool.query<{ input_tokens: number; reading: string | null }>(
      'SELECT input_tokens, reading FROM experience_visit_suggestions WHERE experience_id = $1', [LUPANAR],
    );
    expect(stored.rows).toEqual([{ input_tokens: 805, reading: null }]);
  });

  it('counts what it cost and whether the curator answered as it read', async () => {
    mockedAsk.mockResolvedValue(answered('nothing', 0.9));
    const before = await getJevUsage();
    await ask();
    await refuseArrivalUnderLock(LUPANAR, curatorId, null, {});

    const after = await getJevUsage();
    const visits = (usage: typeof after) => usage.byQuestion.find(one => one.question === 'visits')!;

    expect(visits(after).calls - visits(before).calls).toBe(1);
    expect(visits(after).inputTokens - visits(before).inputTokens).toBe(812);
    expect(visits(after).compared - visits(before).compared).toBe(1);
    expect(visits(after).agreed - visits(before).agreed).toBe(1);
  });

  it("counts the arrival's own publication, not an earlier one of the place's other kind", async () => {
    mockedAsk.mockResolvedValue(answered('visit', 0.95));
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q157747', 'auto', NOW() - INTERVAL '1 day'
         FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [LUPANAR],
    );
    const before = await getJevUsage();
    const visits = (usage: typeof before) => usage.byQuestion.find(one => one.question === 'visits')!;
    await ask();

    expect(visits(await getJevUsage()).compared - visits(before).compared).toBe(0);

    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND curation_state = 'pending'`,
      [LUPANAR],
    );
    const after = await getJevUsage();

    expect(visits(after).compared - visits(before).compared).toBe(1);
    expect(visits(after).agreed - visits(before).agreed).toBe(1);
  });

  it('compares a reading of a part with no answer', async () => {
    const before = await getJevUsage();
    await ask();
    await refuseArrivalUnderLock(LUPANAR, curatorId, null, {});

    const after = await getJevUsage();
    const visits = (usage: typeof after) => usage.byQuestion.find(one => one.question === 'visits')!;

    expect(visits(after).compared - visits(before).compared).toBe(0);
  });
});

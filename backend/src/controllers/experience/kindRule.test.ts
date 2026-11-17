import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceEvidenceRoutes } from '../../routes/experienceEvidenceRoutes.js';
import { WORLD_FRAME } from '../../services/sync/places/admissionRegister.js';

const query = vi.mocked(pool.query);
const CURATOR = { id: 7, role: 'curator' } as Express.User;
const route = routeAt(experienceEvidenceRoutes, '/review/kind-rule/:kindId');

/** The answer on the declared route, the id as the wire sends it: its status and its body. */
async function read(kindId: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await answer(route, { params: { kindId }, user: CURATOR }, res);
  return { status: res.status.mock.calls.at(-1)?.[0] ?? 200, body: res.json.mock.calls.at(-1)?.[0] };
}

/** Towers' bars as its run of 2026-11-16 read them on dev. */
const TOWERS_BARS = { pool: 3103, year: '2025-11 to 2026-10', readers: 65076, editions: 19, guidedReaders: 12863 };

function kindRow(row: object | null) {
  query.mockReset();
  query.mockResolvedValueOnce({ rowCount: row ? 1 : 0, rows: row ? [row] : [] } as never);
}

beforeEach(() => {
  query.mockReset();
});

describe("a kind's rule, read from its code and its last run (#2185)", () => {
  it("gives a declared kind's refusals in its own words and the bars its last run read", async () => {
    kindRow({ source_ids: [7], world_bars: TOWERS_BARS });
    const { status, body } = await read('7');

    expect(status).toBe(200);
    const reasons = body.keptOut.map((k: { reason: string }) => k.reason);
    expect(body.keptOut).toContainEqual({ reason: 'a lighthouse, not a tower', unless: null, unlessTypes: [] });
    expect(reasons).toContain('destroyed or demolished');
    expect(reasons).not.toContain('no tower class');
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(body.world).toEqual({
      pool: 3103, editions: 19, editionsQuantile: WORLD_FRAME.editionsQuantile,
      readers: 65076, readersQuantile: WORLD_FRAME.readersQuantile,
      guidedReaders: 12863, guidedQuantile: WORLD_FRAME.guidedQuantile,
      year: '2025-11 to 2026-10', stayShare: WORLD_FRAME.stayShare, marks: ['wikivoyage', 'atlasObscura'],
    });
    expect(body.surroundings).toEqual({
      radiusKm: 150, best: 10, minLanguages: 2, minReaders: 3000,
      guideShare: 0.25, guideGroupFloor: 5, editionsShare: 1, editionsGroupFloor: 25, readersShare: 1.5, readersGroupFloor: 25,
      guideOnlyTypes: [], heritageTypes: [], venues: null, mapped: null,
    });
  });

  it('says when a refusal an exception lifts does not hold: a skyscraper an observation-tower class names is a tower', async () => {
    kindRow({ source_ids: [7], world_bars: TOWERS_BARS });
    const { body } = await read('7');
    expect(body.keptOut).toContainEqual({ reason: 'a skyscraper, not a tower', unless: 'types', unlessTypes: ['observation-tower'] });
    expect(body.keptOut).toContainEqual({ reason: 'a sea fort, not a tower', unless: 'anotherClass', unlessTypes: [] });
    expect(body.keptOut).toContainEqual({ reason: 'an archaeological site, not a tower', unless: 'anyType', unlessTypes: [] });
  });

  it("says a canal is kept out only where no class of the kind names it, as a flight of locks Wikidata files under canal is a flight", async () => {
    kindRow({ source_ids: [8], world_bars: TOWERS_BARS });
    const { body } = await read('8');
    expect(body.keptOut).toContainEqual(expect.objectContaining({ reason: expect.stringMatching(/^a canal/), unless: 'ownClass' }));
  });

  it("names Bridges' types that need a guide nearby, Squares' venue test and Archaeology's map and listing", async () => {
    kindRow({ source_ids: [8], world_bars: TOWERS_BARS });
    expect((await read('8')).body.surroundings).toMatchObject({
      guideOnlyTypes: ['tunnel', 'dam', 'lock', 'bridge'], heritageTypes: ['bridge'], venues: null, mapped: null,
    });
    kindRow({ source_ids: [9], world_bars: TOWERS_BARS });
    expect((await read('9')).body.surroundings).toMatchObject({ guideOnlyTypes: [], venues: { radiusM: 200, share: 0.5, groupFloor: 25 } });
    kindRow({ source_ids: [5], world_bars: TOWERS_BARS });
    const archaeology = (await read('5')).body;
    expect(archaeology.surroundings).toMatchObject({ mapped: { listedStands: true, namedRuinWithinM: 2000 }, venues: null });
    expect(archaeology.world.marks).toEqual(['wikivoyage', 'atlasObscura', 'worldHeritageList']);
  });

  it('reads the bars of the last real, closed run of the kind, as the coverage report does', async () => {
    kindRow({ source_ids: [7], world_bars: TOWERS_BARS });
    await read('7');
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('NOT l.is_dry_run');
    expect(sql).toContain("l.status IN ('success', 'partial')");
    expect(sql).toContain('ORDER BY l.id DESC LIMIT 1');
    expect(params).toEqual([7]);
  });

  it("names no refusals for a kind whose rule is code of its own, and keeps its bars", async () => {
    kindRow({ source_ids: [4], world_bars: { pool: 56990, editions: 16, readers: null, guidedReaders: null } });
    const { body } = await read('4');
    expect(body.keptOut).toBeNull();
    expect(body.world).toMatchObject({ editions: 16, readers: null, guidedReaders: null, year: null });
  });

  it('answers no lines for a kind no run admitted by fame', async () => {
    kindRow({ source_ids: [2], world_bars: null });
    expect((await read('2')).body).toEqual({ keptOut: null, world: null, surroundings: null });
  });

  it('answers 404 for a kind that does not exist', async () => {
    kindRow(null);
    expect((await read('99')).status).toBe(404);
  });
});

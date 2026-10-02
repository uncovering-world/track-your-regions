/**
 * The load replaces four tables a report may be reading, so what it must never
 * do is the point: never empty them when the register and the catalogue's kinds
 * disagree, never leave them half filled, never spread the statements over
 * connections. Which rows land is asked of a real database in `load.db.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(async () => undefined),
}));

import { pool, rollbackQuietly } from '../../db/index.js';
import type { CoverageFiles } from './files.js';
import { CoverageRegisterMismatch, replaceCoverage } from './load.js';

const mockedPoolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedRollback = rollbackQuietly as unknown as ReturnType<typeof vi.fn>;

const CATALOGUE_KINDS = [{ id: 1, name: 'World Heritage Sites' }, { id: 5, name: 'Archaeology' }];

const kind = (over: Partial<CoverageFiles['kinds'][number]>): CoverageFiles['kinds'][number] => ({
  slug: 'markets', name: 'Markets', form: 'place', definition: 'A market.', status: 'proposed',
  experience_kind_id: null, issue: null, vision: null, in_venue: false, ...over,
});

const FILES: CoverageFiles = {
  kinds: [
    kind({ slug: 'world-heritage', name: 'World Heritage Sites', status: 'live', experience_kind_id: 1 }),
    kind({ slug: 'archaeology', name: 'Archaeology', status: 'live', experience_kind_id: 5 }),
    kind({}),
  ],
  regions: [{ slug: 'cusco-region', name: 'Cusco region', country: 'Peru', lat: -13.532, lon: -71.967, radius_km: 110, surveyed: '2026-10-01' }],
  expectations: new Map([['cusco-region', [
    {
      slug: 'moray', name: 'Moray', aliases: ['Muray'], type: 'place', kinds: ['archaeology'], wikidata: 'Q1814201', same_as: [],
      unesco: null, venue: null, sources: 4, sitelinks: 18, lat: -13.33, lon: -72.197, note: '',
    },
    {
      slug: 'cuy', name: 'Cuy', aliases: [], type: 'food', kinds: [], wikidata: null, same_as: [],
      unesco: null, venue: null, sources: 3, sitelinks: null, lat: null, lon: null, note: '',
    },
  ]]]),
};

function makeClient(failOn?: RegExp) {
  const client = { query: vi.fn(), release: vi.fn() };
  client.query.mockImplementation(async (sql: string) => {
    if (failOn?.test(sql)) throw new Error('the database said no');
    if (/FROM experience_kinds/.test(sql)) return { rows: CATALOGUE_KINDS };
    return { rows: [] };
  });
  mockedConnect.mockResolvedValue(client);
  return client;
}

const statements = (client: { query: ReturnType<typeof vi.fn> }) =>
  (client.query.mock.calls as [string, unknown[]?][]).map(([sql]) => sql.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  mockedPoolQuery.mockReset();
  mockedConnect.mockReset();
  mockedRollback.mockReset().mockResolvedValue(undefined);
});

describe('replaceCoverage', () => {
  it('empties children before parents and fills parents before children, inside one transaction on one client', async () => {
    const client = makeClient();

    const summary = await replaceCoverage(FILES);

    const order = statements(client).map(sql => sql.split(' (')[0].split(' SELECT')[0]);
    expect(order).toEqual([
      'BEGIN',
      'SELECT id, name FROM experience_kinds ORDER BY id',
      'DELETE FROM coverage_expectation_kinds',
      'DELETE FROM coverage_expectations',
      'DELETE FROM coverage_regions',
      'DELETE FROM coverage_kinds',
      'INSERT INTO coverage_kinds',
      'INSERT INTO coverage_regions',
      'INSERT INTO coverage_expectations',
      'INSERT INTO coverage_expectation_kinds',
      'COMMIT',
    ]);
    expect(mockedPoolQuery, 'nothing goes through the pool: a pooled BEGIN pins nothing').not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(summary).toEqual({ kinds: 3, regions: 1, expectations: 2, filings: 1 });
  });

  it('sends each table its own columns, a point as text and no point as null', async () => {
    const client = makeClient();

    await replaceCoverage(FILES);

    const sent = (table: string) => {
      // The space after the name tells coverage_expectations from coverage_expectation_kinds.
      const insert = `INSERT INTO ${table} `;
      const call = (client.query.mock.calls as [string, string[]?][]).find(([sql]) => sql.replace(/\s+/g, ' ').includes(insert));
      return JSON.parse(call?.[1]?.[0] ?? '[]') as Record<string, unknown>[];
    };
    expect(sent('coverage_kinds')[1]).toMatchObject({ slug: 'archaeology', experience_kind_id: 5, issue_number: null, vision_heading: null, in_venue: false });
    expect(sent('coverage_regions')[0]).toMatchObject({ slug: 'cusco-region', centre: 'POINT(-71.967 -13.532)', surveyed: '2026-10-01' });
    const [moray, cuy] = sent('coverage_expectations');
    expect(moray).toMatchObject({
      region_slug: 'cusco-region', wikidata_id: 'Q1814201', source_count: 4, aliases: ['Muray'], location: 'POINT(-72.197 -13.33)',
    });
    expect(cuy).toMatchObject({ wikidata_id: null, location: null });
    expect(sent('coverage_expectation_kinds')).toEqual([{ region_slug: 'cusco-region', expectation_slug: 'moray', kind_slug: 'archaeology' }]);
  });

  it('deletes nothing when a catalogue kind has no live record', async () => {
    const client = makeClient();
    const files = { ...FILES, kinds: FILES.kinds.filter(k => k.slug !== 'archaeology') };

    await expect(replaceCoverage(files)).rejects.toThrow(CoverageRegisterMismatch);
    await expect(replaceCoverage(files)).rejects.toThrow('the catalogue kind Archaeology (experience_kinds 5) has no live record in kinds.jsonl');

    expect(statements(client).some(sql => sql.startsWith('DELETE'))).toBe(false);
    expect(mockedRollback).toHaveBeenCalledWith(client);
  });

  it('refuses a live record whose name is not the catalogue\'s, and one naming a kind the catalogue lacks', async () => {
    makeClient();
    const renamed = { ...FILES, kinds: [FILES.kinds[0], kind({ slug: 'archaeology', name: 'Digs', status: 'live', experience_kind_id: 5 })] };
    await expect(replaceCoverage(renamed)).rejects.toThrow('archaeology is named Digs and experience_kinds 5 is named Archaeology');

    const extra = { ...FILES, kinds: [...FILES.kinds, kind({ slug: 'history-museums', name: 'History museums', status: 'live', experience_kind_id: 6 })] };
    await expect(replaceCoverage(extra)).rejects.toThrow('history-museums names experience_kinds 6, which the catalogue does not have');
  });

  it('rolls back and releases the client when a statement fails, and hands on the error', async () => {
    const client = makeClient(/INSERT INTO coverage_expectations\s/);

    await expect(replaceCoverage(FILES)).rejects.toThrow('the database said no');

    expect(statements(client)).not.toContain('COMMIT');
    expect(mockedRollback).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('destroys a client whose rollback also failed', async () => {
    const client = makeClient(/INSERT INTO coverage_regions/);
    const broken = new Error('connection lost');
    mockedRollback.mockResolvedValue(broken);

    await expect(replaceCoverage(FILES)).rejects.toThrow('the database said no');

    expect(client.release).toHaveBeenCalledWith(broken);
  });
});

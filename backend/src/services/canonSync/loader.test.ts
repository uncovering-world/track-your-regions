import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { pool } from '../../db/index.js';
import { diffCanon, fingerprintCountry, loadCanon } from './loader.js';
import type { CanonDraft, CountryDraft } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function country(over: Partial<CountryDraft>): CountryDraft {
  return {
    slug: 'fr', name: 'France', class: 'un_member', iso2: 'FR', iso3: 'FRA', m49: 250,
    sovereignSlug: null, wikidataQid: 'Q142', provenance: [], ...over,
  };
}
function draft(countries: CountryDraft[]): CanonDraft {
  return { countries, disputes: [], presets: [], warnings: [] };
}

describe('diffCanon', () => {
  it('reports added, removed and changed slugs', () => {
    const prev = [
      { slug: 'fr', fingerprint: fingerprintCountry(country({})) },
      { slug: 'xx', fingerprint: 'stale' },
    ];
    const d = draft([country({}), country({ slug: 'de', name: 'Germany', iso2: 'DE', iso3: 'DEU' })]);
    expect(diffCanon(prev, d)).toEqual({ added: ['de'], removed: ['xx'], changed: [] });
  });

  it('detects field changes via fingerprint', () => {
    const prev = [{ slug: 'fr', fingerprint: fingerprintCountry(country({})) }];
    const d = draft([country({ class: 'territory' })]);
    expect(diffCanon(prev, d).changed).toEqual(['fr']);
  });
});

describe('loadCanon', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    // Default: every query returns a row with an id (covers all RETURNING id upserts)
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    // First call is fetchPrevState's SELECT — empty previous canon
    mockedQuery.mockResolvedValueOnce({ rows: [] });
  });

  it('upserts countries by slug and refreshes the canon map', async () => {
    await loadCanon(draft([country({})]), new Map(), new Map(), { wikidata: 'now' });
    const sqls = mockedQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO countries/.test(s) && /ON CONFLICT \(slug\)/.test(s))).toBe(true);
    expect(sqls.some((s) => /REFRESH MATERIALIZED VIEW division_canon_map/.test(s))).toBe(true);
  });

  it('replaces coverage and dispute members instead of appending', async () => {
    await loadCanon(draft([country({})]), new Map([[1, 'fr']]), new Map(), {});
    const sqls = mockedQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /DELETE FROM country_divisions/.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM disputed_territory_members/.test(s))).toBe(true);
  });
});

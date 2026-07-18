import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { pool } from '../../db/index.js';
import { diffCanon, fingerprintCountry, loadCanon } from './loader.js';
import type { CanonDraft, CountryDraft, DisputeDraft, PresetDraft } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

function country(over: Partial<CountryDraft>): CountryDraft {
  return {
    slug: 'fr', name: 'France', class: 'un_member', iso2: 'FR', iso3: 'FRA', m49: 250,
    sovereignSlug: null, wikidataQid: 'Q142', provenance: [], ...over,
  };
}
function dispute(over: Partial<DisputeDraft> = {}): DisputeDraft {
  return {
    slug: 'kashmir', name: 'Kashmir', kind: 'attribution', subjectCountrySlug: null,
    claims: [{ countrySlug: 'fr', role: 'controls', note: null }],
    neFeature: { name: 'Kashmir', note: null, sovIso3: null, type: 'Disputed', wikidataQid: null, geometry: null },
    wikidataQid: null, provenance: [], ...over,
  };
}
function preset(over: Partial<PresetDraft> = {}): PresetDraft {
  return {
    slug: 'un-de-jure', name: 'UN de jure', isDefault: true,
    choices: [{ disputeSlug: 'kashmir', countsAs: 'country', countrySlug: 'fr', provenance: { source: 'x', version: '1', rule: 'r' } }],
    ...over,
  };
}
function draft(countries: CountryDraft[], over: Partial<Omit<CanonDraft, 'countries'>> = {}): CanonDraft {
  return { countries, disputes: [], presets: [], warnings: [], ...over };
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

// Default routing for the mocked client: distinguishes the handful of SELECT
// shapes loadCanon issues by SQL substring so every test starts from a sane
// "nothing stale, everything upserts to id 1" baseline. Tests override
// specific branches (or the whole implementation) for their own scenario.
function defaultQueryImpl(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
  if (/LEFT JOIN countries s ON s\.id = c\.sovereign_id/.test(sql)) {
    return Promise.resolve({ rows: [] }); // fetchPrevState: empty previous canon
  }
  if (/LEFT JOIN user_disputed_preferences/.test(sql)) {
    return Promise.resolve({ rows: [] }); // no stale rows referenced by prefs
  }
  return Promise.resolve({ rows: [{ id: 1 }] }); // RETURNING id upserts + id lookups
}

describe('loadCanon', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockedQuery.mockReset();
    mockClient = { query: vi.fn(), release: vi.fn() };
    mockClient.query.mockImplementation(defaultQueryImpl);
    mockedConnect.mockReset();
    mockedConnect.mockResolvedValue(mockClient);
  });

  it('upserts countries by slug and refreshes the canon map', async () => {
    await loadCanon(draft([country({})]), new Map(), new Map(), { wikidata: 'now' });
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO countries/.test(s) && /ON CONFLICT \(slug\)/.test(s))).toBe(true);
    expect(sqls.some((s) => /REFRESH MATERIALIZED VIEW division_canon_map/.test(s))).toBe(true);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
  });

  it('replaces coverage and dispute members instead of appending', async () => {
    await loadCanon(draft([country({})]), new Map([[1, 'fr']]), new Map(), {});
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /DELETE FROM country_divisions/.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM disputed_territory_members/.test(s))).toBe(true);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
  });

  it('inserts dispute claims/members and preset choices', async () => {
    const disputeUnits = new Map([['kashmir', { divisionIds: [101, 102], approximate: false }]]);
    const d = draft([country({})], { disputes: [dispute()], presets: [preset()] });
    await loadCanon(d, new Map(), disputeUnits, {});
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO disputed_territories/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO disputed_territory_claims/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO disputed_territory_members/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO disputed_presets/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO disputed_preset_choices/.test(s))).toBe(true);
  });

  it('retains a stale dispute referenced by user preferences and warns instead of deleting', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (/LEFT JOIN user_disputed_preferences udp ON udp\.dispute_id/.test(sql)) {
        return Promise.resolve({ rows: [{ slug: 'old-dispute', id: 42, pref_count: '2' }] });
      }
      return defaultQueryImpl(sql);
    });
    const report = await loadCanon(draft([country({})]), new Map(), new Map(), {});
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /DELETE FROM disputed_territories WHERE id/.test(s))).toBe(false);
    expect(report.warnings.some((w) => /retained/.test(w) && /old-dispute/.test(w))).toBe(true);
  });

  it('refuses to load an empty canon before mutating anything', async () => {
    await expect(loadCanon(draft([]), new Map(), new Map(), {}))
      .rejects.toThrow('refusing to load an empty canon (no countries derived)');
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT/i.test(s))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back the transaction when a query fails mid-pipeline', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (/DELETE FROM country_divisions/.test(sql)) {
        return Promise.reject(new Error('boom'));
      }
      return defaultQueryImpl(sql);
    });
    await expect(loadCanon(draft([country({})]), new Map([[1, 'fr']]), new Map(), {}))
      .rejects.toThrow('boom');
    const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

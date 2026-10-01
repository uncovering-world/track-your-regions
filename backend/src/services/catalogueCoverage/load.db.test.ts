import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import type { CoverageFiles } from './files.js';
import { CoverageRegisterMismatch, replaceCoverage } from './load.js';

/**
 * The load replaces the catalogue-coverage tables whole, executed against
 * PostgreSQL: a second load leaves nothing of the first, and a load the
 * database refuses leaves the previous content exactly as it was.
 *
 * These four tables have one writer and no other owner of rows, so this spec
 * and the report's empty them rather than delete rows of their own; the lane
 * runs its files one after another.
 */

const SLUGS: Record<number, string> = {
  1: 'world-heritage', 2: 'art-museums', 3: 'public-art', 4: 'places-of-worship', 5: 'archaeology',
};

/** A live record for every kind the catalogue has, under the catalogue's own names. */
async function liveKinds(): Promise<CoverageFiles['kinds']> {
  const { rows } = await pool.query<{ id: number; name: string }>('SELECT id, name FROM experience_kinds ORDER BY id');
  return rows.map(row => ({
    slug: SLUGS[row.id] ?? `kind-${row.id}`, name: row.name, form: 'place', definition: `${row.name}.`, status: 'live',
    experience_kind_id: row.id, issue: null, vision: null,
  }));
}

const MARKETS: CoverageFiles['kinds'][number] = {
  slug: 'markets', name: 'Markets', form: 'place', definition: 'A market.', status: 'proposed', experience_kind_id: null, issue: 1163, vision: 'Markets',
};

const entry = (slug: string, kinds: string[]): CoverageFiles['expectations'] extends Map<string, (infer E)[]> ? E : never => ({
  slug, name: slug, aliases: ['also'], type: 'place', kinds, wikidata: null, same_as: [], unesco: null, venue: null,
  sources: 3, sitelinks: 18, lat: -13.33, lon: -72.197, note: '',
});

async function files(regionSlug: string, slugs: string[], filedUnder = 'markets'): Promise<CoverageFiles> {
  return {
    kinds: [...await liveKinds(), MARKETS],
    regions: [{ slug: regionSlug, name: regionSlug, country: 'Peru', lat: -13.532, lon: -71.967, radius_km: 110, surveyed: '2026-10-01' }],
    expectations: new Map([[regionSlug, slugs.map(slug => entry(slug, [filedUnder]))]]),
  };
}

async function empty(): Promise<void> {
  await pool.query('DELETE FROM coverage_expectation_kinds');
  await pool.query('DELETE FROM coverage_expectations');
  await pool.query('DELETE FROM coverage_regions');
  await pool.query('DELETE FROM coverage_kinds');
}

const loaded = async () => (await pool.query<{ region_slug: string; slug: string }>(
  'SELECT region_slug, slug FROM coverage_expectations ORDER BY region_slug, slug',
)).rows.map(row => `${row.region_slug}/${row.slug}`);

beforeEach(empty);

afterAll(async () => {
  await empty();
  await pool.end();
});

describe('replacing the catalogue-coverage tables', () => {
  it('writes what the files say: the point, the list of other names, the kinds an entry is filed under', async () => {
    await replaceCoverage(await files('first-region', ['moray']));

    const row = await pool.query<{ lon: number; lat: number; aliases: string[]; source_count: number; surveyed: string; issue_number: number }>(
      `SELECT ST_X(x.location) AS lon, ST_Y(x.location) AS lat, x.aliases, x.source_count,
              to_char(r.surveyed, 'YYYY-MM-DD') AS surveyed, k.issue_number
         FROM coverage_expectations x
         JOIN coverage_regions r ON r.slug = x.region_slug
         JOIN coverage_expectation_kinds xk ON xk.region_slug = x.region_slug AND xk.expectation_slug = x.slug
         JOIN coverage_kinds k ON k.slug = xk.kind_slug`,
    );
    expect(row.rows).toEqual([{ lon: -72.197, lat: -13.33, aliases: ['also'], source_count: 3, surveyed: '2026-10-01', issue_number: 1163 }]);
  });

  it('leaves nothing of the load before', async () => {
    await replaceCoverage(await files('first-region', ['moray', 'tipon']));
    await replaceCoverage(await files('second-region', ['bondi']));

    expect(await loaded()).toEqual(['second-region/bondi']);
    const regions = await pool.query<{ slug: string }>('SELECT slug FROM coverage_regions');
    expect(regions.rows).toEqual([{ slug: 'second-region' }]);
  });

  it('leaves the load before standing when the database refuses the new one', async () => {
    await replaceCoverage(await files('first-region', ['moray']));

    // The files' reader would have refused this; the load is handed it directly,
    // so the foreign key is what says no, after the tables were emptied.
    await expect(replaceCoverage(await files('second-region', ['bondi'], 'a-kind-nobody-registered'))).rejects.toThrow();

    expect(await loaded()).toEqual(['first-region/moray']);
  });

  it('leaves the load before standing when the register and the catalogue disagree', async () => {
    await replaceCoverage(await files('first-region', ['moray']));
    const withoutLiveKinds = { ...await files('second-region', ['bondi']), kinds: [MARKETS] };

    await expect(replaceCoverage(withoutLiveKinds)).rejects.toThrow(CoverageRegisterMismatch);

    expect(await loaded()).toEqual(['first-region/moray']);
  });
});

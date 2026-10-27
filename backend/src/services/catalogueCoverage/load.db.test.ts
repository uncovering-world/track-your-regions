import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import type { CoverageFiles } from './files.js';
import { CoverageRegisterMismatch, replaceCoverage } from './load.js';

/**
 * The load replaces the catalogue-coverage tables whole, executed against
 * PostgreSQL: a second load leaves nothing of the first, and a load the
 * database refuses leaves the previous content exactly as it was.
 *
 * The coverage tables have one writer and no other owner of rows, so this spec
 * and the report's empty them rather than delete rows of their own; the lane
 * runs its files one after another.
 */

const SLUGS: Record<number, string> = {
  1: 'world-heritage', 2: 'art-museums', 3: 'public-art', 4: 'places-of-worship', 5: 'archaeology',
};

/** A live record for every kind the catalogue has, under the catalogue's own names. */
async function liveKinds(): Promise<CoverageFiles['kinds']> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM experience_kinds WHERE NOT is_virtual ORDER BY id',
  );
  return rows.map(row => ({
    slug: SLUGS[row.id] ?? `kind-${row.id}`, name: row.name, form: 'place', definition: `${row.name}.`, status: 'live',
    experience_kind_id: row.id, issue: null, vision: null, in_venue: false,
  }));
}

const MARKETS: CoverageFiles['kinds'][number] = {
  slug: 'markets', name: 'Markets', form: 'place', definition: 'A market.', status: 'proposed', experience_kind_id: null, issue: 1163, vision: 'Markets', in_venue: false,
};

const NOTABLE_WORKS: CoverageFiles['kinds'][number] = {
  slug: 'notable-works', name: 'Notable works', form: 'work', definition: 'A work.', status: 'live', experience_kind_id: null, issue: null, vision: null, in_venue: true,
};

const entry = (slug: string, kinds: string[]): CoverageFiles['expectations'] extends Map<string, (infer E)[]> ? E : never => ({
  slug, name: slug, aliases: ['also'], type: 'place', kinds, wikidata: null, same_as: [], unesco: null, venue: null,
  sources: 3, sitelinks: 18, lat: -13.33, lon: -72.197, note: '',
});

const judgementOn = (regionSlug: string, slug: string, kind: string): CoverageFiles['judgements'][number] => ({
  region: regionSlug, entry: slug, kind, row: null, cause: 'door-missing', issue: 628, judged: '2026-10-16', note: 'Waits for the regional tier.',
});

/** One kind's calibration list (#1864): the tops named by one reference list. */
const SURVEYS: CoverageFiles['calibrationSources'][number] = { slug: 'coverage-surveys', name: 'The coverage surveys', url: null, read: '2026-10-24', note: '' };
const top = (slug: string, wikidata: string, sources = ['coverage-surveys']): CoverageFiles['calibration'] extends Map<string, (infer E)[]> ? E : never => ({
  slug, name: slug, wikidata, sources, sitelinks: 40, note: '',
});

async function files(regionSlug: string, slugs: string[], filedUnder = 'markets', judged: string[] = []): Promise<CoverageFiles> {
  return {
    kinds: [...await liveKinds(), MARKETS, NOTABLE_WORKS],
    regions: [{ slug: regionSlug, name: regionSlug, country: 'Peru', lat: -13.532, lon: -71.967, radius_km: 110, surveyed: '2026-10-01' }],
    expectations: new Map([[regionSlug, slugs.map(slug => entry(slug, [filedUnder]))]]),
    judgements: judged.map(slug => judgementOn(regionSlug, slug, filedUnder)),
    calibrationSources: [SURVEYS],
    calibration: new Map([['archaeology', [top('machu-picchu', 'Q676203')]]]),
  };
}

async function empty(): Promise<void> {
  await pool.query('DELETE FROM coverage_calibration_entry_sources');
  await pool.query('DELETE FROM coverage_calibration_entries');
  await pool.query('DELETE FROM coverage_calibration_sources');
  await pool.query('DELETE FROM coverage_judgements');
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

  it('copies which kinds exist only inside a place', async () => {
    await replaceCoverage(await files('first-region', ['moray']));

    const flags = await pool.query<{ slug: string; in_venue: boolean }>(
      'SELECT slug, in_venue FROM coverage_kinds WHERE slug = ANY($1) ORDER BY slug',
      [['markets', 'notable-works']],
    );
    expect(flags.rows).toEqual([{ slug: 'markets', in_venue: false }, { slug: 'notable-works', in_venue: true }]);
  });

  it('writes a judgement against its entry and kind, and the database refuses one on a filing the list does not hold', async () => {
    await replaceCoverage(await files('first-region', ['moray'], 'markets', ['moray']));

    const judged = await pool.query<{ entry_slug: string; kind_slug: string; cause: string; issue_number: number; judged: string }>(
      `SELECT j.entry_slug, j.kind_slug, j.cause, j.issue_number, to_char(j.judged, 'YYYY-MM-DD') AS judged
         FROM coverage_judgements j
         JOIN coverage_expectation_kinds xk ON (xk.region_slug, xk.expectation_slug, xk.kind_slug) = (j.region_slug, j.entry_slug, j.kind_slug)`,
    );
    expect(judged.rows).toEqual([{ entry_slug: 'moray', kind_slug: 'markets', cause: 'door-missing', issue_number: 628, judged: '2026-10-16' }]);

    // The files' reader would have refused these; the foreign keys are the second guard.
    await expect(replaceCoverage(await files('first-region', ['moray'], 'markets', ['tipon']))).rejects.toThrow();
    const otherKind = await files('first-region', ['moray'], 'markets', ['moray']);
    otherKind.judgements[0].kind = 'notable-works';
    await expect(replaceCoverage(otherKind)).rejects.toThrow();
    expect(await loaded()).toEqual(['first-region/moray']);
  });

  it('writes a judgement on a catalogue row, and the database refuses a cause a row cannot take and worth-a-visit on an entry', async () => {
    const onRow = await files('first-region', ['moray']);
    onRow.judgements = [{ region: 'first-region', entry: null, kind: null, row: 'Q2003624', cause: 'worth-a-visit', issue: null, judged: '2026-10-17', note: 'A chapel worth the walk.' }];
    await replaceCoverage(onRow);
    const judged = await pool.query<{ row_wikidata_id: string; cause: string }>('SELECT row_wikidata_id, cause FROM coverage_judgements');
    expect(judged.rows).toEqual([{ row_wikidata_id: 'Q2003624', cause: 'worth-a-visit' }]);

    // The files' reader would have refused these; the CHECK constraints are the second guard.
    const rowWaiting = await files('first-region', ['moray']);
    rowWaiting.judgements = [{ ...onRow.judgements[0], cause: 'door-missing', issue: 628 }];
    await expect(replaceCoverage(rowWaiting)).rejects.toThrow(/coverage_judgements_row_causes/);
    const entryWorthAVisit = await files('first-region', ['moray'], 'markets', ['moray']);
    entryWorthAVisit.judgements[0].cause = 'worth-a-visit';
    entryWorthAVisit.judgements[0].issue = null;
    await expect(replaceCoverage(entryWorthAVisit)).rejects.toThrow(/coverage_judgements_entry_causes/);
  });

  it('writes a calibration list against its kind and its reference lists, and the database refuses one item twice or a list nobody registered', async () => {
    await replaceCoverage(await files('first-region', ['moray']));

    const named = await pool.query<{ kind_slug: string; slug: string; wikidata_id: string; sitelinks: number; source: string; read: string }>(
      `SELECT c.kind_slug, c.slug, c.wikidata_id, c.sitelinks, s.name AS source, to_char(s.read, 'YYYY-MM-DD') AS read
         FROM coverage_calibration_entries c
         JOIN coverage_calibration_entry_sources cs ON (cs.kind_slug, cs.entry_slug) = (c.kind_slug, c.slug)
         JOIN coverage_calibration_sources s ON s.slug = cs.source_slug`,
    );
    expect(named.rows).toEqual([{ kind_slug: 'archaeology', slug: 'machu-picchu', wikidata_id: 'Q676203', sitelinks: 40, source: 'The coverage surveys', read: '2026-10-24' }]);

    // The files' reader would have refused these; the constraints are the second guard.
    const twice = await files('first-region', ['moray']);
    twice.calibration = new Map([['archaeology', [top('machu-picchu', 'Q676203'), top('machu-picchu-again', 'Q676203')]]]);
    await expect(replaceCoverage(twice)).rejects.toThrow(/coverage_calibration_entries_one_item/);
    const unregistered = await files('first-region', ['moray']);
    unregistered.calibration = new Map([['archaeology', [top('machu-picchu', 'Q676203', ['a-list-nobody-registered'])]]]);
    await expect(replaceCoverage(unregistered)).rejects.toThrow();
    expect(await loaded()).toEqual(['first-region/moray']);
  });

  it('leaves nothing of the load before', async () => {
    await replaceCoverage(await files('first-region', ['moray', 'tipon'], 'markets', ['moray']));
    await replaceCoverage(await files('second-region', ['bondi']));

    expect(await loaded()).toEqual(['second-region/bondi']);
    const regions = await pool.query<{ slug: string }>('SELECT slug FROM coverage_regions');
    expect(regions.rows).toEqual([{ slug: 'second-region' }]);
    const judgements = await pool.query('SELECT 1 FROM coverage_judgements');
    expect(judgements.rowCount).toBe(0);
    const tops = await pool.query<{ slug: string }>('SELECT slug FROM coverage_calibration_entries');
    expect(tops.rows).toEqual([{ slug: 'machu-picchu' }]);
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

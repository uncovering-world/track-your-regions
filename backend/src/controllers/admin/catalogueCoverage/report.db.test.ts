import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import type { CoverageExpectation, CoverageFiles } from '../../../services/catalogueCoverage/files.js';
import { replaceCoverage } from '../../../services/catalogueCoverage/load.js';
import { coverageReport, type CoverageReport } from './report.js';

/**
 * The coverage report against PostgreSQL: one expectation for each way an
 * expected thing can stand to the catalogue, on a made-up region.
 *
 * The catalogue side is five digs, a World Heritage property and two works. The
 * digs differ in the one thing a reader predicate asks: offered; waiting for a
 * curator; refused; no longer standing; offered and known to the list under
 * another item. Only the real planner can say the composed predicates select
 * what each means on its own, and only PostGIS can say what 66 metres is.
 *
 * The expectation tables have one writer and no other owner of rows, so this
 * spec loads them whole and empties them after; the lane runs its files one
 * after another.
 */

const REGION = 'db-lane-region';
const PLACES = { offered: 9601, pending: 9602, refused: 9603, lost: 9604, otherItem: 9605, heritage: 9606 } as const;
const WORKS = { shown: 'Q96000010', hidden: 'Q96000011' } as const;
const QID = { offered: 'Q96000001', pending: 'Q96000002', refused: 'Q96000003', lost: 'Q96000004', otherItem: 'Q96000005' } as const;
const UNESCO = '96001';
// The offered dig stands at 50 N 10 E; a degree of latitude is 111.2 km.
const AT = { lat: 50, lon: 10 };
const metresNorth = (metres: number) => AT.lat + metres / 111_195;

const SLUGS: Record<number, string> = {
  1: 'world-heritage', 2: 'art-museums', 3: 'public-art', 4: 'places-of-worship', 5: 'archaeology',
};

async function clearCatalogue(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [Object.values(PLACES)]);
  await pool.query('DELETE FROM treasures WHERE external_id = ANY($1::text[])', [Object.values(WORKS)]);
}

async function clearExpectations(): Promise<void> {
  await pool.query('DELETE FROM coverage_expectation_kinds');
  await pool.query('DELETE FROM coverage_expectations');
  await pool.query('DELETE FROM coverage_regions');
  await pool.query('DELETE FROM coverage_kinds');
}

/** A place of a kind, with its one point, admitted or refused, read or not. */
async function place(
  id: number, externalId: string, lon: number, kind: { source: number; kind: number; type: string },
  admission: 'admitted' | 'refused', state: 'verified' | 'pending',
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, kind.source, externalId, `Place ${id}`, lon, AT.lat],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location)
     VALUES ($1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [id, `Point of ${id}`, lon, AT.lat],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, admission, curation_state)
     VALUES ($1, $2, $3, (SELECT external_id FROM experiences WHERE id = $1), $6, $4, $5)`,
    [id, kind.kind, kind.source, admission, state, kind.type],
  );
}

async function work(externalId: string, venue: number): Promise<void> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type, curation_state)
     VALUES ($1, $1, 'artifact', 'verified') RETURNING id`,
    [externalId],
  );
  await pool.query(
    `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, 'verified')`,
    [venue, row.rows[0].id],
  );
}

const entry = (slug: string, over: Partial<CoverageExpectation>): CoverageExpectation => ({
  slug, name: slug, aliases: [], type: 'place', kinds: ['archaeology'], wikidata: null, same_as: [], unesco: null, venue: null,
  sources: 2, sitelinks: null, lat: null, lon: null, note: '', ...over,
});

async function files(): Promise<CoverageFiles> {
  const { rows } = await pool.query<{ id: number; name: string }>('SELECT id, name FROM experience_kinds ORDER BY id');
  const proposed = { status: 'proposed', experience_kind_id: null, issue: null, vision: null, in_venue: false } as const;
  return {
    kinds: [
      ...rows.map(row => ({
        slug: SLUGS[row.id] ?? `kind-${row.id}`, name: row.name, form: 'place' as const, definition: `${row.name}.`,
        status: 'live' as const, experience_kind_id: row.id, issue: null, vision: null, in_venue: false,
      })),
      { slug: 'notable-works', name: 'Notable works', form: 'work', definition: 'A work.', status: 'live', experience_kind_id: null, issue: null, vision: null, in_venue: true },
      { slug: 'markets', name: 'Markets', form: 'place', definition: 'A market.', ...proposed },
      { slug: 'festivals-and-events', name: 'Festivals & events', form: 'event', definition: 'A festival.', ...proposed, issue: 1300 },
    ],
    regions: [{ slug: REGION, name: 'A region of the db lane', country: 'Nowhere', lat: AT.lat, lon: AT.lon, radius_km: 50, surveyed: '2026-10-01' }],
    expectations: new Map([[REGION, [
      entry('offered-dig', { wikidata: QID.offered, sitelinks: 150 }),
      entry('pending-dig', { wikidata: QID.pending }),
      entry('refused-dig', { wikidata: QID.refused }),
      entry('lost-dig', { wikidata: QID.lost }),
      entry('dig-under-another-item', { wikidata: 'Q96000031', same_as: [QID.otherItem] }),
      entry('heritage-property', { kinds: ['world-heritage'], unesco: UNESCO }),
      entry('mask-on-view', { type: 'work', kinds: ['notable-works'], wikidata: WORKS.shown }),
      entry('mask-nobody-can-see', { type: 'work', kinds: ['notable-works'], wikidata: WORKS.hidden }),
      entry('sixty-six-metres-away', { wikidata: 'Q96000020', lat: metresNorth(66), lon: AT.lon }),
      entry('three-hundred-metres-away', { wikidata: 'Q96000021', sitelinks: 40, lat: metresNorth(300), lon: AT.lon }),
      entry('market', { kinds: ['markets'], lat: metresNorth(20), lon: AT.lon }),
      entry('festival', { type: 'event', kinds: ['festivals-and-events'] }),
      entry('not-sorted', { type: 'activity', kinds: [] }),
    ]]]),
  };
}

let report: CoverageReport;

beforeAll(async () => {
  await clearCatalogue();
  const dig = { source: 5, kind: 5, type: 'site' };
  await place(PLACES.offered, QID.offered, AT.lon, dig, 'admitted', 'verified');
  await place(PLACES.pending, QID.pending, AT.lon + 1, dig, 'admitted', 'pending');
  await place(PLACES.refused, QID.refused, AT.lon + 2, dig, 'refused', 'verified');
  await place(PLACES.lost, QID.lost, AT.lon + 3, dig, 'admitted', 'verified');
  await pool.query(`UPDATE experiences SET existence = 'lost' WHERE id = $1`, [PLACES.lost]);
  await place(PLACES.otherItem, QID.otherItem, AT.lon + 4, dig, 'admitted', 'verified');
  await place(PLACES.heritage, UNESCO, AT.lon + 5, { source: 1, kind: 1, type: 'cultural' }, 'admitted', 'verified');
  await work(WORKS.shown, PLACES.offered);
  await work(WORKS.hidden, PLACES.pending);
  await replaceCoverage(await files());
  report = await coverageReport([REGION]);
});

afterAll(async () => {
  await clearCatalogue();
  await clearExpectations();
  await pool.end();
});

const verdict = (slug: string) => report.expectations.find(result => result.slug === slug)?.verdict;

describe('the coverage report on a real database', () => {
  it('finds a place by its Wikidata id, by an id named as the same place, and by UNESCO\'s id', () => {
    expect(verdict('offered-dig')).toBe('offered');
    expect(verdict('dig-under-another-item')).toBe('offered');
    expect(verdict('heritage-property')).toBe('offered');
  });

  it('calls held what the catalogue has and a reader does not see: unread, refused, no longer standing', () => {
    expect(verdict('pending-dig')).toBe('held');
    expect(verdict('refused-dig')).toBe('held');
    expect(verdict('lost-dig')).toBe('held');
  });

  it('finds a work a museum a reader may go to shows, and holds one only an unread museum shows', () => {
    expect(verdict('mask-on-view')).toBe('offered');
    expect(verdict('mask-nobody-can-see')).toBe('held');
  });

  it('says what stands 66 metres from a missing dig, and that nothing stands 300 metres from another', () => {
    const near = report.expectations.find(result => result.slug === 'sixty-six-metres-away');
    expect(near?.verdict).toBe('same_spot');
    expect(near?.nearby.map(point => [point.place, point.point])).toEqual([[`Place ${PLACES.offered}`, `Point of ${PLACES.offered}`]]);
    expect(near?.nearby[0].metres).toBeGreaterThanOrEqual(65);
    expect(near?.nearby[0].metres).toBeLessThanOrEqual(67);
    expect(verdict('three-hundred-metres-away')).toBe('missing_live');
  });

  it('leaves a market beside a dig as missing from a proposed kind, and an entry with no kind as unsorted', () => {
    expect(verdict('market')).toBe('missing_proposed');
    expect(verdict('festival')).toBe('missing_proposed');
    expect(verdict('not-sorted')).toBe('unsorted');
  });

  it('counts the region by verdict and reads no other region', () => {
    expect(report.regions).toHaveLength(1);
    expect(report.regions[0]).toMatchObject({
      slug: REGION, surveyed: '2026-10-01', total: 13,
      counts: { offered: 4, held: 4, same_spot: 1, missing_live: 1, missing_proposed: 2, unsorted: 1 },
    });
  });

  it('puts a kind of festival among the proposed kinds, with what it holds and its issue', () => {
    expect(report.proposedKinds.map(demand => [demand.slug, demand.form, demand.issue, demand.expected]))
      .toEqual([['festivals-and-events', 'event', 1300, 1], ['markets', 'place', null, 1]]);
  });

  it('names the well-known dig Archaeology lacks, against the line its own source states', async () => {
    const archaeology = report.liveKinds.find(kind => kind.slug === 'archaeology');
    const stated = await pool.query<{ line: number | null }>(
      `SELECT MIN((api_config->>'enterSitelinks')::int) AS line FROM experience_sources WHERE kind_id = 5 AND is_active`,
    );
    // The fixture database may state no line; the report then falls back to the code's.
    expect(archaeology?.line).toBe(stated.rows[0].line ?? 22);
    expect(archaeology).toMatchObject({ expected: 7, offered: 2 });
    expect(archaeology?.wellKnownMissing.map(missing => missing.name)).toEqual(['three-hundred-metres-away']);
    expect(archaeology?.belowLineMissing).toBe(4);
  });
});

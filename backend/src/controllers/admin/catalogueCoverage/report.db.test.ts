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
/** Three more regions for the reach alone (#1601): one at seventy degrees north, one astride the antimeridian, one by the pole. */
const NORTH = { slug: 'db-lane-north', lat: 70, lon: 20 };
const FAR_EAST = { slug: 'db-lane-far-east', lat: -17, lon: 179.8 };
const POLE = { slug: 'db-lane-pole', lat: 89.9, lon: 0 };
const PLACES = { offered: 9601, pending: 9602, refused: 9603, lost: 9604, otherItem: 9605, heritage: 9606, unnamed: 9607, north: 9608, acrossTheLine: 9609, byThePole: 9610, pendingMissing: 9611 } as const;
const WORKS = { shown: 'Q96000010', hidden: 'Q96000011' } as const;
const QID = {
  offered: 'Q96000001', pending: 'Q96000002', refused: 'Q96000003', lost: 'Q96000004', otherItem: 'Q96000005', unnamed: 'Q96000006',
  north: 'Q96000007', acrossTheLine: 'Q96000008', byThePole: 'Q96000009',
} as const;
const UNESCO = '96001';
/** The calibration list's own items (#1864): one the last run refused, one under the line, one out of reach. */
const TOPS = { refusedByRun: 'Q96000050', underLine: 'Q96000051', outOfReach: 'Q96000052', pendingMissing: 'Q96000053' } as const;
const HERITAGE_ITEM = 'Q96000040';
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
  await pool.query('DELETE FROM coverage_calibration_entry_sources');
  await pool.query('DELETE FROM coverage_calibration_entries');
  await pool.query('DELETE FROM coverage_calibration_sources');
  await pool.query('DELETE FROM coverage_judgements');
  await pool.query('DELETE FROM coverage_expectation_kinds');
  await pool.query('DELETE FROM coverage_expectations');
  await pool.query('DELETE FROM coverage_regions');
  await pool.query('DELETE FROM coverage_kinds');
}

/** A place of a kind, with its one point, admitted or refused, read or not. */
async function place(
  id: number, externalId: string, lon: number, kind: { source: number; kind: number; type: string },
  admission: 'admitted' | 'refused', state: 'verified' | 'pending', metadata: Record<string, unknown> = {}, lat = AT.lat,
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, metadata)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7)`,
    [id, kind.source, externalId, `Place ${id}`, lon, lat, metadata],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location)
     VALUES ($1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [id, `Point of ${id}`, lon, lat],
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
    regions: [
      { slug: REGION, name: 'A region of the db lane', country: 'Nowhere', lat: AT.lat, lon: AT.lon, radius_km: 50, surveyed: '2026-10-01' },
      { slug: NORTH.slug, name: 'Far north', country: 'Nowhere', lat: NORTH.lat, lon: NORTH.lon, radius_km: 50, surveyed: '2026-10-01' },
      { slug: FAR_EAST.slug, name: 'Across the line', country: 'Nowhere', lat: FAR_EAST.lat, lon: FAR_EAST.lon, radius_km: 50, surveyed: '2026-10-01' },
      { slug: POLE.slug, name: 'By the pole', country: 'Nowhere', lat: POLE.lat, lon: POLE.lon, radius_km: 50, surveyed: '2026-10-01' },
    ],
    expectations: new Map([[NORTH.slug, []], [FAR_EAST.slug, []], [POLE.slug, []], [REGION, [
      entry('offered-dig', { wikidata: QID.offered, sitelinks: 150 }),
      entry('pending-dig', { wikidata: QID.pending }),
      entry('refused-dig', { wikidata: QID.refused }),
      entry('lost-dig', { wikidata: QID.lost }),
      entry('dig-under-another-item', { wikidata: 'Q96000031', same_as: [QID.otherItem] }),
      entry('heritage-property', { kinds: ['world-heritage'], unesco: UNESCO }),
      // The same property by the Wikidata item its membership resolves the site to, which no row's own id is.
      entry('heritage-by-item', { wikidata: HERITAGE_ITEM }),
      entry('mask-on-view', { type: 'work', kinds: ['notable-works'], wikidata: WORKS.shown }),
      entry('mask-nobody-can-see', { type: 'work', kinds: ['notable-works'], wikidata: WORKS.hidden }),
      entry('sixty-six-metres-away', { wikidata: 'Q96000020', lat: metresNorth(66), lon: AT.lon }),
      entry('three-hundred-metres-away', { wikidata: 'Q96000021', sitelinks: 40, lat: metresNorth(300), lon: AT.lon }),
      entry('market', { kinds: ['markets'], lat: metresNorth(20), lon: AT.lon }),
      entry('festival', { type: 'event', kinds: ['festivals-and-events'] }),
      entry('not-sorted', { type: 'activity', kinds: [] }),
    ]]]),
    judgements: [
      { region: REGION, entry: 'refused-dig', kind: 'archaeology', row: null, cause: 'rule-defect', issue: 1160, judged: '2026-10-16', note: 'Refused on a class the door should admit.' },
      { region: REGION, entry: 'offered-dig', kind: 'archaeology', row: null, cause: 'door-missing', issue: 881, judged: '2026-10-01', note: 'Judged before the run that admitted it.' },
      { region: REGION, entry: null, kind: null, row: 'Q96000099', cause: 'not-a-must', issue: null, judged: '2026-10-16', note: 'Judged when a row carried the id; none does now.' },
      { region: REGION, entry: null, kind: null, row: QID.unnamed, cause: 'not-a-must', issue: null, judged: '2026-10-17', note: 'A stump no guide names (#1601).' },
    ],
    calibrationSources: [{ slug: 'coverage-surveys', name: 'The coverage surveys', url: null, read: '2026-10-24', note: '' }],
    calibration: new Map([['archaeology', [
      { slug: 'offered-top', name: 'Offered top', wikidata: QID.offered, sources: ['coverage-surveys'], sitelinks: 150, note: '' },
      { slug: 'pending-top', name: 'Pending top', wikidata: QID.pending, sources: ['coverage-surveys'], sitelinks: 60, note: '' },
      { slug: 'refused-by-run', name: 'Refused by the run', wikidata: TOPS.refusedByRun, sources: ['coverage-surveys'], sitelinks: 50, note: '' },
      { slug: 'under-the-line', name: 'Under the line', wikidata: TOPS.underLine, sources: ['coverage-surveys'], sitelinks: 10, note: '' },
      { slug: 'out-of-reach', name: 'Out of reach', wikidata: TOPS.outOfReach, sources: ['coverage-surveys'], sitelinks: 40, note: '' },
      // Admitted and passed by a curator, and no longer standing: not waiting for anyone, so held and named.
      { slug: 'lost-top', name: 'Lost top', wikidata: QID.lost, sources: ['coverage-surveys'], sitelinks: 45, note: '' },
      // Unread, and marked missing by the next run: no curator will see it, so held and named.
      { slug: 'pending-missing-top', name: 'Pending and missing', wikidata: TOPS.pendingMissing, sources: ['coverage-surveys'], sitelinks: 44, note: '' },
    ]]]),
  };
}

let runLogId: number;

/** The latest real, closed Archaeology run, refusing one item of the list; an older run that refused another says nothing. */
async function runs(): Promise<void> {
  const older = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run) VALUES (5, 'success', NOW() - interval '1 day', false) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, external_id, name_snapshot, change_type, error) VALUES ($1, $2, 'Out of reach', 'filtered', 'an older run said so')`,
    [older.rows[0].id, TOPS.outOfReach],
  );
  const latest = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run) VALUES (5, 'success', NOW(), false) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, external_id, name_snapshot, change_type, error) VALUES ($1, $2, 'Refused by the run', 'filtered', 'a water system, not a site')`,
    [latest.rows[0].id, TOPS.refusedByRun],
  );
  runLogId = older.rows[0].id;
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
  // Far from every region's reach, so only the calibration list sees it.
  await place(PLACES.pendingMissing, TOPS.pendingMissing, AT.lon + 30, dig, 'admitted', 'pending');
  await pool.query(`UPDATE experiences SET missing_since = NOW() WHERE id = $1`, [PLACES.pendingMissing]);
  await place(PLACES.heritage, UNESCO, AT.lon + 5, { source: 1, kind: 1, type: 'cultural' }, 'admitted', 'verified');
  await pool.query('UPDATE experience_kind_memberships SET wikidata_items = $2 WHERE experience_id = $1', [PLACES.heritage, [HERITAGE_ITEM]]);
  // Fourteen kilometres from the centre, offered, and named by no entry: the other direction's one row (#1601).
  await place(PLACES.unnamed, QID.unnamed, AT.lon + 0.2, dig, 'admitted', 'verified', { sitelinksCount: 7 });
  // 1.2 degrees east at seventy north is 46 km, inside a 50 km reach that a box of 0.9 degrees would miss.
  await place(PLACES.north, QID.north, NORTH.lon + 1.2, dig, 'admitted', 'verified', { sitelinksCount: 3 }, NORTH.lat);
  // Across the antimeridian from a centre at 179.8 E: 0.3 degrees of longitude, 32 km, at seventeen south.
  await place(PLACES.acrossTheLine, QID.acrossTheLine, -179.9, dig, 'admitted', 'verified', { sitelinksCount: 2 }, FAR_EAST.lat);
  // Five degrees of longitude from a centre at 89.9 N is one kilometre: a circle in degrees drawn for the centre's latitude misses it.
  await place(PLACES.byThePole, QID.byThePole, POLE.lon + 5, dig, 'admitted', 'verified', { sitelinksCount: 1 }, POLE.lat);
  await work(WORKS.shown, PLACES.offered);
  await work(WORKS.hidden, PLACES.pending);
  await runs();
  await replaceCoverage(await files());
  report = await coverageReport([REGION]);
});

afterAll(async () => {
  await clearCatalogue();
  await clearExpectations();
  // The two runs this spec logged, and their changes with them.
  await pool.query('DELETE FROM experience_sync_logs WHERE id >= $1 AND source_id = 5 AND completed_at >= NOW() - interval \'2 days\'', [runLogId]);
  await pool.end();
});

const verdict = (slug: string) => report.expectations.find(result => result.slug === slug)?.verdict;

describe('the coverage report on a real database', () => {
  it('finds a place by its Wikidata id, by an id named as the same place, by UNESCO\'s id, and by the item a membership resolves it to', () => {
    expect(verdict('offered-dig')).toBe('offered');
    expect(verdict('dig-under-another-item')).toBe('offered');
    expect(verdict('heritage-property')).toBe('offered');
    expect(verdict('heritage-by-item')).toBe('offered');
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
      slug: REGION, surveyed: '2026-10-01', total: 14,
      counts: { offered: 5, held: 4, same_spot: 1, missing_live: 1, missing_proposed: 2, unsorted: 1 },
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
    // The property by its item is filed under Archaeology and offered by World Heritage: absent here, under the line.
    expect(archaeology).toMatchObject({ expected: 8, offered: 2 });
    expect(archaeology?.wellKnownMissing.map(missing => missing.name)).toEqual(['three-hundred-metres-away']);
    expect(archaeology?.belowLineMissing).toBe(5);
  });

  it('reads the ledger: the refused dig carries its judgement under Archaeology, and the offered one\'s is stale', () => {
    const archaeology = report.liveKinds.find(kind => kind.slug === 'archaeology');
    // Under the line, so counted rather than listed: the judgement is found through the stale test instead.
    expect(archaeology?.wellKnownMissing.map(missing => missing.judgement)).toEqual([null]);
    expect(report.staleJudgements.map(stale => [stale.slug, stale.kindSlug, stale.cause, stale.issue, stale.judged])).toEqual([
      ['offered-dig', 'archaeology', 'door-missing', 881, '2026-10-01'],
    ]);
  });

  it('finds the offered place within reach no entry names, with its kind and its own sitelinks, and keeps its judgement standing', () => {
    const [region] = report.unnamed;
    // The fixture database seeds places of its own around the same point; they are unjudged, so the standing findings are this spec's alone.
    expect(region).toMatchObject({ regionSlug: REGION, judgedByCause: [{ cause: 'not-a-must', count: 1, issues: [] }] });
    expect(region.total).toBeGreaterThanOrEqual(1);
    expect(region.unjudged.map(place => place.wikidataId)).not.toContain(QID.unnamed);
    expect(region.standing).toEqual([{
      experienceId: PLACES.unnamed, name: `Place ${PLACES.unnamed}`, wikidataId: QID.unnamed, kinds: ['Archaeology'], sitelinks: 7, km: 14,
      judgement: { cause: 'not-a-must', issue: null, judged: '2026-10-17', note: 'A stump no guide names (#1601).' },
    }]);
    // A place the lists name is never also a place the lists do not name.
    expect([...region.unjudged, ...region.standing].map(place => place.wikidataId)).not.toContain(QID.offered);
  });

  it('stands each top of the calibration list: offered, admitted and waiting for a curator, refused by the latest run with its reason, under the line, out of reach (#1864)', () => {
    const archaeology = report.liveKinds.find(kind => kind.slug === 'archaeology');
    // The pending dig is admitted and waits for a curator: the line holds it, so it is counted and not named.
    expect(archaeology?.calibration).toMatchObject({ entries: 7, offered: 1, admitted: 1, bySource: [{ slug: 'coverage-surveys', named: 7, offered: 1 }] });
    expect(archaeology?.calibration?.misses.map(miss => [miss.slug, miss.standing, miss.detail])).toEqual([
      ['refused-by-run', 'refused', 'a water system, not a site'],
      ['lost-top', 'held', `Place ${PLACES.lost}`],
      ['pending-missing-top', 'held', `Place ${PLACES.pendingMissing}`],
      // The older run's refusal is not the catalogue's last word on it.
      ['out-of-reach', 'absent', null],
      ['under-the-line', 'under_line', null],
    ]);
    expect(report.liveKinds.find(kind => kind.slug === 'world-heritage')?.calibration).toBeNull();
  });

  it('calls stale a row judgement no offered row within reach carries', () => {
    expect(report.staleRowJudgements.map(stale => [stale.wikidataId, stale.cause])).toEqual([['Q96000099', 'not-a-must']]);
  });

  it('reaches a place at seventy degrees north, one across the antimeridian and one by the pole, where a box in degrees would not', async () => {
    const elsewhere = await coverageReport([NORTH.slug, FAR_EAST.slug, POLE.slug]);
    const unnamed = (slug: string) => elsewhere.unnamed.find(region => region.regionSlug === slug)?.unjudged
      .filter(place => (Object.values(QID) as string[]).includes(place.wikidataId ?? ''))
      .map(place => [place.wikidataId, place.km]);
    expect(unnamed(NORTH.slug)).toEqual([[QID.north, 46]]);
    expect(unnamed(FAR_EAST.slug)).toEqual([[QID.acrossTheLine, 32]]);
    expect(unnamed(POLE.slug)).toEqual([[QID.byThePole, 1]]);
  });
});

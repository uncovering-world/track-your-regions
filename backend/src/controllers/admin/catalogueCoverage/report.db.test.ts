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
const PLACES = {
  offered: 9601, pending: 9602, refused: 9603, lost: 9604, otherItem: 9605, heritage: 9606, unnamed: 9607, north: 9608, acrossTheLine: 9609,
  byThePole: 9610, pendingMissing: 9611, crowded: 9612, abroad: 9613, astride: 9614, abroadByItem: 9615,
} as const;
const WORKS = { shown: 'Q96000010', hidden: 'Q96000011' } as const;
const QID = {
  offered: 'Q96000001', pending: 'Q96000002', refused: 'Q96000003', lost: 'Q96000004', otherItem: 'Q96000005', unnamed: 'Q96000006',
  north: 'Q96000007', acrossTheLine: 'Q96000008', byThePole: 'Q96000009', crowded: 'Q96000012',
  abroad: 'Q96000013', astride: 'Q96000014', abroadByItem: 'Q96000015',
} as const;

/**
 * The fixture region's country is ZZ (#2406). A place its source puts in XA alone lies
 * outside the reach, one in XA and ZZ stands on the border and stays, and one whose item
 * names a country with the code XB (P17, then P297) lies outside too.
 */
const COUNTRY_XB = 'Q96000070';
const ENTITIES: Record<string, unknown> = {
  [COUNTRY_XB]: { claims: { P297: [{ id: `${COUNTRY_XB}$db-lane-p297`, value: 'XB' }] } },
};

async function clearEntities(): Promise<void> {
  await pool.query('DELETE FROM workbench.wikidata_entities WHERE id = ANY($1::text[])', [Object.keys(ENTITIES)]);
}
const UNESCO = '96001';
/** The items the calibration lists name and no fixture place holds (#1864, #1988). */
const TOPS = {
  refusedByRun: 'Q96000050', underLine: 'Q96000051', outOfReach: 'Q96000052', pendingMissing: 'Q96000053',
  findNotHeld: 'Q96000054', findUnderLine: 'Q96000055',
  // Held through the offered dig (#2151): a temple that is part of it, and a hall it has as a part; and a whole the dig is a part of.
  partOfDig: 'Q96000056', digHasIt: 'Q96000057', wholeOfDig: 'Q96000058',
} as const;

/** What the copy of Wikidata says holds what (#2151): the temple and the hall are in the dig, the dig is in the whole; and where a place abroad stands (#2406). */
const CLAIMS = [
  // The item of a place abroad names its country (#2406).
  { subject: QID.abroadByItem, property: 'P17', value: COUNTRY_XB },
  { subject: TOPS.partOfDig, property: 'P361', value: QID.offered },
  { subject: QID.offered, property: 'P527', value: TOPS.digHasIt },
  { subject: QID.offered, property: 'P361', value: TOPS.wholeOfDig },
];

async function clearClaims(): Promise<void> {
  await pool.query('DELETE FROM workbench.wikidata_claims WHERE statement_id LIKE $1', ['db-lane-coverage-%']);
}
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
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, type, admission, curation_state)
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
  // The register holds the kinds a traveller browses, and a part's record is in no kind (ADR-0198).
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM experience_kinds ORDER BY id',
  );
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
      { slug: REGION, name: 'A region of the db lane', country: 'Nowhere', country_code: 'ZZ', lat: AT.lat, lon: AT.lon, radius_km: 50, surveyed: '2026-10-01' },
      { slug: NORTH.slug, name: 'Far north', country: 'Nowhere', country_code: 'ZZ', lat: NORTH.lat, lon: NORTH.lon, radius_km: 50, surveyed: '2026-10-01' },
      { slug: FAR_EAST.slug, name: 'Across the line', country: 'Nowhere', country_code: 'ZZ', lat: FAR_EAST.lat, lon: FAR_EAST.lon, radius_km: 50, surveyed: '2026-10-01' },
      { slug: POLE.slug, name: 'By the pole', country: 'Nowhere', country_code: 'ZZ', lat: POLE.lat, lon: POLE.lon, radius_km: 50, surveyed: '2026-10-01' },
    ],
    expectations: new Map([[NORTH.slug, []], [FAR_EAST.slug, []], [POLE.slug, []], [REGION, [
      entry('offered-dig', { wikidata: QID.offered, sitelinks: 150 }),
      entry('pending-dig', { wikidata: QID.pending }),
      entry('refused-dig', { wikidata: QID.refused }),
      entry('lost-dig', { wikidata: QID.lost }),
      entry('crowded-dig', { wikidata: QID.crowded }),
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
      { slug: 'part-of-dig', name: 'Temple in the dig', wikidata: TOPS.partOfDig, sources: ['coverage-surveys'], sitelinks: 70, note: '' },
      { slug: 'dig-has-it', name: 'Hall of the dig', wikidata: TOPS.digHasIt, sources: ['coverage-surveys'], sitelinks: 65, note: '' },
      { slug: 'whole-of-dig', name: 'Whole of the dig', wikidata: TOPS.wholeOfDig, sources: ['coverage-surveys'], sitelinks: 49, note: '' },
    ]], ['notable-works', [
      // A kind of work stands by its treasure (#1988): shown by an offered venue, held where no venue a reader may go to shows it.
      { slug: 'find-on-view', name: 'Find on view', wikidata: WORKS.shown, sources: ['coverage-surveys'], sitelinks: 60, note: '' },
      { slug: 'find-nobody-can-see', name: 'Find nobody can see', wikidata: WORKS.hidden, sources: ['coverage-surveys'], sitelinks: 50, note: '' },
      { slug: 'find-not-held', name: 'Find not held', wikidata: TOPS.findNotHeld, sources: ['coverage-surveys'], sitelinks: 40, note: '' },
      { slug: 'find-under-every-line', name: 'Find under every line', wikidata: TOPS.findUnderLine, sources: ['coverage-surveys'], sitelinks: 5, note: '' },
    ]]]),
  };
}

let runLogId: number;

/** The latest real, closed Archaeology run, refusing one item of the list; an older run that refused another says nothing. */
async function runs(): Promise<void> {
  const older = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run, world_bars) VALUES (5, 'success', NOW() - interval '1 day', false, '{"editions": 30}') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, external_id, name_snapshot, change_type, error) VALUES ($1, $2, 'Out of reach', 'filtered', 'an older run said so')`,
    [older.rows[0].id, TOPS.outOfReach],
  );
  // The bars the kind's last real run admitted by (#2321); a later preview's are its own.
  const latest = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run, world_bars) VALUES (5, 'success', NOW(), false, '{"editions": 20}') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run, world_bars) VALUES (5, 'success', NOW(), true, '{"editions": 5}')`,
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
  await pool.query('UPDATE source_records SET wikidata_items = $2 WHERE experience_id = $1', [PLACES.heritage, [HERITAGE_ITEM]]);
  // Fourteen kilometres from the centre, offered, and named by no entry: the other direction's one row (#1601).
  await place(PLACES.unnamed, QID.unnamed, AT.lon + 0.2, dig, 'admitted', 'verified', { sitelinksCount: 7 });
  // 1.2 degrees east at seventy north is 46 km, inside a 50 km reach that a box of 0.9 degrees would miss.
  await place(PLACES.north, QID.north, NORTH.lon + 1.2, dig, 'admitted', 'verified', { sitelinksCount: 3 }, NORTH.lat);
  // Across the antimeridian from a centre at 179.8 E: 0.3 degrees of longitude, 32 km, at seventeen south.
  await place(PLACES.acrossTheLine, QID.acrossTheLine, -179.9, dig, 'admitted', 'verified', { sitelinksCount: 2 }, FAR_EAST.lat);
  // Five degrees of longitude from a centre at 89.9 N is one kilometre: a circle in degrees drawn for the centre's latitude misses it.
  await place(PLACES.byThePole, QID.byThePole, POLE.lon + 5, dig, 'admitted', 'verified', { sitelinksCount: 1 }, POLE.lat);
  // Admitted, passed and crowded out of what a reader is shown (ADR-0172): the row the
  // recount would write, written last, so no recount a later write sets off replaces it.
  await place(PLACES.crowded, QID.crowded, AT.lon + 6, dig, 'admitted', 'verified');
  // Within reach and named by no entry, in other countries than the region's or on the border (#2406).
  await place(PLACES.abroad, QID.abroad, AT.lon + 0.25, dig, 'admitted', 'verified');
  await place(PLACES.astride, QID.astride, AT.lon + 0.3, dig, 'admitted', 'verified');
  await place(PLACES.abroadByItem, QID.abroadByItem, AT.lon + 0.35, dig, 'admitted', 'verified');
  await pool.query(`UPDATE experiences SET country_codes = '{XA}' WHERE id = $1`, [PLACES.abroad]);
  await pool.query(`UPDATE experiences SET country_codes = '{XA,ZZ}' WHERE id = $1`, [PLACES.astride]);
  await clearEntities();
  for (const [id, entity] of Object.entries(ENTITIES)) {
    await pool.query('INSERT INTO workbench.wikidata_entities (id, sitelink_count, entity) VALUES ($1, 0, $2)', [id, JSON.stringify(entity)]);
  }
  await work(WORKS.shown, PLACES.offered);
  await work(WORKS.hidden, PLACES.pending);
  await pool.query(
    `INSERT INTO membership_crowding (membership_id, outranked_by) SELECT id, 10 FROM source_records WHERE experience_id = $1`,
    [PLACES.crowded],
  );
  await runs();
  await clearClaims();
  for (const [index, claim] of CLAIMS.entries()) {
    await pool.query(
      `INSERT INTO workbench.wikidata_claims (subject, property, statement_id, rank, value_item) VALUES ($1, $2, $3, 0, $4)`,
      [claim.subject, claim.property, `db-lane-coverage-${index}`, claim.value],
    );
  }
  await replaceCoverage(await files());
  report = await coverageReport([REGION]);
});

afterAll(async () => {
  await clearCatalogue();
  await clearClaims();
  await clearEntities();
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

  it('calls shadowed a place a kind admits and crowds out of its city, which no list, map or count holds', () => {
    expect(verdict('crowded-dig')).toBe('shadowed');
    const crowded = report.expectations.find(result => result.slug === 'crowded-dig');
    expect(crowded?.matches).toEqual([{ catalogue_name: `Place ${PLACES.crowded}`, kind_id: 5, offered: false, shadowed: true }]);
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
      slug: REGION, surveyed: '2026-10-01', total: 15,
      counts: { offered: 5, shadowed: 1, held: 4, same_spot: 1, missing_live: 1, missing_proposed: 2, unsorted: 1, tail: 0 },
    });
  });

  it('puts a kind of festival among the proposed kinds, with what it holds and its issue', () => {
    expect(report.proposedKinds.map(demand => [demand.slug, demand.form, demand.issue, demand.expected]))
      .toEqual([['festivals-and-events', 'event', 1300, 1], ['markets', 'place', null, 1]]);
  });

  it('names the well-known dig Archaeology lacks, against the editions bar its last real run admitted by (#2321)', async () => {
    const archaeology = report.liveKinds.find(kind => kind.slug === 'archaeology');
    const stated = await pool.query<{ line: number | null }>(
      `SELECT MIN((api_config->>'enterSitelinks')::int) AS line FROM experience_sources WHERE kind_id = 5 AND is_active`,
    );
    // The editions bar of the kind's last real run (20), or the lower line its museums still enter by.
    const museums = stated.rows[0].line;
    expect(archaeology?.line).toBe(museums === null ? 20 : Math.min(20, museums));
    // The property by its item is filed under Archaeology and offered by World Heritage: absent here, under the line.
    // The crowded dig is counted beside what the kind lacks, never among it.
    expect(archaeology).toMatchObject({ expected: 9, offered: 2, tail: 0, shadowed: 1 });
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

  it('leaves out of the reach a place standing only in other countries than the region\'s, by its source\'s codes or its item\'s, and keeps one on the border (#2406)', () => {
    const [region] = report.unnamed;
    const listed = [...region.unjudged, ...region.standing].map(place => place.wikidataId);
    expect(listed).toContain(QID.astride);
    expect(listed).not.toContain(QID.abroad);
    expect(listed).not.toContain(QID.abroadByItem);
    expect(region.abroad.map(place => place.wikidataId)).toEqual([QID.abroad, QID.abroadByItem]);
  });

  it('stands each top of the calibration list: offered, admitted and waiting for a curator, refused by the latest run with its reason, under the line, out of reach (#1864)', () => {
    const archaeology = report.liveKinds.find(kind => kind.slug === 'archaeology');
    // The pending dig is admitted and waits for a curator: the line holds it, so it is counted and not named.
    expect(archaeology?.calibration).toMatchObject({ entries: 10, offered: 3, admitted: 1, bySource: [{ slug: 'coverage-surveys', named: 10, offered: 3 }] });
    expect(archaeology?.calibration?.misses.map(miss => [miss.slug, miss.standing, miss.detail])).toEqual([
      ['refused-by-run', 'refused', 'a water system, not a site'],
      // The dig is a part of it, and a part is not the whole (#2151).
      ['whole-of-dig', 'absent', null],
      ['lost-top', 'held', `Place ${PLACES.lost}`],
      ['pending-missing-top', 'held', `Place ${PLACES.pendingMissing}`],
      // The older run's refusal is not the catalogue's last word on it.
      ['out-of-reach', 'absent', null],
      ['under-the-line', 'under_line', null],
    ]);
    expect(report.liveKinds.find(kind => kind.slug === 'world-heritage')?.calibration).toBeNull();
  });

  it('offers a top through a place that holds it, by part of, location or has part, under both names, and never through a part of it (#2151)', () => {
    const archaeology = report.liveKinds.find(kind => kind.slug === 'archaeology')?.calibration;
    expect(archaeology?.offeredAs.map(top => [top.slug, top.detail])).toEqual([
      ['part-of-dig', `Place ${PLACES.offered}`],
      ['dig-has-it', `Place ${PLACES.offered}`],
    ]);
  });

  it('stands each find of a kind of work by its treasure: shown by a venue a reader may go to, held unshown, absent, under every line (#1988)', () => {
    const works = report.liveKinds.find(kind => kind.slug === 'notable-works')?.calibration;
    expect(works).toMatchObject({ entries: 4, offered: 1, admitted: 0 });
    expect(works?.misses.map(miss => [miss.slug, miss.standing, miss.detail])).toEqual([
      // Linked to a dig that waits for a curator: no reader may go there, so the find is held.
      ['find-nobody-can-see', 'held', WORKS.hidden],
      ['find-not-held', 'absent', null],
      ['find-under-every-line', 'under_line', null],
    ]);
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

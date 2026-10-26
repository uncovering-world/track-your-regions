import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { subsetCastGroupIds, subsetCastItems } from './castGroups.js';

/**
 * The casts of a group of casts, read off the subset (#880, ADR-0145 decision
 * 2b): the Burghers of Calais as Wikidata keeps them — a group with its own
 * coordinate and casts as parts, a study of one figure among the parts with
 * no coordinate — and the Thinker, a group with no coordinate over a cast that
 * names it, which enters the pool through that cast.
 */
const CAST_GROUP = 'Q28890616';
const GROUP_OF_SCULPTURES = 'Q2293362';
const SCULPTURE = 'Q860861';
const BURGHERS = 'Q978987';
const CALAIS_CAST = 'Q29273401';
const LONDON_CAST = 'Q25338408';
const STANFORD_CAST = 'Q47522991';
const HEROIC_HEAD = 'Q60781122';
const LOAN_CAST = 'Q900001';
const THINKER = 'Q18003128';
const KYOTO_CAST = 'Q130544842';
const SMALL_GROUP = 'Q900100';
const NO_PLACEMENT_CAST = 'Q900120';
const UNKNOWN_PLACEMENT_CAST = 'Q900121';
const RODIN = 'Q30755';
const MUSEE_RODIN_CAST = 'Q154571';
const GREENWICH_PARODY = 'Q30251938';
const OTHER_MAKERS_WORK = 'Q900131';

const statement = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({ id, value, ...extra });
const point = (latitude: number, longitude: number) => ({
  latitude, longitude, altitude: null, precision: 0.0001, globe: 'http://www.wikidata.org/entity/Q2',
});
const ENDED = { time: '+2001-01-01T00:00:00Z', precision: 11 };

const ENTITIES: Array<[string, number, Record<string, unknown>]> = [
  [BURGHERS, 30, { claims: {
    P31: [statement('B1', CAST_GROUP)], P625: [statement('B2', point(50.9524, 1.8533))],
    P527: [statement('B3', CALAIS_CAST), statement('B4', LONDON_CAST), statement('B5', HEROIC_HEAD), statement('B6', LOAN_CAST)],
  }, sitelinks: {} }],
  [CALAIS_CAST, 2, { claims: {
    P31: [statement('C1', GROUP_OF_SCULPTURES)], P625: [statement('C2', point(50.9523, 1.8535))],
    P276: [statement('C0', 'Q6454', { qualifiers: { P582: [ENDED] } }), statement('C3', 'Q6454')],
    // Claim order differs from label order, and a country can have no label.
    P17: [statement('C4', 'Q30'), statement('C5', 'Q900999'), statement('C6', 'Q142')],
  }, sitelinks: {} }],
  [LONDON_CAST, 1, { claims: {
    P31: [statement('L1', GROUP_OF_SCULPTURES), statement('L2', 'Q3331189')], P625: [statement('L3', point(51.4975, -0.1249))],
    P276: [statement('L4', 'Q2485117')], P17: [statement('L5', 'Q145')],
  }, sitelinks: {} }],
  // Stanford's cast names the group as what it is part of, rather than being listed among its parts.
  [STANFORD_CAST, 1, { claims: {
    P31: [statement('S1', GROUP_OF_SCULPTURES)], P625: [statement('S2', point(37.428, -122.1699))],
    P276: [statement('S3', 'Q41506')], P17: [statement('S4', 'Q30')], P361: [statement('S5', BURGHERS)],
  }, sitelinks: {} }],
  // A study of one figure: a part with no coordinate.
  [HEROIC_HEAD, 1, { claims: { P31: [statement('H1', SCULPTURE)], P276: [statement('H2', 'Q657415')] }, sitelinks: {} }],
  // A loan that ended: its one placement carries an end time.
  [LOAN_CAST, 0, { claims: {
    P31: [statement('N1', GROUP_OF_SCULPTURES)], P625: [statement('N2', point(48.8, 2.3))],
    P276: [statement('N3', 'Q19675', { qualifiers: { P582: [ENDED] } }), statement('N4', { somevalue: true })],
  }, sitelinks: {} }],
  // Non-item placements name no place: the coordinate and cast label still hold.
  [NO_PLACEMENT_CAST, 1, { claims: {
    P625: [statement('V1', point(1, 2))], P276: [statement('V2', { novalue: true })], P361: [statement('V3', BURGHERS)],
  }, sitelinks: {} }],
  [UNKNOWN_PLACEMENT_CAST, 1, { claims: {
    P625: [statement('U1', point(3, 4))], P276: [statement('U2', { somevalue: true })], P361: [statement('U3', BURGHERS)],
  }, sitelinks: {} }],
  [THINKER, 53, { claims: { P31: [statement('T1', CAST_GROUP)], P527: [statement('T2', KYOTO_CAST)], P170: [statement('T3', RODIN)] }, sitelinks: {} }],
  [KYOTO_CAST, 1, { claims: {
    P31: [statement('K1', SCULPTURE), statement('K2', 'Q3331189')], P625: [statement('K3', point(34.99, 135.7723))],
    P276: [statement('K4', 'Q147286')], P17: [statement('K5', 'Q17')], P361: [statement('K6', THINKER)],
  }, sitelinks: {} }],
  // Based on the group and made by its creator: a cast (#2092).
  [MUSEE_RODIN_CAST, 1, { claims: {
    P31: [statement('M1', 'Q179700')], P625: [statement('M2', point(48.8553, 2.3158))],
    P276: [statement('M3', 'Q650519')], P17: [statement('M4', 'Q142')], P170: [statement('M5', RODIN)], P144: [statement('M6', THINKER)],
  }, sitelinks: {} }],
  // Based on the group by no one, or by someone else: another work, never a cast.
  [GREENWICH_PARODY, 1, { claims: {
    P31: [statement('P1', 'Q179700')], P625: [statement('P2', point(51.4811, -0.0117))],
    P276: [statement('P3', 'Q179385')], P144: [statement('P4', THINKER)],
  }, sitelinks: {} }],
  [OTHER_MAKERS_WORK, 1, { claims: {
    P625: [statement('O1', point(51.2, 4.4))], P170: [statement('O2', 'Q900130')], P144: [statement('O3', THINKER)],
  }, sitelinks: {} }],
  // A group whose only item with a point is based on it by no one: not named by the pool.
  ['Q900117', 30, { claims: { P31: [statement('W1', CAST_GROUP)], P170: [statement('W2', RODIN)] }, sitelinks: {} }],
  ['Q900118', 1, { claims: { P625: [statement('W3', point(5, 6))], P144: [statement('W4', 'Q900117')] }, sitelinks: {} }],
  // A group below the fame floor with no point: not named by the pool.
  [SMALL_GROUP, 3, { claims: { P31: [statement('G1', CAST_GROUP)], P527: [statement('G2', KYOTO_CAST)] }, sitelinks: {} }],
  // A group has no usable cast when its cast's only coordinate is deprecated,
  // through a forward part or a reverse based-on statement alike.
  ['Q900110', 30, { claims: { P31: [statement('D1', CAST_GROUP)], P527: [statement('D2', 'Q900112')] }, sitelinks: {} }],
  ['Q900111', 30, { claims: { P31: [statement('D3', CAST_GROUP)], P170: [statement('D12', RODIN)] }, sitelinks: {} }],
  ['Q900112', 1, { claims: { P625: [statement('D4', point(1, 2), { rank: 'deprecated' })] }, sitelinks: {} }],
  ['Q900113', 1, { claims: { P625: [statement('D5', point(1, 2), { rank: 'deprecated' })], P144: [statement('D6', 'Q900111')], P170: [statement('D13', RODIN)] }, sitelinks: {} }],
  // The relationship naming a standing cast can itself be deprecated.
  ['Q900114', 30, { claims: { P31: [statement('D7', CAST_GROUP)], P527: [statement('D8', KYOTO_CAST, { rank: 'deprecated' })] }, sitelinks: {} }],
  ['Q900115', 30, { claims: { P31: [statement('D9', CAST_GROUP)], P170: [statement('D14', RODIN)] }, sitelinks: {} }],
  ['Q900116', 1, { claims: { P625: [statement('D10', point(1, 2))], P144: [statement('D11', 'Q900115', { rank: 'deprecated' })], P170: [statement('D15', RODIN)] }, sitelinks: {} }],
];

const LABELS: Array<[string, string]> = [
  [CALAIS_CAST, 'The Burghers of Calais'], [LONDON_CAST, 'The Burghers of Calais'], [STANFORD_CAST, 'The Burghers of Calais, Stanford'],
  [KYOTO_CAST, 'Le Penseur (Kyoto National Museum)'],
  [NO_PLACEMENT_CAST, 'Cast with no named placement'], [UNKNOWN_PLACEMENT_CAST, 'Cast with unknown placement'],
  [MUSEE_RODIN_CAST, 'The Thinker'], [GREENWICH_PARODY, 'Man on Toilet Reading The Beamo Book'], ['Q650519', 'Musée Rodin'],
  ['Q6454', 'Calais'], ['Q2485117', 'Victoria Tower Gardens'], ['Q41506', 'Stanford University'], ['Q147286', 'Kyoto National Museum'],
  ['Q142', 'France'], ['Q145', 'United Kingdom'], ['Q30', 'United States of America'], ['Q17', 'Japan'],
];

interface FixtureClaim { id: string; value: unknown; rank?: string }

/** Materialise the fixture's claims with the ranks its compact entities carry. */
async function seedClaims(id: string, claims: Record<string, FixtureClaim[]>): Promise<void> {
  const ranks: Record<string, number> = { preferred: 1, normal: 0, deprecated: -1 };
  for (const [property, statements] of Object.entries(claims)) {
    for (const s of statements) {
      const item = typeof s.value === 'string' && /^Q\d+$/.test(s.value) ? s.value : null;
      await pool.query(
        'INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, property, s.id, ranks[s.rank ?? 'normal'] ?? 0, item, JSON.stringify(s.value)],
      );
    }
  }
}

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  for (const [id, sitelinks, body] of ENTITIES) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, $2, $3)',
      [id, sitelinks, JSON.stringify({ id, labels: {}, descriptions: {}, ...body })]);
    // The claims table carries what the pool and the reverse read ask by column.
    await seedClaims(id, body.claims as Record<string, FixtureClaim[]>);
  }
  for (const [id, label] of LABELS) {
    await pool.query(`INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', $2)`, [id, label]);
  }
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  await pool.end();
});

describe('groups of casts read from the subset (#880)', () => {
  it('names the groups at the floor with no point of their own whose casts have one', async () => {
    expect(await subsetCastGroupIds(CAST_GROUP, 15)).toEqual([THINKER]);
  });

  it('reads the casts of each group: parts and items naming it, with a coordinate and a placement that holds', async () => {
    const casts = await subsetCastItems([BURGHERS, THINKER, 'Q999999']);
    expect([...casts.keys()].sort()).toEqual([THINKER, BURGHERS].sort());
    expect(casts.get(BURGHERS)).toEqual([
      { qid: CALAIS_CAST, wkt: 'Point(1.8535 50.9523)', name: 'Calais', countryLabel: 'France', classes: [GROUP_OF_SCULPTURES], placements: ['Q6454'] },
      { qid: LONDON_CAST, wkt: 'Point(-0.1249 51.4975)', name: 'Victoria Tower Gardens', countryLabel: 'United Kingdom', classes: [GROUP_OF_SCULPTURES, 'Q3331189'], placements: ['Q2485117'] },
      { qid: STANFORD_CAST, wkt: 'Point(-122.1699 37.428)', name: 'Stanford University', countryLabel: 'United States of America', classes: [GROUP_OF_SCULPTURES], placements: ['Q41506'] },
      { qid: NO_PLACEMENT_CAST, wkt: 'Point(2 1)', name: 'Cast with no named placement', countryLabel: null, classes: [], placements: [] },
      { qid: UNKNOWN_PLACEMENT_CAST, wkt: 'Point(4 3)', name: 'Cast with unknown placement', countryLabel: null, classes: [], placements: [] },
    ]);
    expect(casts.get(THINKER)).toEqual([
      { qid: KYOTO_CAST, wkt: 'Point(135.7723 34.99)', name: 'Kyoto National Museum', countryLabel: 'Japan', classes: [SCULPTURE, 'Q3331189'], placements: ['Q147286'] },
      { qid: MUSEE_RODIN_CAST, wkt: 'Point(2.3158 48.8553)', name: 'Musée Rodin', countryLabel: 'France', classes: ['Q179700'], placements: ['Q650519'] },
    ]);
  });
});

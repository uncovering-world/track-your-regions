import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { fetchFindFacts, fetchSiteFacts, fetchSitesAmong } from '../archaeology/queries.js';
import { subsetKeeps } from './archaeology.js';
import { subsetOnlyDoor } from './reader.js';

/**
 * Archaeology's own questions answered from the local subset (#1462), against
 * PostgreSQL, through the fetchers the pipeline calls with the run's subset
 * door, which fails any question that reaches SPARQL. Fixture rows on real
 * items: the Rosetta Stone (Q48584) was found at Fort Julien (Q3077898); Troy
 * (Q22647) is a polis (Q148837) inscribed as World Heritage (P757 849, P1435
 * Q9259) and states its population as no value; Cairo (Q191952) states one.
 * The British Museum (Q6373) is asked about and not kept. Gerasa (Q56072866)
 * is an archaeological site (Q839954) with a point; Troy states none.
 */

const door = subsetOnlyDoor();
const ROSETTA = 'Q48584';
const FORT_JULIEN = 'Q3077898';
const STELE_CLASS = 'Q333109';
const TROY = 'Q22647';
const POLIS = 'Q148837';
const WORLD_HERITAGE = 'Q9259';
const CAIRO = 'Q191952';
const BRITISH_MUSEUM = 'Q6373';
const GERASA = 'Q56072866';
const ARCHAEOLOGICAL_SITE = 'Q839954';

const statement = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({ id, value, ...extra });

const ENTITIES: Array<[string, Record<string, unknown>]> = [
  [ROSETTA, {
    P31: [statement('R1', STELE_CLASS)],
    P189: [statement('R2', CAIRO, { rank: 'deprecated' }), statement('R3', FORT_JULIEN)],
  }],
  [TROY, {
    P31: [statement('T1', POLIS)],
    P757: [statement('T2', '849')],
    P1435: [statement('T3', WORLD_HERITAGE)],
    P1082: [statement('T4', { novalue: true })],
  }],
  [CAIRO, { P1082: [statement('C1', { amount: '+9539673', unit: '1' })] }],
  [GERASA, {
    P31: [statement('G1', ARCHAEOLOGICAL_SITE)],
    P625: [statement('G2', { latitude: 32.2808, longitude: 35.8993, globe: 'http://www.wikidata.org/entity/Q2' })],
  }],
];

interface FixtureClaim { id: string; value: unknown; rank?: string }

/** The claims table, which the question about sites with a point reads by column. */
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
  for (const [id, claims] of ENTITIES) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, 0, $2)',
      [id, JSON.stringify({ id, labels: {}, descriptions: {}, claims, sitelinks: {} })]);
    await seedClaims(id, claims as Record<string, FixtureClaim[]>);
  }
  await pool.query("INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', 'Fort Julien')", [FORT_JULIEN]);
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  await pool.end();
});

describe('Archaeology read from the subset (#1462)', () => {
  it('reads what a find is and where it was dug up, and answers empty for an item it does not keep', async () => {
    const facts = await fetchFindFacts(door, [ROSETTA, BRITISH_MUSEUM]);
    expect(facts.get(ROSETTA)).toEqual({ classes: [STELE_CLASS], discoveryPlace: { qid: FORT_JULIEN, label: 'Fort Julien' } });
    expect(facts.get(BRITISH_MUSEUM)).toEqual({ classes: [], discoveryPlace: null });
  });

  it('reads the facts a site is judged on: a World Heritage listing, and a population other than no value', async () => {
    const facts = await fetchSiteFacts(door, [TROY, CAIRO]);
    expect(facts.get(TROY)).toEqual({ classes: [POLIS], worldHeritage: true, statesPopulation: false });
    expect(facts.get(CAIRO)).toEqual({ classes: [], worldHeritage: false, statesPopulation: true });
  });

  it('says which of the items the readership names are sites with a point (ADR-0152)', async () => {
    // Troy is a polis with no point of its own here; the museum is not kept.
    expect(await fetchSitesAmong(door, [TROY, GERASA, BRITISH_MUSEUM], new Set([ARCHAEOLOGICAL_SITE, POLIS]))).toEqual([GERASA]);
  });

  it('says which items it keeps, so one outside it is not read as having no articles', async () => {
    expect(await subsetKeeps([TROY, BRITISH_MUSEUM])).toEqual(new Set([TROY]));
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { fetchFindFacts, fetchSiteFacts } from '../archaeology/queries.js';
import { subsetKeeps } from './archaeology.js';
import { subsetOnlyDoor } from './reader.js';

/**
 * Archaeology's own questions answered from the local subset (#1462), against
 * PostgreSQL, through the fetchers the pipeline calls with the run's subset
 * door, which fails any question that reaches SPARQL. Fixture rows on real
 * items: the Rosetta Stone (Q48584) was found at Fort Julien (Q3077898); Troy
 * (Q22647) is a polis (Q148837) inscribed as World Heritage (P757 849, P1435
 * Q9259) and states its population as no value; Cairo (Q191952) states one.
 * The British Museum (Q6373) is asked about and not kept.
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
];

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  for (const [id, claims] of ENTITIES) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, 0, $2)',
      [id, JSON.stringify({ id, labels: {}, descriptions: {}, claims, sitelinks: {} })]);
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

  it('says which items it keeps, so one outside it is not read as having no articles', async () => {
    expect(await subsetKeeps([TROY, BRITISH_MUSEUM])).toEqual(new Set([TROY]));
  });
});

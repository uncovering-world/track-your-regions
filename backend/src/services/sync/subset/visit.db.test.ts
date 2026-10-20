import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { fetchVisitFacts } from '../visit/visitFacts.js';
import { subsetOnlyDoor } from './reader.js';

/**
 * The visit witnesses' Wikidata question answered from the local subset
 * (#1768), against PostgreSQL, through the fetcher a run calls with its subset
 * door, which fails any question that reaches SPARQL. Fixture rows on real
 * items: the Roman Baths (Q2540426) are a Grade I listed building (P1435
 * Q15700818) with an official website and the Commons category "Roman Baths
 * (Bath)"; Stapleton International Airport (Q1436575) states none of them,
 * and here carries a deprecated website and opening hours of no value, which
 * count for nothing. Rungholt (Q639934) is asked about and not kept.
 */

const door = subsetOnlyDoor();
const BATHS = 'Q2540426';
const STAPLETON = 'Q1436575';
const RUNGHOLT = 'Q639934';
const statement = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({ id, value, ...extra });

const ENTITIES: Array<[string, Record<string, unknown>]> = [
  [BATHS, {
    P1435: [statement('B1', 'Q15700818')],
    P856: [statement('B2', 'http://www.romanbaths.co.uk/')],
    P373: [statement('B3', 'Roman Baths (Bath)')],
  }],
  [STAPLETON, { P856: [statement('S1', 'http://example.org/', { rank: 'deprecated' })], P3025: [statement('S2', { novalue: true })] }],
];

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  for (const [id, claims] of ENTITIES) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, 0, $2)',
      [id, JSON.stringify({ id, labels: {}, descriptions: {}, claims, sitelinks: {} })]);
  }
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  await pool.end();
});

describe('the visit witnesses read from the subset (#1768)', () => {
  it("reads the formal statements and the Commons category, and answers none for a deprecated, a no-value or an unkept item", async () => {
    const facts = await fetchVisitFacts(door, [BATHS, STAPLETON, RUNGHOLT]);
    expect(facts.get(BATHS)).toEqual({ formal: true, commonsCategory: 'Roman Baths (Bath)' });
    expect(facts.get(STAPLETON)).toEqual({ formal: false, commonsCategory: null });
    expect(facts.get(RUNGHOLT)).toEqual({ formal: false, commonsCategory: null });
  });
});

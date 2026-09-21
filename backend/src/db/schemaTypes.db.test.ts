import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { SCALAR_TYPES } from './schemaTypesRender.js';

/**
 * The generated row types claim what `pg` hands back for each Postgres type —
 * `int8` as a string, `timestamptz` as a `Date` — and that claim is
 * `SCALAR_TYPES`, written by hand (ADR-0064). Nothing in the generator checks
 * it: the catalog says which type a column has, and the driver's type parsers
 * decide what arrives. A `pg` release that changed a parser would leave every
 * generated interface wrong while `db:types:check` stayed green.
 *
 * So the claim is checked here, on the live driver, in the lane that runs when
 * `backend/package-lock.json` moves: one value of every mapped type is
 * selected and its JavaScript type compared with the mapping. Driven off
 * `SCALAR_TYPES` itself, so a type added to the map without a sample here
 * fails by name rather than going unchecked.
 */

/** A non-null value of each mapped type, as a SQL expression. */
const SAMPLES: Record<string, string> = {
  int2: '1::int2',
  int4: '1::int4',
  oid: '1::oid',
  float4: '1.5::float4',
  float8: '1.5::float8',
  int8: '9007199254740993::int8',
  numeric: '1.5::numeric',
  bool: 'true',
  varchar: "'a'::varchar",
  bpchar: "'a'::bpchar",
  text: "'a'::text",
  name: "'a'::name",
  uuid: 'gen_random_uuid()',
  daterange: "'[2020-01-01,2020-02-01)'::daterange",
  timestamptz: 'now()',
  timestamp: "now()::timestamp",
  date: 'current_date',
  json: "'{\"a\":1}'::json",
  jsonb: "'{\"a\":1}'::jsonb",
  geometry: 'ST_SetSRID(ST_MakePoint(1, 2), 4326)',
  geography: 'ST_SetSRID(ST_MakePoint(1, 2), 4326)::geography',
};

function describeValue(value: unknown): string {
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

describe('the generated select shape is what the driver delivers', () => {
  afterAll(() => pool.end());

  it('has a sample for every type the generator maps', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(SCALAR_TYPES).sort());
  });

  for (const [udt, expected] of Object.entries(SCALAR_TYPES)) {
    it(`${udt} arrives as ${expected}`, async () => {
      const { rows } = await pool.query<{ v: unknown }>(`SELECT ${SAMPLES[udt]} AS v`);
      const arrived = describeValue(rows[0].v);
      // `unknown` is the generator's word for JSON, which the driver parses
      // into whatever the document was; the sample is an object.
      expect(arrived).toBe(expected === 'unknown' ? 'object' : expected);
    });
  }

  it('an array column arrives as a JavaScript array of the element type', async () => {
    const { rows } = await pool.query<{ codes: unknown; bbox: unknown }>(
      "SELECT ARRAY['DE','FR']::varchar(10)[] AS codes, ARRAY[1.5, 2.5]::float8[] AS bbox",
    );
    expect(rows[0].codes).toEqual(['DE', 'FR']);
    expect(rows[0].bbox).toEqual([1.5, 2.5]);
  });

  it('a Postgres enum arrives as its label', async () => {
    const { rows } = await pool.query<{ role: unknown }>("SELECT 'curator'::user_role AS role");
    expect(rows[0].role).toBe('curator');
  });
});

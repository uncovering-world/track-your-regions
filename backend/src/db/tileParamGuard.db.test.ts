import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';

/**
 * A tile parameter that is not an id is no scope at all (#664), executed
 * against PostgreSQL: Martin publishes these functions on an unauthenticated
 * port, and a bare cast raised on such a value, which Martin answered with
 * HTTP 500 and the database's error text. What is asserted is what the
 * functions return, which only the database can say.
 *
 * An empty tile is what Martin answers as HTTP 204, the answer a request that
 * named nothing already got.
 */

afterAll(async () => {
  await pool.end();
});

async function paramInt(value: unknown): Promise<number | null> {
  const result = await pool.query<{ id: number | null }>(
    'SELECT query_param_int($1::json, $2) AS id',
    [JSON.stringify(value === undefined ? {} : { id: value }), 'id'],
  );
  return result.rows[0].id;
}

/** The byte length of one tile, answered for the given parameters. */
async function tileBytes(source: string, z: number, x: number, y: number, params: Record<string, unknown>): Promise<number> {
  // The source is one of five literal names below, never input.
  const result = await pool.query<{ bytes: number }>(
    `SELECT length(${source}($1, $2, $3, $4::json)) AS bytes`,
    [z, x, y, JSON.stringify(params)],
  );
  return result.rows[0].bytes;
}

describe('query_param_int', () => {
  it.each([
    ['a number sent as text', '42', 42],
    ['a JSON number', 42, 42],
    ["integer's largest value", '2147483647', 2147483647],
  ])('reads %s', async (_name, value, expected) => {
    expect(await paramInt(value)).toBe(expected);
  });

  it.each([
    ['a word', 'abc'],
    ['an empty value, what an unset variable builds', ''],
    ['a fraction', '1.5'],
    ['a sign', '-1'],
    ['a value past integer\'s range', '9999999999'],
    ['eleven digits', '12345678901'],
    ['padding', ' 7'],
  ])('answers NULL for %s rather than raising', async (_name, value) => {
    expect(await paramInt(value)).toBeNull();
  });

  it('answers NULL for a parameter that was not sent', async () => {
    expect(await paramInt(undefined)).toBeNull();
  });
});

describe('query_param_sent', () => {
  it.each([
    ['a value', { id: 'abc' }, true],
    ['an empty value, what an unset variable builds', { id: '' }, false],
    ['no parameter at all', {}, false],
  ])('answers whether %s was sent', async (_name, params, expected) => {
    const result = await pool.query<{ sent: boolean }>(
      'SELECT query_param_sent($1::json, $2) AS sent',
      [JSON.stringify(params), 'id'],
    );
    expect(result.rows[0].sent).toBe(expected);
  });
});

describe('a tile source given a malformed scope answers an empty tile', () => {
  it.each([
    ['tile_world_view_root_regions', 3, 4, 4, { world_view_id: 'abc' }],
    ['tile_world_view_all_leaf_regions', 3, 4, 4, { world_view_id: '' }],
    ['tile_region_subregions', 5, 16, 12, { parent_id: '1.5' }],
    ['tile_gadm_subdivisions', 5, 16, 12, { parent_id: 'abc' }],
    ['tile_region_islands', 5, 16, 12, { world_view_id: 'abc' }],
    // Optional, so its absence means the whole world view; a malformed one
    // narrows to nothing rather than widening to that.
    ['tile_region_islands', 5, 16, 12, { world_view_id: 1, parent_id: 'abc' }],
  ])('%s with %o', async (source, z, x, y, params) => {
    expect(await tileBytes(source, z, x, y, params)).toBe(0);
  });
});

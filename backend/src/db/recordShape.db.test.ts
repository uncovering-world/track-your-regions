import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { hasPinSql, shownByPartsSql } from './readerPredicates.js';

/**
 * A record states its shape (ADR-0218 decisions 1, 2 and 4), against
 * PostgreSQL: the five records the decision is checked on are each stored as
 * what they are, and `experiences_shape_holds` refuses a row whose coordinate
 * its shape does not allow. What gives a record its shape by default is
 * `defaultShape.db.test.ts`'s and `componentParts.db.test.ts`'s.
 *
 * Everything is deleted before and after; the dependants cascade.
 */

const UFFIZI = 924001;
const SQUARE = 924002;
const CANAL = 924003;
const ARC = 924004;
const MATSURI = 924005;
const OTHER = 924010;

const POINT = "ST_SetSRID(ST_MakePoint(11.2553, 43.7678), 4326)";
const OUTLINE = "ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(51.6776, 32.6575), 4326)::geography, 150)::geometry)";
const LINE = "ST_Multi(ST_SetSRID(ST_MakeLine(ST_MakePoint(1.4194, 43.6116), ST_MakePoint(3.6945, 43.3400)), 4326))";

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id BETWEEN 924000 AND 924999');
}

/** One row of `shape`, holding the geometry named: each an SQL expression or NULL. */
function store(id: number, name: string, shape: string | null, held: { location?: string; boundary?: string; path?: string } = {}) {
  return pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, shape, location, boundary, path)
     SELECT $1::int, s.id, 'Q' || $1::text || '001', $2, $3,
            ${held.location ?? 'NULL'}, ${held.boundary ?? 'NULL'}, ${held.path ?? 'NULL'}
       FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, name, shape],
  );
}

beforeEach(clear);

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a record states its shape (ADR-0218)', () => {
  it('stores the five records the decision is checked on, each as what it is', async () => {
    await store(UFFIZI, 'Uffizi Gallery', 'point', { location: POINT });
    await store(SQUARE, 'Naqsh-e Jahan Square', 'area', { boundary: OUTLINE });
    await store(CANAL, 'Canal du Midi', 'line', { path: LINE });
    await store(ARC, 'Struve Geodetic Arc', 'none');
    await store(MATSURI, 'Gion Matsuri', 'none');

    const held = await pool.query(
      `SELECT e.id, e.shape, e.location IS NOT NULL AS coordinate, e.boundary IS NOT NULL AS outline, e.path IS NOT NULL AS line
         FROM experiences e WHERE e.id BETWEEN 924000 AND 924999 ORDER BY e.id`,
    );
    expect(held.rows).toEqual([
      { id: UFFIZI, shape: 'point', coordinate: true, outline: false, line: false },
      { id: SQUARE, shape: 'area', coordinate: false, outline: true, line: false },
      { id: CANAL, shape: 'line', coordinate: false, outline: false, line: true },
      { id: ARC, shape: 'none', coordinate: false, outline: false, line: false },
      { id: MATSURI, shape: 'none', coordinate: false, outline: false, line: false },
    ]);
  });

  it('is a point where nothing states a shape', async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q924001001', 'Uffizi Gallery', ${POINT} FROM experience_sources s WHERE s.name = 'Art Museums'`, [UFFIZI],
    );
    expect((await pool.query('SELECT shape FROM experiences WHERE id = $1', [UFFIZI])).rows[0].shape).toBe('point');
  });

  it('keeps an area or a line its coordinate while it holds no outline or line, and a drawing on any shape', async () => {
    await store(SQUARE, 'Museum Island', 'area', { location: POINT });
    await store(CANAL, 'Ring of Kerry', 'line', { location: POINT });
    // Charles Bridge's line and a dig's outline on a point; an outline on a record of shape none.
    await store(UFFIZI, 'Charles Bridge', 'point', { location: POINT, path: LINE, boundary: OUTLINE });
    await store(ARC, 'Mausoleum of the First Qin Emperor', 'none', { boundary: OUTLINE });
    expect((await pool.query('SELECT count(*)::int AS n FROM experiences WHERE id BETWEEN 924000 AND 924999')).rows[0].n).toBe(4);
  });

  it.each([
    ['a point with no coordinate', 'point', {}],
    ['a point with only an outline', 'point', { boundary: OUTLINE }],
    ['an area with neither a coordinate nor an outline', 'area', {}],
    ['an area with only a line', 'area', { path: LINE }],
    ['a line with neither a coordinate nor a line', 'line', {}],
    ['a line with only an outline', 'line', { boundary: OUTLINE }],
    ['a record of shape none with a coordinate', 'none', { location: POINT }],
  ])('refuses %s', async (_what, shape, held) => {
    await expect(store(OTHER, 'Refused fixture', shape, held)).rejects.toThrow(/experiences_shape_holds/);
  });

  it('refuses a shape outside the four, and a row with none stated', async () => {
    await expect(store(OTHER, 'Refused fixture', 'parts', { location: POINT })).rejects.toThrow(/experiences_shape_check/);
    await expect(store(OTHER, 'Refused fixture', null, { location: POINT })).rejects.toThrow(/null value in column "shape"/);
  });

  it('refuses the coordinate being taken off a point, and put on a record of shape none', async () => {
    await store(UFFIZI, 'Uffizi Gallery', 'point', { location: POINT });
    await store(MATSURI, 'Gion Matsuri', 'none');
    await expect(pool.query('UPDATE experiences SET location = NULL WHERE id = $1', [UFFIZI])).rejects.toThrow(/experiences_shape_holds/);
    await expect(pool.query(`UPDATE experiences SET location = ${POINT} WHERE id = $1`, [MATSURI])).rejects.toThrow(/experiences_shape_holds/);
  });
});

describe('the predicates readers compose (ADR-0218 decision 11)', () => {
  it('finds a serial site shown by its parts with no pin, and a point with a pin', async () => {
    await store(UFFIZI, 'Uffizi Gallery', 'point', { location: POINT });
    await store(ARC, 'Struve Geodetic Arc', 'none');
    const asked = await pool.query(
      `SELECT e.id, ${shownByPartsSql('e')} AS shown_by_parts, ${hasPinSql('e')} AS has_pin
         FROM experiences e WHERE e.id = ANY($1::int[]) ORDER BY e.id`, [[UFFIZI, ARC]],
    );
    expect(asked.rows).toEqual([
      { id: UFFIZI, shown_by_parts: false, has_pin: true },
      { id: ARC, shown_by_parts: true, has_pin: false },
    ]);
  });
});

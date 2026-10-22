import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { filePutBackTypes } from './admission.js';

/**
 * A run files the type of a row a curator put back against its rule's
 * refusal (ADR-0135), executed against PostgreSQL: which rows the statement
 * touches is decided in SQL, by the pin, the claim and the vocabulary.
 *
 * Six memberships of Monuments & memorials, each a fixture of its own: the
 * Victory Arch and the Warsaw Uprising Monument put back with no type and
 * with the old kind's `sculpture`, one put back with a word of the kind
 * already, one whose type a curator claimed, one admitted but not pinned, and
 * one put back into a refusal. Ids are the fixture's own, deleted before and
 * after.
 */

const FIRST = 9460;
const VOCABULARY = ['arch', 'column', 'obelisk', 'memorial', 'monument'];

interface Fixture {
  name: string;
  type: string | null;
  curated: string[];
  admission: 'admitted' | 'refused';
}

const FIXTURES: Fixture[] = [
  { name: 'Victory Arch', type: null, curated: ['admission'], admission: 'admitted' },
  { name: 'Warsaw Uprising Monument', type: 'sculpture', curated: ['admission'], admission: 'admitted' },
  { name: 'A put-back already a memorial', type: 'memorial', curated: ['admission'], admission: 'admitted' },
  { name: 'A put-back whose type a curator claimed', type: null, curated: ['admission', 'type'], admission: 'admitted' },
  { name: 'An admitted row nobody pinned', type: null, curated: [], admission: 'admitted' },
  { name: 'A refusal a curator confirmed', type: null, curated: ['admission'], admission: 'refused' },
];

const qid = (i: number): string => `Q${FIRST + i}-put-back-fixture`;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id BETWEEN $1 AND $2', [FIRST, FIRST + FIXTURES.length - 1]);
}

async function typeOf(i: number): Promise<string | null> {
  return (await pool.query<{ type: string | null }>(
    `SELECT m.type FROM experience_kind_memberships m JOIN experience_sources s ON s.id = m.source_id
      WHERE s.name = 'Monuments & memorials' AND m.external_id = $1`, [qid(i)],
  )).rows[0].type;
}

beforeEach(async () => {
  await clear();
  for (const [i, f] of FIXTURES.entries()) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(21.0, 52.2), 4326)
         FROM experience_sources s WHERE s.name = 'Monuments & memorials'`,
      [FIRST + i, qid(i), f.name],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, type, curated_fields)
       SELECT $1, s.kind_id, s.id, $2, $3::text, $4, $5::jsonb
         FROM experience_sources s WHERE s.name = 'Monuments & memorials'`,
      [FIRST + i, qid(i), f.admission, f.type, JSON.stringify(f.curated)],
    );
  }
});

afterAll(async () => {
  await clear();
});

async function monuments(): Promise<number> {
  return (await pool.query<{ id: number }>(
    `SELECT id FROM experience_sources WHERE name = 'Monuments & memorials'`,
  )).rows[0].id;
}

/** Every fixture refused by the run, each with the type the rule's classes read. */
const RUN_TYPES = ['arch', 'column', 'monument', 'obelisk', 'arch', 'arch'];
const refusals = FIXTURES.map((_, i) => ({ externalId: qid(i), type: RUN_TYPES[i] }));

describe('filePutBackTypes', () => {
  it('files a put-back with no type, or one its kind has no word for, and nothing else', async () => {
    const written = await filePutBackTypes(await monuments(), refusals, VOCABULARY, false);

    expect(written.map((w) => [w.name, w.before, w.type])).toEqual(expect.arrayContaining([
      ['Victory Arch', null, 'arch'],
      ['Warsaw Uprising Monument', 'sculpture', 'column'],
    ]));
    expect(written).toHaveLength(2);
    expect(await Promise.all(FIXTURES.map((_, i) => typeOf(i)))).toEqual([
      'arch', 'column',
      // A word of the kind stands, as a curator's claim does.
      'memorial', null,
      // Only a pinned admission is a put-back: the run refuses the others.
      null, null,
    ]);
  });

  it('says on a preview what it would file and writes nothing', async () => {
    const written = await filePutBackTypes(await monuments(), refusals, VOCABULARY, true);

    expect(written.map((w) => w.name).sort()).toEqual(['Victory Arch', 'Warsaw Uprising Monument']);
    expect(await typeOf(0)).toBeNull();
    expect(await typeOf(1)).toBe('sculpture');
  });

  it('files nothing for a kind with no vocabulary, or a type outside it', async () => {
    expect(await filePutBackTypes(await monuments(), refusals, undefined, false)).toEqual([]);
    expect(await filePutBackTypes(await monuments(), [{ externalId: qid(0), type: 'sculpture' }], VOCABULARY, false))
      .toEqual([]);
    expect(await typeOf(0)).toBeNull();
  });
});

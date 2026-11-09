import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { CONFLICTS, DEITY, subsetSubjectKinds, WAR } from './commemorates.js';

/**
 * What each subject of the reading is, read from the local Wikidata subset
 * (#2144, #2404), against PostgreSQL. The items are real and their
 * statements are fixture rows in the subset's shape: Jesus Christ (Q302) is a
 * human by preference and a deity at normal rank, the Buddha (Q9441) a
 * canonised human, Guan Yin (Q715162) a bodhisattva, a class under deity;
 * World War II (Q362) a world war under war, and the Battle of Berlin
 * (Q154182) a battle under armed conflict, each with its dates. The class
 * edges are the subset's best-rank `P279` claims.
 */

const JESUS = 'Q302';
const BUDDHA = 'Q9441';
const GUAN_YIN = 'Q715162';
const WW2 = 'Q362';
const BERLIN = 'Q154182';
const HUMAN = 'Q5';
const HUMAN_BIBLICAL_FIGURE = 'Q20643955';
const BODHISATTVA = 'Q178149';
const WORLD_WAR = 'Q103495';
const BATTLE = 'Q178561';
const MYTHICAL_CHARACTER = 'Q4271324';
/** The Buddha's canonization status on the subset (2026-11-09): thaumaturge. */
const THAUMATURGE = 'Q1349880';

const time = (iso: string) => ({ time: iso, precision: 11 });

const ENTITIES: Record<string, { label: string; claims: Record<string, unknown[]> }> = {
  [JESUS]: {
    label: 'Jesus Christ',
    claims: {
      P31: [
        { id: `${JESUS}$1`, value: DEITY },
        { id: `${JESUS}$2`, rank: 'preferred', value: HUMAN_BIBLICAL_FIGURE },
        { id: `${JESUS}$3`, rank: 'preferred', value: HUMAN },
      ],
    },
  },
  [BUDDHA]: { label: 'The Buddha', claims: { P31: [{ id: `${BUDDHA}$1`, value: HUMAN }], P411: [{ id: `${BUDDHA}$2`, value: THAUMATURGE }] } },
  [GUAN_YIN]: { label: 'Guan Yin', claims: { P31: [{ id: `${GUAN_YIN}$1`, value: BODHISATTVA }] } },
  // A class the subset holds at deprecated rank only names nothing.
  [MYTHICAL_CHARACTER]: { label: 'mythical character', claims: { P31: [{ id: `${MYTHICAL_CHARACTER}$1`, rank: 'deprecated', value: DEITY }] } },
  [WW2]: {
    label: 'World War II',
    claims: {
      P31: [{ id: `${WW2}$1`, value: WORLD_WAR }],
      P580: [{ id: `${WW2}$2`, value: time('+1939-09-01T00:00:00Z') }],
      P582: [{ id: `${WW2}$3`, value: time('+1945-09-02T00:00:00Z') }],
    },
  },
  [BERLIN]: {
    label: 'Battle of Berlin',
    claims: {
      P31: [{ id: `${BERLIN}$1`, value: BATTLE }],
      P580: [{ id: `${BERLIN}$2`, value: time('+1945-04-16T00:00:00Z') }],
      P582: [{ id: `${BERLIN}$3`, value: time('+1945-05-02T00:00:00Z') }],
    },
  },
};

/** The statement ids of this spec's subclass edges, by which it deletes them and nothing else. */
const EDGE = '%$commemorates-db-%';

async function subclass(subject: string, value: string, n: number): Promise<void> {
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item) VALUES ($1, 'P279', $2, 0, $3)`,
    [subject, `${subject}$commemorates-db-${n}`, value],
  );
}

/** This spec's rows and no other: its entities and their labels, and its subclass edges. */
async function deleteFixture(): Promise<void> {
  const ids = Object.keys(ENTITIES);
  await pool.query('DELETE FROM wikidata_labels WHERE id = ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM wikidata_entities WHERE id = ANY($1::text[])', [ids]);
  await pool.query(`DELETE FROM wikidata_claims WHERE property = 'P279' AND statement_id LIKE $1`, [EDGE]);
}

beforeAll(async () => {
  await deleteFixture();
  for (const [id, { label, claims }] of Object.entries(ENTITIES)) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, 0, $2)', [id, JSON.stringify({ claims })]);
    await pool.query(`INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', $2)`, [id, label]);
  }
  await subclass(BODHISATTVA, DEITY, 1);
  await subclass(WORLD_WAR, WAR, 2);
  await subclass(WAR, CONFLICTS[0], 3);
  await subclass(BATTLE, CONFLICTS[0], 4);
});

afterAll(async () => {
  await deleteFixture();
  await pool.end();
});

describe('what a subject of the reading is, read from the subset (#2404)', () => {
  it('reads a holy figure by a deity class at any rank but deprecated, by a class under deity, and by canonisation', async () => {
    const kinds = await subsetSubjectKinds([JESUS, BUDDHA, GUAN_YIN, MYTHICAL_CHARACTER]);
    expect([kinds.get(JESUS)?.holy, kinds.get(JESUS)?.human]).toEqual([true, true]);
    expect(kinds.get(BUDDHA)?.holy).toBe(true);
    expect([kinds.get(GUAN_YIN)?.holy, kinds.get(GUAN_YIN)?.human]).toEqual([true, false]);
    expect(kinds.get(MYTHICAL_CHARACTER)?.holy).toBe(false);
  });

  it('reads a war, a conflict within it and the dates of each', async () => {
    const kinds = await subsetSubjectKinds([WW2, BERLIN]);
    expect(kinds.get(WW2)).toMatchObject({ war: true, conflict: true, event: true, span: { from: 19390901, to: 19450902 } });
    expect(kinds.get(BERLIN)).toMatchObject({ war: false, conflict: true, span: { from: 19450416, to: 19450502 } });
    expect(kinds.get(JESUS)).toBeUndefined();
  });
});

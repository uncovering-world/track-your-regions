import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { subsetItemsOfGenres, subsetRootsOfClasses, subsetStreetArtMarks } from './streetArt.js';

/**
 * The street-art places' questions answered from the local subset (#2035),
 * against PostgreSQL: the Lennon Wall in Prague, filed under graffiti with an
 * Atlas Obscura entry; Hosier Lane, filed under street art by a preferred
 * statement beside a normal one; 5 Pointz, dissolved; and fixture items
 * (Q2035xx) for a genre stated only as deprecated and an end stated as no
 * value. The class tree names a cathedral under a structure of worship.
 */
const STREET_ART = 'Q17516';
const GRAFFITI = 'Q17514';
const LENNON_WALL = 'Q1630131';
const HOSIER_LANE = 'Q5908090';
const FIVE_POINTZ = 'Q904023';
const DEPRECATED_GENRE = 'Q203501';
const NO_END = 'Q203502';
const WORSHIP = 'Q1370598';
const CATHEDRAL = 'Q2977';
const CHURCH = 'Q16970';
const WALL = 'Q42948';

const statement = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({ id, value, ...extra });

const ENTITIES: Array<[string, Record<string, Array<{ id: string; value: unknown; rank?: string }>>]> = [
  [LENNON_WALL, { P31: [statement('L1', WALL)], P136: [statement('L2', GRAFFITI)], P7772: [statement('L3', 'lennon-wall')] }],
  // The preferred genre outranks the normal one beside it.
  [HOSIER_LANE, { P136: [statement('H1', STREET_ART, { rank: 'preferred' }), statement('H2', 'Q3305213')] }],
  [FIVE_POINTZ, {
    P136: [statement('F1', GRAFFITI)],
    P576: [statement('F2', { time: '+2014-01-01T00:00:00Z', precision: 9 })],
    P7772: [statement('F3', '5-pointz', { rank: 'deprecated' })],
  }],
  [DEPRECATED_GENRE, { P136: [statement('D1', STREET_ART, { rank: 'deprecated' })] }],
  [NO_END, { P576: [statement('N1', { novalue: true })] }],
];

/** Materialise the fixture's claims with the ranks its compact entities carry. */
async function seed(id: string, claims: Record<string, Array<{ id: string; value: unknown; rank?: string }>>): Promise<void> {
  const ranks: Record<string, number> = { preferred: 1, normal: 0, deprecated: -1 };
  await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, $2, $3)',
    [id, 1, JSON.stringify({ id, labels: {}, descriptions: {}, claims, sitelinks: {} })]);
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
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_class_closure');
  for (const [id, claims] of ENTITIES) await seed(id, claims);
  await pool.query(
    `INSERT INTO wikidata_class_closure (class, ancestor) VALUES ($1, $1), ($1, $2), ($1, $3), ($2, $2), ($2, $3), ($3, $3), ($4, $4)`,
    [CATHEDRAL, CHURCH, WORSHIP, WALL],
  );
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_class_closure');
  await pool.end();
});

describe('the street-art places read from the subset (#2035)', () => {
  it('names the items filed under a genre by best rank', async () => {
    expect(await subsetItemsOfGenres([STREET_ART, GRAFFITI])).toEqual([FIVE_POINTZ, LENNON_WALL, HOSIER_LANE].sort());
    expect(await subsetItemsOfGenres([STREET_ART])).toEqual([HOSIER_LANE]);
    expect(await subsetItemsOfGenres([])).toEqual([]);
  });

  it('reads an Atlas Obscura entry and an end, never a deprecated or no-value one', async () => {
    const marks = await subsetStreetArtMarks([LENNON_WALL, HOSIER_LANE, FIVE_POINTZ, NO_END, 'Q999999']);
    expect(Object.fromEntries(marks)).toEqual({
      [LENNON_WALL]: { atlasObscura: true, ended: false },
      [HOSIER_LANE]: { atlasObscura: false, ended: false },
      [FIVE_POINTZ]: { atlasObscura: false, ended: true },
      [NO_END]: { atlasObscura: false, ended: false },
    });
  });

  it('names the roots each class is a kind of, a root counting as a kind of itself', async () => {
    const roots = await subsetRootsOfClasses([CATHEDRAL, WORSHIP, WALL], [WORSHIP, 'Q16560']);
    expect(Object.fromEntries(roots)).toEqual({ [CATHEDRAL]: [WORSHIP], [WORSHIP]: [WORSHIP] });
    expect((await subsetRootsOfClasses([], [WORSHIP])).size).toBe(0);
  });
});

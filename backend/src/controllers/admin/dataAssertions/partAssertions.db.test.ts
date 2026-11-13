import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { partAssertions } from './partAssertions.js';

/**
 * The part rules (#2119), against PostgreSQL.
 *
 * The fixture is the Rainforests of the Atsinanana as the World Heritage run
 * leaves them: Masoala's parcels, each a part carrying the national park's
 * Wikidata item, two of them 5 km apart, and a copy of one parcel's line
 * standing on the parcel itself. Ids are the fixture's own, deleted before and
 * after.
 */

const SITE = 9680;
const NORTH = 9681;
const SOUTH = 9682;
const COPY = 9683;
const UNREAD = 9684;
const LOWER = 9685;
const LOWEST = 9686;
const PLACES = [SITE, NORTH, SOUTH, COPY, UNREAD, LOWER, LOWEST];
const PARK = 'Q9680001';
const COMPONENTS_SOURCE = 10;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
}

/** A parcel at a latitude off Masoala's, its record in the site under `reference` carrying the park's item. */
async function parcel(
  id: number, reference: string, lat: number, point: { state?: 'auto' | 'pending'; withdrawn?: boolean } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(50.0, $4), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [id, `part:${id}`, `Parc National de Masoala (${id})`, lat],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state, missing_since)
     VALUES ($1, 'Parc National de Masoala', $2, ST_SetSRID(ST_MakePoint(50.0, $3), 4326), $4, CASE WHEN $5 THEN NOW() END)`,
    [id, reference, lat, point.state ?? 'auto', point.withdrawn ?? false],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, wikidata_items)
     VALUES ($1, $2, $3, $4, ARRAY[$5])`,
    [id, SITE, COMPONENTS_SOURCE, reference, PARK],
  );
}

async function rowsOf(id: string): Promise<Array<Record<string, unknown>>> {
  const rule = partAssertions.find(assertion => assertion.id === id)!;
  return (await pool.query<Record<string, unknown>>(rule.sql)).rows.filter(row => Number(row.whole_id) === SITE);
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, '9680', 'Rainforests of the Atsinanana (parts fixture)', ST_SetSRID(ST_MakePoint(49.5, -15.5), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [SITE],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9680', 'auto', NOW() FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [SITE],
  );
  // About 5.5 km apart.
  await parcel(NORTH, '9680-001', -15.45);
  await parcel(SOUTH, '9680-002', -15.50);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('one Wikidata item on parts of one site far apart', () => {
  it('lists the item with the parts a reader is shown, and the distance', async () => {
    // A third parcel whose point nobody has published is not asked about.
    await parcel(UNREAD, '9680-003', -15.60, { state: 'pending' });

    const rows = await rowsOf('item-on-far-parts');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item: PARK, parts: [`Parc National de Masoala (${NORTH}) (#${NORTH})`, `Parc National de Masoala (${SOUTH}) (#${SOUTH})`] });
    expect(Number(rows[0].metres)).toBeGreaterThan(5000);
    expect(partAssertions.find(a => a.id === 'item-on-far-parts')!.describe(rows[0])).toMatch(/ up to 5\.\d km apart, /);
  });

  it("keeps listing the item while a curator has said only which part it names, and drops it once the other part is answered", async () => {
    await pool.query(
      `INSERT INTO place_identifier_verdicts (experience_id, scheme, value, verdict) VALUES ($1, 'wikidata', $2, 'identifies')`,
      [NORTH, PARK],
    );
    expect(await rowsOf('item-on-far-parts')).toHaveLength(1);

    await pool.query(
      `INSERT INTO place_identifier_verdicts (experience_id, scheme, value, verdict) VALUES ($1, 'wikidata', $2, 'removed')`,
      [SOUTH, PARK],
    );
    expect(await rowsOf('item-on-far-parts')).toEqual([]);
  });
});

describe('two parts of one site under one reference at one spot', () => {
  it('lists a copy of a line, hidden or not, and stops once its point is turned down', async () => {
    expect(await rowsOf('parts-of-one-whole-at-one-spot')).toEqual([]);

    // The copy a run left: pending, withdrawn, on the parcel itself.
    await parcel(COPY, '9680-001', -15.45, { state: 'pending', withdrawn: true });
    const rows = await rowsOf('parts-of-one-whole-at-one-spot');
    expect(rows).toMatchObject([{ reference: '9680-001', first_id: NORTH, second_id: COPY }]);
    expect(partAssertions.find(a => a.id === 'parts-of-one-whole-at-one-spot')!.describe(rows[0]))
      .toBe(`Rainforests of the Atsinanana (parts fixture) (#${SITE}), 9680-001: `
        + `Parc National de Masoala (${NORTH}) (#${NORTH}) and Parc National de Masoala (${COPY}) (#${COPY}), 0 m apart`);

    await pool.query('UPDATE experience_locations SET refused_at = NOW() WHERE experience_id = $1', [COPY]);
    expect(await rowsOf('parts-of-one-whole-at-one-spot')).toEqual([]);
  });
});

describe('a loop of parts, or a chain over four places (#2118)', () => {
  /** A curator's record making `part` a part of `whole`, written as the card's writer writes it. */
  async function curatorPart(whole: number, part: number): Promise<void> {
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, admission, curation_state, published_at)
       VALUES ($1, $2, 11, $3, 'admitted', 'verified', NOW())`,
      [part, whole, `curator-1-${whole}${part}`],
    );
  }
  const rule = partAssertions.find(assertion => assertion.id === 'parts-in-a-loop-or-too-deep')!;
  const chainRows = async () => (await pool.query<Record<string, unknown>>(rule.sql)).rows
    .filter(row => PLACES.includes(Number(row.whole_id)));

  it('names a chain seven places deep once, from its top, with its true depth', async () => {
    expect(await chainRows()).toEqual([]);
    await parcel(COPY, '9680-004', -15.70);
    await parcel(UNREAD, '9680-005', -15.80);
    await parcel(LOWER, '9680-006', -15.90);
    await parcel(LOWEST, '9680-007', -16.00);
    // The site over its parcel, and each parcel over the next.
    await curatorPart(NORTH, SOUTH);
    await curatorPart(SOUTH, COPY);
    await curatorPart(COPY, UNREAD);
    await curatorPart(UNREAD, LOWER);
    await curatorPart(LOWER, LOWEST);
    const rows = await chainRows();
    expect(rows).toMatchObject([{ whole_id: SITE, loop: false, places: 7 }]);
    expect(rule.describe(rows[0])).toMatch(/^7 places deep: Rainforests of the Atsinanana \(parts fixture\) \(#9680\) › /);
  });

  it('names a loop as long as the walk goes, 32 places, once', async () => {
    const ring = Array.from({ length: 32 }, (_, i) => 96801 + i);
    try {
      await pool.query(
        `INSERT INTO experiences (id, source_id, external_id, name, location)
         SELECT id, 11, 'curator-1-' || id, 'Ring ' || id, ST_SetSRID(ST_MakePoint(50.0, -15.0), 4326)
           FROM unnest($1::int[]) AS id`,
        [ring],
      );
      // Each place a part of the one before it, the first of the last.
      await pool.query(
        `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, admission, curation_state, published_at)
         SELECT part, whole, 11, 'curator-1-' || whole || part, 'admitted', 'verified', NOW()
           FROM unnest($1::int[], $2::int[]) AS pair(whole, part)`,
        [ring, [...ring.slice(1), ring[0]]],
      );
      const rows = (await pool.query<Record<string, unknown>>(rule.sql)).rows
        .filter(row => ring.includes(Number(row.whole_id)));
      expect(rows).toMatchObject([{ whole_id: ring[0], loop: true, places: 32 }]);
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [ring]);
    }
  });

  it('names a loop of three places once', async () => {
    await parcel(COPY, '9680-004', -15.70);
    await curatorPart(NORTH, SOUTH);
    await curatorPart(SOUTH, COPY);
    await curatorPart(COPY, NORTH);
    const rows = await chainRows();
    expect(rows).toMatchObject([{ whole_id: NORTH, loop: true, places: 3 }]);
    expect(rule.describe(rows[0])).toBe(
      `A loop of 3 places: Parc National de Masoala (${NORTH}) (#${NORTH}) › Parc National de Masoala (${SOUTH}) (#${SOUTH}) › `
      + `Parc National de Masoala (${COPY}) (#${COPY}) › Parc National de Masoala (${NORTH}) (#${NORTH})`,
    );
  });
});

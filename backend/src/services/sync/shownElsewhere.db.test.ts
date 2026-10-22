import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { placesOtherSourcesOffer, worksShownByOtherSources } from './shownElsewhere.js';

/**
 * The works another kind already shows a reader, read by a kind that would take
 * a museum only for a find (ADR-0103), executed against PostgreSQL: the Venus
 * de' Medici on the Uffizi's art-museum card is shown; the same statue is not
 * while the Uffizi waits on its curator, nor while its link does, nor where
 * only the asking source offers the place. Ids are the fixture's own, deleted
 * before and after.
 */

const UFFIZI = 951252;
const UFFIZI_QID = 'Q51252-shown-fixture';
const VENUS_QID = 'Q774967-shown-fixture';

let artMuseums = 0;
let archaeology = 0;
let venus = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [UFFIZI]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [VENUS_QID]);
}

async function member(sourceId: number, state: 'pending' | 'auto' = 'auto'): Promise<void> {
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state)
     SELECT $1, s.kind_id, s.id, $2, 'admitted', $3 FROM experience_sources s WHERE s.id = $4`,
    [UFFIZI, UFFIZI_QID, state, sourceId],
  );
}

beforeEach(async () => {
  await clear();
  const ids = (await pool.query<{ id: number; name: string }>(
    "SELECT id, name FROM experience_sources WHERE name IN ('Art Museums', 'Archaeology')",
  )).rows;
  artMuseums = ids.find((s) => s.name === 'Art Museums')!.id;
  archaeology = ids.find((s) => s.name === 'Archaeology')!.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Uffizi Gallery (fixture)', ST_SetSRID(ST_MakePoint(11.2553, 43.7678), 4326))`,
    [UFFIZI, artMuseums, UFFIZI_QID],
  );
  venus = (await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type, sitelinks_count) VALUES ($1, 'Venus de'' Medici', 'statue', 25) RETURNING id`,
    [VENUS_QID],
  )).rows[0].id;
});

async function link(state: 'pending' | 'auto' = 'auto'): Promise<void> {
  await pool.query(
    'INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, $3)',
    [UFFIZI, venus, state],
  );
}

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the works another kind shows a reader (ADR-0103)', () => {
  it('names a work on the card of a museum another source offers', async () => {
    await member(artMuseums);
    await link();
    expect((await worksShownByOtherSources(archaeology)).has(VENUS_QID)).toBe(true);
  });

  it('does not name it while the museum waits on its curator', async () => {
    await member(artMuseums, 'pending');
    await link();
    expect((await worksShownByOtherSources(archaeology)).has(VENUS_QID)).toBe(false);
  });

  it('does not name it while its link waits on a curator', async () => {
    await member(artMuseums);
    await link('pending');
    expect((await worksShownByOtherSources(archaeology)).has(VENUS_QID)).toBe(false);
  });

  it('does not count a place only the asking source offers', async () => {
    await member(archaeology);
    await link();
    expect((await worksShownByOtherSources(archaeology)).has(VENUS_QID)).toBe(false);
  });
});

describe('the places other sources offer (#1444)', () => {
  it('names a place another source offers through an admitted, passed membership', async () => {
    await member(artMuseums);
    expect((await placesOtherSourcesOffer([archaeology])).has(UFFIZI_QID)).toBe(true);
  });

  it('does not name a place waiting on its curator', async () => {
    await member(artMuseums, 'pending');
    expect((await placesOtherSourcesOffer([archaeology])).has(UFFIZI_QID)).toBe(false);
  });

  it("does not name the asking source's own places", async () => {
    await member(artMuseums);
    expect((await placesOtherSourcesOffer([artMuseums])).has(UFFIZI_QID)).toBe(false);
  });

  it('does not name a place a sibling source of the asking pass offers (ADR-0132)', async () => {
    await member(artMuseums);
    expect((await placesOtherSourcesOffer([archaeology, artMuseums])).has(UFFIZI_QID)).toBe(false);
  });
});

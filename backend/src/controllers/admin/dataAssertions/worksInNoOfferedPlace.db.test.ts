import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { workAssertions } from './workAssertions.js';

/**
 * The watch on places no kind offers that hold a famous work no kind shows
 * (#1821), against PostgreSQL: the Voynich manuscript at the Beinecke Library,
 * which no kind holds, is listed under the library; a work an offered place
 * shows, a work offered as a place of its own, and a work under the fame line
 * are not. Ids and items are the fixture's own, deleted before and after.
 */

const LIBRARY = 'Q814779-fixture';
const VOYNICH = 'Q179492-fixture';
const MINOR = 'Q1-minor-fixture';
const OWN_PLACE = 'Q9202-fixture';
const OWN_PLACE_ID = 9971;
const LIBRARY_PLACE_ID = 9972;
const TOWN = 'Q1726-fixture';
const CITY_CLASS = 'Q515-fixture';

const check = workAssertions.find(a => a.id === 'works-in-no-offered-place')!;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM workbench.gathered_work_venues WHERE work_qid LIKE $1', ['%-fixture']);
  await pool.query('DELETE FROM workbench.wikidata_claims WHERE subject = $1', [TOWN]);
  await pool.query('DELETE FROM workbench.wikidata_class_closure WHERE class = $1', [CITY_CLASS]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[OWN_PLACE_ID, LIBRARY_PLACE_ID]]);
}

async function venue(work: string, label: string, sitelinks: number, at = LIBRARY): Promise<void> {
  await pool.query(
    `INSERT INTO workbench.gathered_work_venues (work_qid, work_label, sitelinks, venue_qid, property) VALUES ($1, $2, $3, $4, 'P195')`,
    [work, label, sitelinks, at],
  );
}

const listed = async () => (await pool.query(check.sql)).rows.filter(row => row.venue_qid === LIBRARY);

beforeEach(async () => {
  await clear();
  await venue(VOYNICH, 'Voynich manuscript', 67);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('places no kind offers that hold a famous work no kind shows (#1821)', () => {
  it('lists the place under its item, with the famous work it holds', async () => {
    const rows = await listed();
    expect(rows).toEqual([expect.objectContaining({ works: 1, top_sitelinks: 67, work_names: 'Voynich manuscript' })]);
    expect(check.describe(rows[0])).toContain('holds 1 famous work(s) no kind shows: Voynich manuscript');
  });

  it('leaves out a work under the fame line', async () => {
    await pool.query('DELETE FROM workbench.gathered_work_venues WHERE work_qid = $1', [VOYNICH]);
    await venue(MINOR, 'A minor codex', 19);
    expect(await listed()).toEqual([]);
  });

  it('leaves out a venue offered under another key, identified by its item in the registry', async () => {
    // As a World Heritage site is: its membership keyed by its listing, its item an identifying registry row.
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, 2, 'listing-fixture', 'Beinecke Library (fixture)', ST_SetSRID(ST_MakePoint(-72.93, 41.31), 4326))`,
      [LIBRARY_PLACE_ID],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'listing-fixture', 'admitted', 'auto', NOW() FROM experience_sources s WHERE s.id = 2`,
      [LIBRARY_PLACE_ID],
    );
    expect(await listed()).toHaveLength(1);
    await pool.query(
      `INSERT INTO place_identifiers (experience_id, scheme, value, identifies, claims_identity, basis)
       VALUES ($1, 'wikidata', $2, TRUE, TRUE, ARRAY['fixture'])`,
      [LIBRARY_PLACE_ID, LIBRARY],
    );
    expect(await listed()).toEqual([]);
  });

  it('leaves out a venue that is a town: where a statement put the work, not a place to visit', async () => {
    // Munich, for the Carmina Burana: an instance of a class the subset's closure puts under human settlement.
    await venue('Q157150-fixture', 'Carmina Burana', 43, TOWN);
    await pool.query(
      `INSERT INTO workbench.wikidata_claims (subject, property, statement_id, rank, value_item) VALUES ($1, 'P31', $1 || '-p31', 1, $2)`,
      [TOWN, CITY_CLASS],
    );
    await pool.query(`INSERT INTO workbench.wikidata_class_closure (class, ancestor) VALUES ($1, 'Q486972')`, [CITY_CLASS]);
    const rows = (await pool.query(check.sql)).rows;
    expect(rows.filter(row => row.venue_qid === TOWN)).toEqual([]);
    expect(rows.filter(row => row.venue_qid === LIBRARY)).toHaveLength(1);
  });

  it('leaves out a work offered as a place of its own', async () => {
    await venue(OWN_PLACE, 'Statue of Liberty', 150);
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, 3, $2, 'Statue of Liberty', ST_SetSRID(ST_MakePoint(-74.04, 40.69), 4326))`,
      [OWN_PLACE_ID, OWN_PLACE],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, $2, 'admitted', 'auto', NOW() FROM experience_sources s WHERE s.id = 3`,
      [OWN_PLACE_ID, OWN_PLACE],
    );
    const rows = await listed();
    expect(rows).toEqual([expect.objectContaining({ works: 1, work_names: 'Voynich manuscript' })]);
  });
});

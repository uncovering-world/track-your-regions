import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { lockIdentifiedPlace } from '../../db/experienceWriter.js';
import { identifierAssertions } from '../admin/dataAssertions/identifierAssertions.js';
import { joinPlacesClaimingOneItem } from './equalItemMerges.js';
import { mergePlaces, ONE_WHOLE_REFUSAL, undoMerge, WHOLE_REFUSAL } from './placeMerge.js';

/**
 * A place made of parts is never merged with anything, and claims no Wikidata
 * item (ADR-0203, #2119), against PostgreSQL.
 *
 * The fixture is Baalbek as the catalogue held it: a World Heritage site of one
 * point of its own, its one item recorded on its membership, and an
 * Archaeology place for the same item, standing 415 m away. The site becomes
 * a place made of parts when its list gives it components (the Temple of
 * Mercury, the sanctuary), each a part with its record in the site. A second
 * site with one part of its own stands for another whole a part may also be
 * one place with.
 */

const SITE = 9580;
const ARCHAEOLOGY = 9581;
const TEMPLE = 9582;
const SANCTUARY = 9583;
const OTHER_SITE = 9584;
const OTHER_PART = 9585;
const PLACES = [SITE, ARCHAEOLOGY, TEMPLE, SANCTUARY, OTHER_SITE, OTHER_PART];
const ITEM = 'Q9580001';
const COMPONENTS_SOURCE = 10;
const CURATOR = '00000000-0000-4000-8000-000000009580';

let curatorId = 0;
let heritage: { id: number; kind_id: number };
let archaeology: { id: number; kind_id: number };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1::int[]) OR folded_id = ANY($1::int[])', [PLACES]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1::int[])', [PLACES]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

/** A place with one point of its own, at a longitude off Baalbek's 36.2. */
async function place(id: number, source: { id: number }, externalId: string, name: string, lon: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, 34.0), 4326))`,
    [id, source.id, externalId, name, lon],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, 34.0), 4326))`,
    [id, name, externalId, lon],
  );
}

async function kindRecord(placeId: number, source: { id: number; kind_id: number }, externalId: string, items: string[] | null = null) {
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, wikidata_items, curation_state, published_at)
     VALUES ($1, $2, $3, $4, $5, 'auto', NOW())`,
    [placeId, source.kind_id, source.id, externalId, items],
  );
}

/** Make each place a part of its whole, in one statement, as a run's record in the whole does. */
async function makeParts(parts: Array<[part: number, whole: number, ref: string]>): Promise<void> {
  await pool.query(
    `INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
     SELECT p.part, p.whole, $2, p.ref FROM jsonb_to_recordset($1::jsonb) AS p(part int, whole int, ref text)`,
    [JSON.stringify(parts.map(([part, whole, ref]) => ({ part, whole, ref }))), COMPONENTS_SOURCE],
  );
}

/** The registry's rows for the item, as `place:identifies`. */
async function held(): Promise<string[]> {
  return (await pool.query<{ row: string }>(
    `SELECT experience_id || ':' || CASE WHEN identifies THEN 'identifies' ELSE 'refers' END AS row
       FROM place_identifiers WHERE scheme = 'wikidata' AND value = $1 ORDER BY experience_id`,
    [ITEM],
  )).rows.map(r => r.row);
}

/** Whether the registry holds the item as its columns derive it. */
async function inStep(): Promise<boolean> {
  const differing = await pool.query(
    `SELECT 1 FROM place_identifiers_expected('wikidata', ARRAY[$1]) x
       FULL JOIN (SELECT * FROM place_identifiers WHERE scheme = 'wikidata' AND value = $1) pi
         ON pi.experience_id = x.experience_id
      WHERE x.experience_id IS NULL OR pi.experience_id IS NULL
         OR (x.identifies, x.claims_identity, x.basis) IS DISTINCT FROM (pi.identifies, pi.claims_identity, pi.basis)`,
    [ITEM],
  );
  return differing.rowCount === 0;
}

const foldedInto = async (id: number) => (await pool.query<{ merged_into_id: number | null }>(
  'SELECT merged_into_id FROM experiences WHERE id = $1', [id],
)).rows[0].merged_into_id;

const wholesOf = async (part: number) => (await pool.query<{ whole_id: number }>(
  'SELECT whole_id FROM experience_parts WHERE part_id = $1 ORDER BY whole_id', [part],
)).rows.map(row => row.whole_id);

/** The check's rows for this fixture's merges. */
async function mergesOntoAWhole(): Promise<Array<{ merge_id: number; line: string }>> {
  const check = identifierAssertions.find(assertion => assertion.id === 'merge-onto-a-whole')!;
  const rows = (await pool.query<Record<string, unknown>>(check.sql)).rows
    .filter(row => PLACES.includes(Number(row.survivor_id)));
  return rows.map(row => ({ merge_id: Number(row.merge_id), line: check.describe(row) }));
}

beforeEach(async () => {
  await clear();
  const source = async (name: string) => (await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1', [name],
  )).rows[0];
  heritage = await source('UNESCO World Heritage Sites');
  archaeology = await source('Archaeology');
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await place(SITE, heritage, '9580', 'Baalbek (whole merge fixture)', 36.2040);
  await kindRecord(SITE, heritage, '9580', [ITEM]);
  await place(TEMPLE, heritage, '9580-002', 'Temple of Mercury', 36.2050);
  await place(SANCTUARY, heritage, '9580-003', 'Monumental sanctuary', 36.2030);
  await place(OTHER_SITE, heritage, '9584', 'Another site (whole merge fixture)', 36.3);
  await kindRecord(OTHER_SITE, heritage, '9584');
  await place(OTHER_PART, heritage, '9584-001', 'A part of another site', 36.2051);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a place made of parts claims no Wikidata item (ADR-0203)', () => {
  it('lets a site of one point claim its item until the site is made of parts, and again once its last part goes', async () => {
    expect(await held()).toEqual([`${SITE}:identifies`]);

    // The list gives the site two components in one write: the statement made the site a whole.
    await makeParts([[TEMPLE, SITE, '9580-002'], [SANCTUARY, SITE, '9580-003']]);
    expect(await wholesOf(TEMPLE)).toEqual([SITE]);
    expect(await held()).toEqual([`${SITE}:refers`]);
    expect(await inStep()).toBe(true);

    // One component goes: still a whole.
    await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2', [SANCTUARY, SITE]);
    expect(await held()).toEqual([`${SITE}:refers`]);

    // The last one goes: a site of one point again.
    await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2', [TEMPLE, SITE]);
    expect(await held()).toEqual([`${SITE}:identifies`]);
    expect(await inStep()).toBe(true);
  });

  it("gives a run reading the site's item no place to join once the site is made of parts", async () => {
    const lookup = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        return (await lockIdentifiedPlace(client, archaeology.id, [ITEM]))?.id ?? null;
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };
    expect(await lookup()).toBe(SITE);

    await makeParts([[TEMPLE, SITE, '9580-002']]);
    expect(await lookup()).toBeNull();
  });

  it("leaves a place made of parts and a kind's place on its item apart in the catalogue's join", async () => {
    await makeParts([[TEMPLE, SITE, '9580-002']]);
    await place(ARCHAEOLOGY, archaeology, ITEM, 'Baalbek', 36.2079);
    await kindRecord(ARCHAEOLOGY, archaeology, ITEM);
    // The kind's place is the item's one claimant, so it is the item's place.
    expect(await held()).toEqual([`${SITE}:refers`, `${ARCHAEOLOGY}:identifies`]);

    expect(await joinPlacesClaimingOneItem([ITEM])).toEqual({ merged: [], refused: [] });
    expect(await foldedInto(ARCHAEOLOGY)).toBeNull();
  });
});

describe('a merge never joins a place made of parts (ADR-0203)', () => {
  beforeEach(async () => {
    await place(ARCHAEOLOGY, archaeology, ITEM, 'Baalbek', 36.2079);
    await kindRecord(ARCHAEOLOGY, archaeology, ITEM);
  });

  it('refuses it as the place that stays and as the one folded, and changes nothing', async () => {
    await makeParts([[TEMPLE, SITE, '9580-002']]);

    for (const [survivorId, foldedId] of [[SITE, ARCHAEOLOGY], [ARCHAEOLOGY, SITE]]) {
      const outcome = await mergePlaces({ survivorId, foldedId, mergedBy: curatorId, reason: 'curator' });
      expect(outcome.refusal).toEqual({ status: 409, error: WHOLE_REFUSAL });
    }
    expect([await foldedInto(SITE), await foldedInto(ARCHAEOLOGY)]).toEqual([null, null]);
    const records = await pool.query('SELECT 1 FROM source_records WHERE experience_id = $1', [ARCHAEOLOGY]);
    expect(records.rowCount).toBe(1);
  });

  it('refuses two parts of one whole', async () => {
    await makeParts([[TEMPLE, SITE, '9580-002'], [SANCTUARY, SITE, '9580-003']]);

    const outcome = await mergePlaces({ survivorId: TEMPLE, foldedId: SANCTUARY, mergedBy: curatorId, reason: 'curator' });

    expect(outcome.refusal).toEqual({ status: 409, error: ONE_WHOLE_REFUSAL });
    expect(await foldedInto(SANCTUARY)).toBeNull();
  });

  it('merges parts of two wholes, each keeping its record in its own whole, and undoes it', async () => {
    await makeParts([[TEMPLE, SITE, '9580-002'], [OTHER_PART, OTHER_SITE, '9584-001']]);

    const outcome = await mergePlaces({ survivorId: TEMPLE, foldedId: OTHER_PART, mergedBy: curatorId, reason: 'curator' });
    expect(outcome.refusal).toBeUndefined();
    expect(await wholesOf(TEMPLE)).toEqual([SITE, OTHER_SITE]);
    expect(await wholesOf(OTHER_PART)).toEqual([]);

    expect((await undoMerge(outcome.result!.mergeId, curatorId)).refusal).toBeUndefined();
    expect(await wholesOf(TEMPLE)).toEqual([SITE]);
    expect(await wholesOf(OTHER_PART)).toEqual([OTHER_SITE]);
  });

  it('refuses a merge that waited on the lock while the site was made a place of parts', async () => {
    const other = await pool.connect();
    let merging: ReturnType<typeof mergePlaces> | undefined;
    try {
      // The site's run holds the site's lock while it writes its first component.
      await other.query('BEGIN');
      await other.query('SELECT id FROM experiences WHERE id = $1 FOR NO KEY UPDATE', [SITE]);
      merging = mergePlaces({ survivorId: SITE, foldedId: ARCHAEOLOGY, mergedBy: null, reason: 'equal_wikidata_item' });
      for (let tries = 0; tries < 100; tries += 1) {
        const waiting = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()");
        if (waiting.rows[0].n > 0) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await other.query(
        'INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, $3, $4)',
        [TEMPLE, SITE, COMPONENTS_SOURCE, '9580-002'],
      );
      await other.query('COMMIT');
    } finally {
      other.release();
    }

    expect((await merging!).refusal).toEqual({ status: 409, error: WHOLE_REFUSAL });
    expect(await foldedInto(ARCHAEOLOGY)).toBeNull();
  });
});

describe('a merge onto a site that has since been made of parts (Baalbek, #2119)', () => {
  it('is listed by the check, and the undo from its record gives the other place back its kind and its point', async () => {
    await place(ARCHAEOLOGY, archaeology, ITEM, 'Baalbek', 36.2079);
    await kindRecord(ARCHAEOLOGY, archaeology, ITEM);
    // The catalogue's join while the site was a site of one point.
    const merged = await mergePlaces({ survivorId: SITE, foldedId: ARCHAEOLOGY, mergedBy: null, reason: 'equal_wikidata_item' });
    expect(merged.refusal).toBeUndefined();
    const mergeId = merged.result!.mergeId;
    expect(await held()).toEqual([`${SITE}:identifies`]);

    // The list gives the site its components afterwards.
    await makeParts([[TEMPLE, SITE, '9580-002'], [SANCTUARY, SITE, '9580-003']]);
    expect(await held()).toEqual([`${SITE}:refers`]);
    expect(await mergesOntoAWhole()).toEqual([{
      merge_id: mergeId,
      line: `Baalbek (#${ARCHAEOLOGY}) was merged into Baalbek (whole merge fixture) (#${SITE}) by the catalogue`,
    }]);

    const undone = await undoMerge(mergeId, curatorId);
    expect(undone.refusal).toBeUndefined();
    expect(await foldedInto(ARCHAEOLOGY)).toBeNull();
    const kinds = await pool.query<{ experience_id: number }>(
      'SELECT experience_id FROM source_records WHERE kind_id = $1 AND external_id = $2', [archaeology.kind_id, ITEM],
    );
    expect(kinds.rows).toEqual([{ experience_id: ARCHAEOLOGY }]);
    const standing = await pool.query(
      'SELECT 1 FROM experience_locations WHERE experience_id = $1 AND merged_into_id IS NULL AND missing_since IS NULL',
      [ARCHAEOLOGY],
    );
    expect(standing.rowCount).toBe(1);
    expect(await wholesOf(TEMPLE)).toEqual([SITE]);
    expect(await held()).toEqual([`${SITE}:refers`, `${ARCHAEOLOGY}:identifies`]);
    expect(await mergesOntoAWhole()).toEqual([]);

    // Nothing joins the two again: the site claims no item, and the undone merge is a curator's word.
    expect(await joinPlacesClaimingOneItem([ITEM])).toEqual({ merged: [], refused: [] });
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';
import { mergePlaces, undoMerge, WHOLE_REFUSAL } from './placeMerge.js';
import { separateMembership, undoSeparation } from './membershipSeparation.js';
import { answerComponentItemsUnderLock } from './componentItemController.js';
import { joinPlacesClaimingOneItem } from './equalItemMerges.js';
import { editLocation } from './locationEditController.js';

/**
 * A part of a serial site merged with another kind's place (ADR-0100 decision
 * 4, #1250), against PostgreSQL. The fixture is Ancient Thebes as the World
 * Heritage run leaves it, the Temple of Karnak and the Luxor Temple its parts,
 * and the Karnak Temple Complex of Places of worship, one place with the
 * Temple of Karnak on the ground, its point a few metres from the component's.
 */

const THEBES = 9960;
const COMPLEX = 9961;
const KARNAK = { name: 'Temple of Karnak', externalRef: '87-001', lon: 32.6573, lat: 25.7188 };
const LUXOR = { name: 'Luxor Temple', externalRef: '87-002', lon: 32.6390, lat: 25.6995 };
const ADMIN = '00000000-0000-4000-8000-000000009960';

let run: LocationWriteRun;
let adminId = 0;
let complexPoint = 0;

const PLACES = `(SELECT part_id FROM experience_parts WHERE whole_id = ${THEBES}
                 UNION SELECT folded_id FROM experience_merges WHERE survivor_id = ${COMPLEX})`;

async function clear(): Promise<void> {
  // A place a separation made, before the record that names it goes.
  const separated = (await pool.query<{ id: number }>(
    `SELECT separated_id AS id FROM experience_separations
      WHERE original_id = $1 OR original_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $2)`, [COMPLEX, THEBES],
  )).rows.map(row => row.id);
  await pool.query('DELETE FROM experience_separations WHERE separated_id = ANY($1::int[])', [separated]);
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1::int[]) OR folded_id = ANY($1::int[])', [separated]);
  await pool.query('DELETE FROM place_identifier_verdicts WHERE experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)', [THEBES]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1::int[])', [separated]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1::int[])', [separated]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [separated]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [separated]);
  await pool.query(`DELETE FROM experience_merges WHERE survivor_id = $1 OR folded_id = $1`, [COMPLEX]);
  await pool.query(`UPDATE experience_locations SET merged_into_id = NULL
                     WHERE experience_id IN ${PLACES} OR experience_id = ANY($1::int[])`, [[THEBES, COMPLEX]]);
  // The complex itself may be the folded one: a gated arrival folds into the part.
  await pool.query(`UPDATE experiences SET merged_into_id = NULL WHERE id IN ${PLACES} OR id = ANY($1::int[])`, [[THEBES, COMPLEX]]);
  await pool.query(`DELETE FROM experiences WHERE id IN ${PLACES} AND id <> $1`, [COMPLEX]);
  await pool.query(`DELETE FROM experiences WHERE id IN (SELECT experience_id FROM experience_locations
                     WHERE external_ref LIKE '87-00%' AND experience_id <> ALL($1::int[]))`, [[THEBES, COMPLEX]]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [[THEBES, COMPLEX]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[THEBES, COMPLEX]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

/** Thebes' parts, by their component reference. */
async function parts() {
  return (await pool.query<{ part_id: number; external_ref: string; name: string }>(
    `SELECT p.part_id, pr.external_id AS external_ref, e.name FROM experience_parts p
       JOIN source_records pr ON pr.experience_id = p.part_id AND pr.whole_id = p.whole_id AND pr.source_id = 10 JOIN experiences e ON e.id = p.part_id
      WHERE p.whole_id = $1 ORDER BY pr.external_id`, [THEBES],
  )).rows;
}

const complex = async () => (await pool.query<{ name: string; lon: number; lat: number; curated: string[] }>(
  `SELECT name, ST_X(location) AS lon, ST_Y(location) AS lat, curated_fields AS curated FROM experiences WHERE id = $1`,
  [COMPLEX],
)).rows[0];

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;
  const heritage = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: heritage.id, components: true };
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9960', 'Ancient Thebes (part merge fixture)', ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326))`,
    [THEBES, heritage.id],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '9960', 'auto', NOW())`,
    [THEBES, heritage.kind_id, heritage.id],
  );
  await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);

  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, 'Q9961001', 'Karnak Temple Complex', ST_SetSRID(ST_MakePoint(32.6575, 25.7189), 4326)
       FROM experience_sources s WHERE s.name = 'Places of worship'`,
    [COMPLEX],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, 'Q9961001', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Places of worship'
     RETURNING id`,
    [COMPLEX],
  );
  complexPoint = (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, 'Karnak Temple Complex', 'Q9961001', ST_SetSRID(ST_MakePoint(32.6575, 25.7189), 4326)) RETURNING id`,
    [COMPLEX],
  )).rows[0].id;
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [complexPoint, membership.rows[0].id]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

/** Fold the Temple of Karnak into the Karnak Temple Complex, as the catalogue's merge on an equal item would. */
async function mergeKarnak(): Promise<{ templeId: number; mergeId: number }> {
  const templeId = (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
  const outcome = await mergePlaces({ survivorId: COMPLEX, foldedId: templeId, mergedBy: null, reason: 'equal_wikidata_item' });
  expect(outcome.refusal).toBeUndefined();
  return { templeId, mergeId: outcome.result!.mergeId };
}

describe('a part merged with another kind\'s place (ADR-0100 decision 4)', () => {
  it('makes the place the part: the site keeps its part, under the same reference', async () => {
    const { templeId } = await mergeKarnak();
    const now = await parts();
    expect(now.map(p => p.external_ref)).toEqual(['87-001', '87-002']);
    expect(now[0].part_id).toBe(COMPLEX);
    const temple = await pool.query<{ merged_into_id: number }>('SELECT merged_into_id FROM experiences WHERE id = $1', [templeId]);
    expect(temple.rows[0].merged_into_id).toBe(COMPLEX);
    // The component's point folded into the complex's: one place on the ground, one pin.
    const folded = await pool.query<{ merged_into_id: number }>(
      'SELECT merged_into_id FROM experience_locations WHERE experience_id = $1', [templeId],
    );
    expect(folded.rows).toEqual([{ merged_into_id: complexPoint }]);
  });

  it('keeps the place its own name and anchor, and the site no new part, when the site\'s run writes again', async () => {
    await mergeKarnak();
    const before = await complex();
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak' }, LUXOR], run);

    const after = await complex();
    expect(after.name).toBe('Karnak Temple Complex');
    expect([after.lon, after.lat]).toEqual([before.lon, before.lat]);
    expect((await parts()).map(p => [p.external_ref, p.part_id === COMPLEX])).toEqual([['87-001', true], ['87-002', false]]);
  });

  it("writes what the site's list says of the component on the record the merge carried, through the folded point", async () => {
    await mergeKarnak();
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak', lon: KARNAK.lon + 0.0001 }, LUXOR], run);

    const record = await pool.query<{ name: string; lon: number }>(
      `SELECT reported_name AS name, ST_X(reported_location) AS lon FROM source_records
        WHERE experience_id = $1 AND source_id = 10 AND whole_id IS NOT NULL`, [COMPLEX],
    );
    expect(record.rows).toEqual([{ name: 'Temple of Amun-Ra at Karnak', lon: KARNAK.lon + 0.0001 }]);
  });

  it('keeps the place its own name, anchor and the relation its reference when its own point is written', async () => {
    await mergeKarnak();
    const before = await complex();
    // What the Places of worship run, or a curator, writes on the complex's own point.
    await pool.query(
      `UPDATE experience_locations SET name = 'Karnak (temple point)', location = ST_SetSRID(ST_MakePoint(32.6590, 25.7195), 4326)
        WHERE id = $1`, [complexPoint],
    );
    const after = await complex();
    expect(after.name).toBe('Karnak Temple Complex');
    expect([after.lon, after.lat]).toEqual([before.lon, before.lat]);
    expect((await parts())[0]).toMatchObject({ external_ref: '87-001', part_id: COMPLEX });
  });

  it('gives the site its part back on the undo', async () => {
    const { templeId, mergeId } = await mergeKarnak();
    const outcome = await undoMerge(mergeId, adminId);
    expect(outcome.refusal).toBeUndefined();
    expect((await parts()).map(p => [p.external_ref, p.part_id])[0]).toEqual(['87-001', templeId]);
    const relations = await pool.query('SELECT 1 FROM experience_parts WHERE part_id = $1', [COMPLEX]);
    expect(relations.rowCount).toBe(0);
  });

  it('gives the part back its point\'s name on the undo where the kinded place folded into the part', async () => {
    const templeId = (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
    const outcome = await mergePlaces({ survivorId: templeId, foldedId: COMPLEX, mergedBy: null, reason: 'equal_wikidata_item' });
    expect(outcome.refusal).toBeUndefined();
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak' }, LUXOR], run);
    expect((await undoMerge(outcome.result!.mergeId, adminId)).refusal).toBeUndefined();
    const temple = await pool.query<{ name: string }>('SELECT name FROM experiences WHERE id = $1', [templeId]);
    expect(temple.rows[0].name).toBe('Temple of Amun-Ra at Karnak');
  });

  it('refuses to fold a site and its own part into one place, a place made of parts never being merged', async () => {
    await mergeKarnak();
    const outcome = await mergePlaces({ survivorId: THEBES, foldedId: COMPLEX, mergedBy: adminId, reason: 'curator' });
    expect(outcome.refusal).toEqual({ status: 409, error: WHOLE_REFUSAL });
  });

  it('moves the place\'s own anchor with its one point when a curator corrects it', async () => {
    await mergeKarnak();
    await editLocation({
      params: { locationId: complexPoint },
      body: { latitude: 25.7190, longitude: 32.6580 },
      caller: { id: adminId, role: 'admin' } as Express.User,
    } as never);
    const after = await complex();
    expect([after.lon, after.lat]).toEqual([32.658, 25.719]);
    expect(after.curated).toContain('location');
    // The complex answers for its own point: the correction is in its own history, not the site's.
    const logged = await pool.query<{ experience_id: number }>(
      `SELECT experience_id FROM experience_curation_log WHERE action = 'location_edited' AND experience_id = ANY($1::int[])`,
      [[THEBES, COMPLEX]],
    );
    expect(logged.rows).toEqual([{ experience_id: COMPLEX }]);
  });

  it('gives the part back its point\'s name on the undo, where the site\'s run renamed it meanwhile', async () => {
    const { templeId, mergeId } = await mergeKarnak();
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak' }, LUXOR], run);
    expect((await undoMerge(mergeId, adminId)).refusal).toBeUndefined();
    const temple = await pool.query<{ name: string }>('SELECT name FROM experiences WHERE id = $1', [templeId]);
    expect(temple.rows[0].name).toBe('Temple of Amun-Ra at Karnak');
  });

  describe('the catalogue\'s merge on an equal item (#1250)', () => {
    const ITEM = 'Q9961002';
    /** The complex known by the item, and the given components' records carrying it as their item. */
    async function itemOn(...refs: string[]): Promise<void> {
      await pool.query(`UPDATE source_records SET external_id = $2 WHERE experience_id = $1`, [COMPLEX, ITEM]);
      await pool.query(
        `UPDATE source_records pr SET wikidata_items = ARRAY[$1]
          WHERE pr.whole_id = $2 AND pr.source_id = 10 AND pr.external_id = ANY($3::text[])`,
        [ITEM, THEBES, refs],
      );
    }

    it('folds a component part into the place of another kind its item names', async () => {
      await itemOn(KARNAK.externalRef);
      const templeId = (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
      const report = await joinPlacesClaimingOneItem([ITEM]);
      expect(report.merged).toMatchObject([{ qid: ITEM, survivorId: COMPLEX, foldedId: templeId, name: 'Karnak Temple Complex' }]);
      expect((await parts())[0]).toMatchObject({ external_ref: '87-001', part_id: COMPLEX });
    });

    it('folds an arrival nobody has passed into the part, the place a run would have found by its item', async () => {
      await itemOn(KARNAK.externalRef);
      // The complex as a gated source's run leaves it: its membership an arrival nobody has passed.
      await pool.query('DELETE FROM source_records WHERE experience_id = $1', [COMPLEX]);
      await pool.query(
        `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state)
         SELECT $1, s.kind_id, s.id, $2, 'pending' FROM experience_sources s WHERE s.name = 'Places of worship'`,
        [COMPLEX, ITEM],
      );
      const templeId = (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
      const report = await joinPlacesClaimingOneItem([ITEM]);
      expect(report.refused).toEqual([]);
      expect(report.merged).toMatchObject([{ qid: ITEM, survivorId: templeId, foldedId: COMPLEX, name: 'Temple of Karnak' }]);
      // The site keeps its part under the same reference, and the part now holds
      // the arrival, still waiting for a curator: the resolver's state (ADR-0143).
      expect((await parts())[0]).toMatchObject({ external_ref: '87-001', part_id: templeId });
      // Beside its record in its whole, under the component's reference, which it keeps (ADR-0198).
      const held = await pool.query<{ curation_state: string; external_id: string }>(
        `SELECT curation_state, external_id FROM source_records
          WHERE experience_id = $1 ORDER BY kind_id`, [templeId],
      );
      expect(held.rows).toEqual([
        { curation_state: 'pending', external_id: ITEM },
        { curation_state: 'auto', external_id: KARNAK.externalRef },
      ]);
    });

    it('takes an item two components hold for their ensemble\'s, and merges neither', async () => {
      await itemOn(KARNAK.externalRef, LUXOR.externalRef);
      const report = await joinPlacesClaimingOneItem([ITEM]);
      expect(report).toEqual({ merged: [], refused: [] });
    });

    it('joins the part with the place a curator confirms its item is, once the answer is written', async () => {
      // The complex is the item; the temple's point has no item yet, and the
      // finder proposes the complex's item for it (#1272).
      await pool.query('UPDATE source_records SET external_id = $2 WHERE experience_id = $1', [COMPLEX, ITEM]);
      const templeId = (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
      const point = (await pool.query<{ id: number }>('SELECT id FROM experience_locations WHERE experience_id = $1', [templeId])).rows[0].id;
      const proposal = (await pool.query<{ id: number }>(
        `INSERT INTO experience_component_item_proposals (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
         VALUES ($1, $2, 'Karnak', 5, 1, true, 'near') RETURNING id`, [point, ITEM],
      )).rows[0].id;

      const outcome = await answerComponentItemsUnderLock(THEBES, adminId, null, [{ proposalId: proposal, answer: 'accepted' }], new Map());

      expect(outcome.result).toMatchObject({ accepted: 1 });
      expect((await parts())[0]).toMatchObject({ external_ref: '87-001', part_id: COMPLEX });
    });
  });

  describe('a kind separated off a part (ADR-0213 decision 6)', () => {
    const ITEM = 'Q9961003';
    const worship = async (placeId: number) => (await pool.query<{ id: number }>(
      `SELECT m.id FROM source_records m JOIN experience_sources s ON s.id = m.source_id
        WHERE m.experience_id = $1 AND s.name = 'Places of worship'`, [placeId],
    )).rows[0]?.id;
    /** What a place holds: its name, its kinds' sources, and of each standing point whether it is the part's list line. */
    const holds = async (placeId: number) => (await pool.query<{ name: string; kinds: string[]; points: boolean[] }>(
      `SELECT e.name,
              ARRAY(SELECT s.name FROM source_records m JOIN experience_sources s ON s.id = m.source_id
                     WHERE m.experience_id = e.id AND m.kind_id IS NOT NULL ORDER BY s.name) AS kinds,
              ARRAY(SELECT is_part_line_point(el.id, $2) FROM experience_locations el
                     WHERE el.experience_id = e.id AND el.merged_into_id IS NULL ORDER BY el.id) AS points
         FROM experiences e WHERE e.id = $1`, [placeId, THEBES],
    )).rows[0];
    const temple = async () => (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
    /**
     * The Temple of Karnak as a run of Places of worship leaves it when it
     * finds the part by an item the part's record carries (ADR-0143 decision
     * 3): the part holds the kind and the kind's own point beside its line's.
     * The item named another temple, a kilometre off.
     */
    async function joinedByItem(): Promise<{ templeId: number; membership: number }> {
      const templeId = await temple();
      await pool.query(
        `UPDATE source_records SET wikidata_items = ARRAY[$1] WHERE experience_id = $2 AND source_id = 10`, [ITEM, templeId],
      );
      const membership = (await pool.query<{ id: number }>(
        `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at,
                                     reported_name, reported_location)
         SELECT $1, s.kind_id, s.id, $2, 'auto', NOW(), 'Temple of Ptah', ST_SetSRID(ST_MakePoint(32.6660, 25.7200), 4326)
           FROM experience_sources s WHERE s.name = 'Places of worship' RETURNING id`,
        [templeId, ITEM],
      )).rows[0].id;
      const point = await pool.query<{ id: number }>(
        `INSERT INTO experience_locations (experience_id, name, external_ref, location)
         VALUES ($1, 'Temple of Ptah', $2, ST_SetSRID(ST_MakePoint(32.6660, 25.7200), 4326)) RETURNING id`,
        [templeId, ITEM],
      );
      await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [point.rows[0].id, membership]);
      // While it holds a kind the part names and places itself (#1250).
      await pool.query(
        `UPDATE experiences SET name = 'Temple of Ptah', location = ST_SetSRID(ST_MakePoint(32.6660, 25.7200), 4326) WHERE id = $1`,
        [templeId],
      );
      return { templeId, membership };
    }

    it('takes the part\'s only kind and its point to a place of its own, and the site keeps its part, named and placed for its line', async () => {
      const { templeId, membership } = await joinedByItem();

      const { result, refusal } = await separateMembership({ placeId: templeId, membershipId: membership, separatedBy: adminId });

      expect(refusal).toBeUndefined();
      expect((await parts()).map(p => [p.external_ref, p.part_id === templeId])).toEqual([['87-001', true], ['87-002', false]]);
      expect(await holds(templeId)).toEqual({ name: 'Temple of Karnak', kinds: [], points: [true] });
      expect(await holds(result!.separatedId)).toEqual({ name: 'Temple of Ptah', kinds: ['Places of worship'], points: [false] });
      expect(await worship(result!.separatedId)).toBe(membership);
      const at = await pool.query<{ id: number; lon: number }>(
        'SELECT id, ST_X(location) AS lon FROM experiences WHERE id = ANY($1::int[]) ORDER BY id', [[templeId, result!.separatedId]],
      );
      expect(at.rows).toEqual([{ id: templeId, lon: KARNAK.lon }, { id: result!.separatedId, lon: 32.666 }]);
      // The new place is no part of the site: the relation is the record's, which stayed.
      const relations = await pool.query('SELECT 1 FROM experience_parts WHERE part_id = $1', [result!.separatedId]);
      expect(relations.rowCount).toBe(0);
    });

    it('keeps the two apart: the item names the new place alone, and the join leaves the part alone', async () => {
      const { templeId, membership } = await joinedByItem();
      const { result } = await separateMembership({ placeId: templeId, membershipId: membership, separatedBy: adminId });

      const registry = await pool.query<{ experience_id: number; identifies: boolean }>(
        `SELECT experience_id, identifies FROM place_identifiers
          WHERE scheme = 'wikidata' AND value = $1 ORDER BY identifies`, [ITEM],
      );
      expect(registry.rows).toEqual([
        { experience_id: templeId, identifies: false }, { experience_id: result!.separatedId, identifies: true },
      ]);
      expect(await joinPlacesClaimingOneItem([ITEM])).toEqual({ merged: [], refused: [] });
    });

    it('leaves a part the site\'s run writes like any other: renamed by the list, and no new part', async () => {
      const { templeId, membership } = await joinedByItem();
      await separateMembership({ placeId: templeId, membershipId: membership, separatedBy: adminId });

      await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak' }, LUXOR], run);

      expect((await parts()).map(p => [p.external_ref, p.part_id === templeId, p.name])).toEqual([
        ['87-001', true, 'Temple of Amun-Ra at Karnak'], ['87-002', false, 'Luxor Temple'],
      ]);
    });

    it('is undone by merging the two again, the part holding its kind and its record', async () => {
      const { templeId, membership } = await joinedByItem();
      const { result } = await separateMembership({ placeId: templeId, membershipId: membership, separatedBy: adminId });

      const undone = await undoSeparation(result!.separationId, adminId);

      expect(undone.refusal).toBeUndefined();
      expect(await worship(templeId)).toBe(membership);
      expect((await parts())[0]).toMatchObject({ external_ref: '87-001', part_id: templeId });
    });

    it('refuses a kind a merge folded onto the point of the part\'s line, whichever of the two stayed, and changes nothing', async () => {
      await mergeKarnak();
      const membership = await worship(COMPLEX);

      const outcome = await separateMembership({ placeId: COMPLEX, membershipId: membership, separatedBy: adminId });

      expect(outcome.refusal).toMatchObject({ status: 409, error: expect.stringContaining('undo that merge') });
      expect(await holds(COMPLEX)).toEqual({ name: 'Karnak Temple Complex', kinds: ['Places of worship'], points: [true] });
    });

    it('refuses it the same where the kind\'s place folded into the part', async () => {
      const templeId = await temple();
      await mergePlaces({ survivorId: templeId, foldedId: COMPLEX, mergedBy: null, reason: 'equal_wikidata_item' });

      const outcome = await separateMembership({ placeId: templeId, membershipId: await worship(templeId), separatedBy: adminId });

      expect(outcome.refusal).toMatchObject({ status: 409, error: expect.stringContaining('undo that merge') });
      expect((await holds(templeId)).kinds).toEqual(['Places of worship']);
    });

    it('refuses a kind that places the only point the part stands at, and changes nothing', async () => {
      const { templeId, membership } = await joinedByItem();
      // The part as it would stand had its line's point been lost.
      await pool.query('DELETE FROM experience_locations WHERE experience_id = $1 AND external_ref = $2', [templeId, KARNAK.externalRef]);

      const outcome = await separateMembership({ placeId: templeId, membershipId: membership, separatedBy: adminId });

      expect(outcome.refusal).toMatchObject({ status: 409, error: expect.stringContaining('only point of this part') });
      expect(await worship(templeId)).toBe(membership);
      expect((await holds(templeId)).points).toEqual([false]);
    });

    it('refuses it the same where the point the part would keep is one no reader is shown', async () => {
      const { templeId, membership } = await joinedByItem();
      // The line's point is still a row, and lost: it keeps no part on its site's map.
      await pool.query(
        "UPDATE experience_locations SET existence = 'lost' WHERE experience_id = $1 AND external_ref = $2",
        [templeId, KARNAK.externalRef],
      );

      const outcome = await separateMembership({ placeId: templeId, membershipId: membership, separatedBy: adminId });

      expect(outcome.refusal).toMatchObject({ status: 409, error: expect.stringContaining('only point of this part') });
      expect(await worship(templeId)).toBe(membership);
    });

    it('still refuses the only kind of a place that is no component of a site', async () => {
      const outcome = await separateMembership({ placeId: COMPLEX, membershipId: await worship(COMPLEX), separatedBy: adminId });
      expect(outcome.refusal).toMatchObject({ status: 409, error: expect.stringContaining('only kind') });
    });
  });
});

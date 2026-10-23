import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * Two points of a place within ten metres are one point, whichever source
 * placed the one a reader sees and whatever either calls it (ADR-0027, #1846),
 * executed against PostgreSQL. The fixture is the Genbaku Dome as the
 * development catalogue held it on 2026-10-22: UNESCO's point `775`, and a
 * Wikidata source's `Q231140` 5 cm from it, which was written as a second point
 * and asked as a 0 m move. Ids are the fixture's own, deleted before and after.
 */

const DOME = 9846;
const QID = 'Q231140-genbaku-fixture';
const UNESCO_POINT = { externalRef: '775', name: 'Hiroshima Peace Memorial (Genbaku Dome)', lon: 132.4536, lat: 34.3956 };
// 5 cm north of UNESCO's point.
const WIKIDATA_POINT = { externalRef: 'Q231140', name: 'Genbaku Dome', lon: 132.4536, lat: 34.39560045 };

let unesco = 0;
let archaeology = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [DOME, QID]);
}

async function member(sourceId: number): Promise<number> {
  const kind = (await pool.query<{ kind_id: number }>('SELECT kind_id FROM experience_sources WHERE id = $1', [sourceId])).rows[0].kind_id;
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'verified', NOW()) RETURNING id`,
    [DOME, kind, sourceId, `${QID}-${sourceId}`],
  )).rows[0].id;
}

const points = async () => (await pool.query<{
  id: number; external_ref: string; name: string; curation_state: string; missing_since: Date | null;
  withdrawal_deferred_for_location_id: number | null; memberships: number[];
}>(
  `SELECT el.id, el.external_ref, el.name, el.curation_state, el.missing_since, el.withdrawal_deferred_for_location_id,
          ARRAY(SELECT p.membership_id FROM experience_location_placements p WHERE p.location_id = el.id ORDER BY 1) AS memberships
     FROM experience_locations el WHERE el.experience_id = $1 ORDER BY el.id`,
  [DOME],
)).rows;

let unescoMembership = 0;
let archaeologyMembership = 0;
let standing = 0;

beforeEach(async () => {
  await clear();
  unesco = (await pool.query<{ id: number }>("SELECT id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'")).rows[0].id;
  archaeology = (await pool.query<{ id: number }>("SELECT id FROM experience_sources WHERE name = 'Archaeology'")).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Hiroshima Peace Memorial (Genbaku Dome)', ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [DOME, unesco, QID, UNESCO_POINT.lon, UNESCO_POINT.lat],
  );
  unescoMembership = await member(unesco);
  archaeologyMembership = await member(archaeology);
  await writeExperienceLocations(DOME, [UNESCO_POINT], { syncLogId: null, sourceId: unesco });
  // Published where the source is gated, so a reader sees UNESCO's point.
  await pool.query("UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1 AND curation_state = 'pending'", [DOME]);
  standing = (await points())[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a source\'s point within ten metres of a point a reader sees (#1846)', () => {
  it('is that point: placed, nothing written on it, and nothing asked', async () => {
    const result = await writeExperienceLocations(DOME, [WIKIDATA_POINT], { syncLogId: null, sourceId: archaeology });

    const rows = await points();
    expect(rows).toHaveLength(1);
    // UNESCO's reference and name stand: one source's point is not rewritten by another's.
    expect(rows[0]).toMatchObject({ id: standing, external_ref: '775', name: UNESCO_POINT.name, missing_since: null });
    expect(rows[0].memberships).toEqual([unescoMembership, archaeologyMembership].sort((a, b) => a - b));
    expect(result.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    // The placement records the reference the run took the point under (ADR-0137).
    const adopted = await pool.query<{ adopted_ref: string | null }>(
      'SELECT adopted_ref FROM experience_location_placements WHERE location_id = $1 AND membership_id = $2', [standing, archaeologyMembership],
    );
    expect(adopted.rows).toEqual([{ adopted_ref: WIKIDATA_POINT.externalRef }]);
  });

  it('takes the fast path on the next run, with nothing to write', async () => {
    await writeExperienceLocations(DOME, [WIKIDATA_POINT], { syncLogId: null, sourceId: archaeology });
    const result = await writeExperienceLocations(DOME, [WIKIDATA_POINT], { syncLogId: null, sourceId: archaeology });

    expect(result).toEqual({ unchanged: [standing], needsAssignment: [], unoffered: 0, delta: { added: [], withdrawn: [], returned: [], changed: [] } });
  });

  it('gives two of its points nearest one point a reader sees the next nearest, not a second pin', async () => {
    // UNESCO shows two points 3 m apart; Archaeology offers two, 0 m and 1 m
    // from the first. Both are nearest the first: one takes it, and the other
    // takes the second rather than being written beside them.
    const second = { externalRef: '775-b', name: 'Second component', lon: UNESCO_POINT.lon + 0.0000326, lat: UNESCO_POINT.lat };
    await writeExperienceLocations(DOME, [UNESCO_POINT, second], { syncLogId: null, sourceId: unesco });
    await pool.query("UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1 AND curation_state = 'pending'", [DOME]);
    const result = await writeExperienceLocations(DOME, [
      { ...WIKIDATA_POINT, lat: UNESCO_POINT.lat },
      { externalRef: 'Q231140-b', name: 'Beside it', lon: UNESCO_POINT.lon + 0.0000109, lat: UNESCO_POINT.lat },
    ], { syncLogId: null, sourceId: archaeology });

    expect(result.delta.added).toEqual([]);
    const rows = await points();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.memberships.includes(archaeologyMembership))).toBe(true);
  });

  it('takes the fast path although a point of its reference readers saw went missing far off', async () => {
    // Tel Be'er Sheva's shape: the source's point moved more than ten metres
    // once, so its old published row of the same reference is marked missing
    // 50 m away. That row is no claim on the point the run took.
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state, missing_since)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'verified', NOW())`,
      [DOME, WIKIDATA_POINT.name, WIKIDATA_POINT.externalRef, WIKIDATA_POINT.lon, UNESCO_POINT.lat + 0.00045],
    );
    await writeExperienceLocations(DOME, [WIKIDATA_POINT], { syncLogId: null, sourceId: archaeology });
    const again = await writeExperienceLocations(DOME, [WIKIDATA_POINT], { syncLogId: null, sourceId: archaeology });

    expect(again).toEqual({ unchanged: [standing], needsAssignment: [], unoffered: 0, delta: { added: [], withdrawn: [], returned: [], changed: [] } });
  });

  it('withdraws the unread duplicate an earlier run wrote beside it, and its wait on the point', async () => {
    // The state run 200 left. A merge folded the old kind's point of this
    // reference into UNESCO's, and the split kind's membership took the old
    // kind's placement there (#1807). Its first run then wrote an unread
    // arrival of the same reference, placed by it and holding the withdrawal of
    // the point it duplicates.
    const twin = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state, merged_into_id)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'pending', $6) RETURNING id`,
      [DOME, WIKIDATA_POINT.name, WIKIDATA_POINT.externalRef, WIKIDATA_POINT.lon, WIKIDATA_POINT.lat, standing],
    )).rows[0].id;
    const duplicate = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location, curation_state, withdrawal_deferred_for_location_id)
       VALUES ($1, $2, $3, 1, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'pending', $6) RETURNING id`,
      [DOME, WIKIDATA_POINT.name, WIKIDATA_POINT.externalRef, WIKIDATA_POINT.lon, WIKIDATA_POINT.lat, standing],
    )).rows[0].id;
    await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2), ($3, $2)',
      [duplicate, archaeologyMembership, standing]);

    await writeExperienceLocations(DOME, [WIKIDATA_POINT], { syncLogId: null, sourceId: archaeology });

    const rows = await points();
    expect(rows.find(row => row.id === standing)).toMatchObject({ missing_since: null, external_ref: '775' });
    expect(rows.find(row => row.id === standing)!.memberships).toContain(archaeologyMembership);
    const gone = rows.find(row => row.id === duplicate)!;
    expect(gone.missing_since).not.toBeNull();
    expect(gone.withdrawal_deferred_for_location_id).toBeNull();
    // The folded point is the run's: it pairs and stays folded and hidden.
    expect(rows.find(row => row.id === twin)).toMatchObject({ missing_since: null });
    expect(gone.memberships).toEqual([]);
  });

  it("keeps a source's own component apart from another it lists at the same spot", async () => {
    // UNESCO drops one component and lists another at its coordinate, as site
    // 874 lists seventeen rock shelters at one point: the new one is a point of
    // its own, read by a curator, and not the dropped one's point renamed.
    const result = await writeExperienceLocations(
      DOME, [{ ...UNESCO_POINT, externalRef: '775-002', name: 'Another component' }], { syncLogId: null, sourceId: unesco },
    );

    expect(result.delta.added).toEqual([{ name: 'Another component', ref: '775-002' }]);
    expect((await points()).find(row => row.id === standing)!.external_ref).toBe('775');
  });

  it('never lends a point taken under one reference to a component the owner lists there later', async () => {
    // Archaeology takes UNESCO's 775; UNESCO then drops it and lists 775-002 at
    // the same spot. The point is UNESCO's own, so its new component is a point
    // of its own, read by a curator, and not 775 renamed by nobody.
    await writeExperienceLocations(DOME, [WIKIDATA_POINT], { syncLogId: null, sourceId: archaeology });
    const result = await writeExperienceLocations(
      DOME, [{ ...UNESCO_POINT, externalRef: '775-002', name: 'Another component' }], { syncLogId: null, sourceId: unesco },
    );

    expect(result.delta.added).toEqual([{ name: 'Another component', ref: '775-002' }]);
    expect((await points()).find(row => row.id === standing)).toMatchObject({ external_ref: '775', name: UNESCO_POINT.name });
  });

  it("keeps the point a reader sees over an unread duplicate of the source's own reference", async () => {
    // Ironbridge Gorge's shape: one reference written twice at one spot, the
    // older point shown and the newer unread.
    const duplicate = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location, curation_state)
       VALUES ($1, $2, '775', 2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'pending') RETURNING id`,
      [DOME, UNESCO_POINT.name, UNESCO_POINT.lon, UNESCO_POINT.lat],
    )).rows[0].id;
    await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [duplicate, unescoMembership]);

    await writeExperienceLocations(DOME, [UNESCO_POINT], { syncLogId: null, sourceId: unesco });

    const rows = await points();
    expect(rows.find(row => row.id === standing)!.missing_since).toBeNull();
    expect(rows.find(row => row.id === duplicate)!.missing_since).not.toBeNull();
  });

  it('writes a point the source names by no reference as a point of its own, even 5 cm off', async () => {
    // Without a reference the run has nothing to record an adoption by, and its
    // own points pair only exactly (ADR-0027), so it takes no other source's point.
    const nameless = { ...WIKIDATA_POINT, externalRef: null };
    const result = await writeExperienceLocations(DOME, [nameless], { syncLogId: null, sourceId: archaeology });

    expect(result.delta.added).toEqual([{ name: nameless.name, ref: null }]);
    expect(await points()).toHaveLength(2);
  });

  it('takes the one point of a place of one point at any distance (ADR-0143 decision 3)', async () => {
    // 20 m north: the dome is one place of one point, and a second source's
    // one point is that point, as a merge of two such places makes it.
    const farther = { ...WIKIDATA_POINT, lat: UNESCO_POINT.lat + 0.00018 };
    const result = await writeExperienceLocations(DOME, [farther], { syncLogId: null, sourceId: archaeology });

    const rows = await points();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: standing, external_ref: '775' });
    expect(rows[0].memberships).toEqual([unescoMembership, archaeologyMembership].sort((a, b) => a - b));
    expect(result.delta.added).toEqual([]);
  });

  it('writes a point farther than ten metres as a point of its own on a place of several points', async () => {
    // A second UNESCO component: the place stands on two points, and the
    // ten metres decide (ADR-0137).
    const second = { externalRef: '775-b', name: 'A second component', lon: UNESCO_POINT.lon + 0.01, lat: UNESCO_POINT.lat };
    await writeExperienceLocations(DOME, [UNESCO_POINT, second], { syncLogId: null, sourceId: unesco });
    await pool.query("UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1 AND curation_state = 'pending'", [DOME]);
    const farther = { ...WIKIDATA_POINT, lat: UNESCO_POINT.lat + 0.00018 };
    const result = await writeExperienceLocations(DOME, [farther], { syncLogId: null, sourceId: archaeology });

    expect(await points()).toHaveLength(3);
    expect(result.delta.added).toEqual([{ name: farther.name, ref: farther.externalRef }]);
  });
});

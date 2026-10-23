import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { anchorToItsPoint, lockExperience } from './experienceWriter.js';
import { setPointVerdict } from '../controllers/experience/experienceLocationWriter.js';
import { pointsShownSql, someoneVisitedPointSql } from './placePoints.js';
import { getExperienceLocations, getRegionExperienceLocations } from '../controllers/experience/experienceLocationController.js';
import {
  getExperienceVisitedStatus, getVisitedLocationIds, markAllLocationsVisited, markLocationVisited,
  unmarkAllLocationsVisited, unmarkLocationVisited,
} from '../controllers/experience/locationVisitController.js';
import { markVisited, unmarkVisited } from '../controllers/experience/experienceVisitController.js';
import { getReviewQueue } from '../controllers/experience/reviewQueueController.js';
import { ReviewQueue } from '../api/responses/reviewQueue.js';
import { catalogueAssertions } from '../controllers/admin/dataAssertions/catalogueAssertions.js';
import { getExperience, getExperiencesByRegion } from '../controllers/experience/experienceQueryController.js';
import { queryComponentItems } from '../controllers/experience/reviewQueueComponentItems.js';
import { getWorldPoints } from '../controllers/experience/worldPointsController.js';
import { assignExperiencesToRegions, assignRegionsForExperiences } from '../services/sync/regionAssignmentService.js';
import {
  experienceLocationsQuerySchema, experiencesByRegionQuerySchema, regionLocationsQuerySchema, reviewQueueQuerySchema,
  worldPointsQuerySchema,
} from '../types/index.js';

/**
 * The points a place shows are its own and its parts' (ADR-0100), against
 * PostgreSQL: Ancient Thebes holds the Luxor Temple as its own point and the
 * Temple of Karnak as a part place, and every reader of the site's points —
 * the map, the place's own read, the region's list and its count, a
 * traveller's visits and progress, the curator's card and region placement —
 * answers with both, under the site. The part has no membership of its own,
 * so nothing offers it as a place of its own.
 */

const SITE = 9890;
const KARNAK = 9891;
/** Another site with a part of its own, so a read that confuses whose parts are whose counts too many. */
const OTHER_SITE = 9892;
const OTHER_PART = 9893;
const TRAVELLER = '00000000-0000-4000-8000-000000009890';
const ADMIN = '00000000-0000-4000-8000-000000009891';
/** A world view of its own holding Karnak's region, so the site reaches it only through its part. */
const KARNAK_WORLD_VIEW = 9890;
const KARNAK_REGION = 9890;

let regionId = 0;
let userId = 0;
let adminId = 0;
let membershipId = 0;
let luxorPoint = 0;
let karnakPoint = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[SITE, KARNAK, OTHER_SITE, OTHER_PART]]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[TRAVELLER, ADMIN]]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [KARNAK_WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [KARNAK_WORLD_VIEW]);
}

async function place(id: number, name: string, lon: number, lat: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [id, `${id}-fixture`, name, lon, lat],
  );
}

async function point(placeId: number, name: string, ref: string, lon: number, lat: number, region: number): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location, curation_state)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), 'auto') RETURNING id`,
    [placeId, name, ref, ref.endsWith('1') ? 1 : 2, lon, lat],
  );
  await pool.query(
    `INSERT INTO experience_location_regions (location_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
    [row.rows[0].id, region],
  );
  return row.rows[0].id;
}

beforeEach(async () => {
  await clear();
  regionId = (await pool.query<{ id: number }>('SELECT id FROM regions ORDER BY id LIMIT 1')).rows[0].id;
  await pool.query(
    `INSERT INTO world_views (id, name, is_default, tile_version) VALUES ($1, 'Parts fixture', false, 0)`,
    [KARNAK_WORLD_VIEW],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name) VALUES ($1, $2, 'Karnak (parts fixture)')`,
    [KARNAK_REGION, KARNAK_WORLD_VIEW],
  );
  userId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user') RETURNING id`, [TRAVELLER],
  )).rows[0].id;
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;

  await place(SITE, 'Ancient Thebes with its Necropolis (parts fixture)', 32.6396, 25.7188);
  const membership = membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.id = 1 RETURNING id`,
    [SITE, `${SITE}-fixture`],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
    [SITE, regionId],
  );
  luxorPoint = await point(SITE, 'Luxor Temple', '87-002', 32.6390, 25.6995, regionId);

  await place(KARNAK, 'Temple of Karnak (parts fixture)', 32.6573, 25.7188);
  karnakPoint = await point(KARNAK, 'Temple of Karnak', '87-001', 32.6573, 25.7188, regionId);
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
     VALUES ($1, $2, 'component', $3, '87-001')`,
    [SITE, KARNAK, membership],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const traveller = () => ({ id: userId, role: 'user' }) as Express.User;
/** The places the traveller holds a visit to, and the points. */
const HELD = 'SELECT experience_id FROM user_visited_experiences WHERE user_id = $1 ORDER BY experience_id';
const POINT_VISITS = 'SELECT location_id FROM user_visited_locations WHERE user_id = $1 ORDER BY location_id';

describe("a place's points are its own and its parts' (ADR-0100)", () => {
  it('draws the part on the map under the site, and the part alone nowhere', async () => {
    const { locationsByExperience } = await getRegionExperienceLocations({
      params: { regionId }, query: regionLocationsQuerySchema.parse({}),
    });
    expect(locationsByExperience[SITE]?.map(l => l.id).sort()).toEqual([luxorPoint, karnakPoint].sort());
    expect(locationsByExperience[KARNAK]).toBeUndefined();

    const world = await getWorldPoints({ query: worldPointsQuerySchema.parse({ detail: 'markers' }) });
    const shown = (world.locationId ?? []).flatMap((id, i) => (id === luxorPoint || id === karnakPoint
      ? [[id, world.experienceId?.[i]]] : []));
    expect(shown.sort()).toEqual([[luxorPoint, SITE], [karnakPoint, SITE]].sort());

    const folded = await getWorldPoints({ query: worldPointsQuerySchema.parse({ detail: 'markers', folded: 'true' }) });
    const site = (folded.experienceId ?? []).indexOf(SITE);
    expect(folded.locationCount?.[site]).toBe(2);
    expect(folded.experienceId).not.toContain(KARNAK);
  });

  it("reads both points as the site's own, counts them in the region's list, and names both on the curator's card", async () => {
    const own = await getExperienceLocations({
      params: { id: SITE }, query: experienceLocationsQuerySchema.parse({}), caller: undefined,
    });
    expect(own.locations.map(l => l.name)).toEqual(['Temple of Karnak', 'Luxor Temple']);

    const list = await getExperiencesByRegion({
      params: { regionId }, query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }), caller: undefined,
    });
    expect(list.experiences.find(e => e.id === SITE)?.location_count).toBe(2);
    expect(list.experiences.find(e => e.id === KARNAK)).toBeUndefined();

    await pool.query(
      `INSERT INTO experience_component_item_proposals
              (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       VALUES ($1, 'Q9891', 'Karnak Temple Complex', 125, 0.62, false, 'near')`,
      [karnakPoint],
    );
    const card = (await queryComponentItems([SITE])).rows[0];
    expect(card.component_items.map((c: { locationId: number }) => c.locationId)).toEqual([karnakPoint]);
    expect(card.offered_locations).toBe(2);
    expect(card.site_points.map((p: { locationId: number }) => p.locationId)).toEqual([karnakPoint, luxorPoint]);
  });

  it("counts a visit to the part in the site's progress, once", async () => {
    // Recorded on the part, as a place visit (ADR-0100 decision 5).
    await pool.query('INSERT INTO user_visited_experiences (user_id, experience_id) VALUES ($1, $2)', [userId, KARNAK]);

    const status = await getExperienceVisitedStatus({ params: { id: SITE }, caller: traveller() });
    expect(status).toMatchObject({ totalLocations: 2, visitedLocations: 1 });

    const visited = await getVisitedLocationIds({ query: { experienceId: SITE }, caller: traveller() });
    expect(visited).toEqual({ visitedLocationIds: [karnakPoint], byExperience: { [SITE]: [karnakPoint] }, total: 1 });
  });

  it("places the site wherever one of its parts' points is", async () => {
    await pool.query(
      `INSERT INTO experience_location_regions (location_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
      [karnakPoint, KARNAK_REGION],
    );
    await assignRegionsForExperiences([SITE], KARNAK_WORLD_VIEW);
    const regions = await pool.query<{ region_id: number }>(
      `SELECT DISTINCT elr.region_id FROM experience_location_regions elr
        WHERE elr.location_id = $1
       EXCEPT SELECT er.region_id FROM experience_regions er WHERE er.experience_id = $2`,
      [karnakPoint, SITE],
    );
    expect(regions.rows).toEqual([]);
    expect((await pool.query('SELECT 1 FROM experience_regions WHERE experience_id = $1 AND region_id = $2',
      [SITE, KARNAK_REGION])).rowCount).toBe(1);
  });

  it('places the part again too when the site is placed again', async () => {
    // A part with a kind of its own has a list row, read through its own
    // regions: the Temple of Karnak as a place of worship.
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q522862-fixture', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Places of worship'`,
      [KARNAK],
    );
    await pool.query(
      `INSERT INTO experience_location_regions (location_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
      [karnakPoint, KARNAK_REGION],
    );
    await assignRegionsForExperiences([SITE], KARNAK_WORLD_VIEW);
    expect((await pool.query('SELECT 1 FROM experience_regions WHERE experience_id = $1 AND region_id = $2',
      [KARNAK, KARNAK_REGION])).rowCount).toBe(1);
  });

  it('places the site again when only its part is placed again', async () => {
    await pool.query(
      `INSERT INTO experience_location_regions (location_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
      [karnakPoint, KARNAK_REGION],
    );
    await assignRegionsForExperiences([KARNAK], KARNAK_WORLD_VIEW);
    expect((await pool.query('SELECT 1 FROM experience_regions WHERE experience_id = $1 AND region_id = $2',
      [SITE, KARNAK_REGION])).rowCount).toBe(1);
  });

  it("clears a part's stale placement when the site's source is placed again", async () => {
    // Karnak's point left the region its automatic row still names; the part
    // has no World Heritage membership, so the source reaches it through the site.
    await pool.query(
      `INSERT INTO experience_location_regions (location_id, region_id, assignment_type) VALUES ($1, $2, 'auto')`,
      [karnakPoint, KARNAK_REGION],
    );
    await pool.query(
      `INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')`,
      [SITE, KARNAK_REGION],
    );
    await assignExperiencesToRegions(KARNAK_WORLD_VIEW, 1);
    expect((await pool.query('SELECT 1 FROM experience_location_regions WHERE location_id = $1 AND region_id = $2',
      [karnakPoint, KARNAK_REGION])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM experience_regions WHERE experience_id = $1 AND region_id = $2',
      [SITE, KARNAK_REGION])).rowCount).toBe(0);
  });

  it("keeps the site in its region's list on its part's point alone (#1428)", async () => {
    await pool.query(`UPDATE experience_regions SET assignment_type = 'auto' WHERE experience_id = $1`, [SITE]);
    await pool.query('DELETE FROM experience_location_regions WHERE location_id = $1', [luxorPoint]);
    const list = await getExperiencesByRegion({
      params: { regionId }, query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }), caller: undefined,
    });
    expect(list.experiences.map(e => e.id)).toContain(SITE);
  });

  it('records a tick on the part on the part, counts it on the site, and takes both back (#1428, #1425)', async () => {
    const marked = await markLocationVisited({ params: { locationId: karnakPoint }, body: {}, caller: traveller() });
    expect(marked).toMatchObject({ locationId: karnakPoint, experienceId: KARNAK });
    expect((await pool.query(HELD, [userId])).rows).toEqual([{ experience_id: SITE }, { experience_id: KARNAK }]);
    expect((await pool.query(POINT_VISITS, [userId])).rows).toEqual([]);
    expect(await getExperienceVisitedStatus({ params: { id: SITE }, caller: traveller() }))
      .toMatchObject({ visitedLocations: 1, totalLocations: 2 });

    await unmarkLocationVisited({ params: { locationId: karnakPoint }, caller: traveller() });
    expect((await pool.query(HELD, [userId])).rows).toEqual([]);
  });

  it("raises the site's card for its part's unread point (#1428)", async () => {
    // A second point of the part, unread: the Hypostyle Hall as the source now lists it.
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, location, curation_state)
       VALUES ($1, 'Great Hypostyle Hall', ST_SetSRID(ST_MakePoint(32.6575, 25.7186), 4326), 'pending')`,
      [KARNAK],
    );
    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: 'parts fixture' }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });
    expect(queue.contents).toEqual([expect.objectContaining({ id: SITE, membership_id: membershipId })]);
  });

  it('is nothing the catalogue checks report (#1428)', async () => {
    await pool.query(
      'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2), ($3, $2)',
      [luxorPoint, membershipId, karnakPoint],
    );
    await pool.query('INSERT INTO user_visited_experiences (user_id, experience_id) VALUES ($1, $2)', [userId, KARNAK]);
    for (const id of [
      'place-without-membership', 'point-placed-by-another-places-membership',
      'visits-on-places-no-reader-is-shown', 'listed-with-nowhere-to-go',
    ]) {
      const check = catalogueAssertions.find(a => a.id === id);
      expect(check, id).toBeDefined();
      const rows = (await pool.query(check!.sql)).rows;
      expect(JSON.stringify(rows), id).not.toMatch(/parts fixture|Temple of Karnak/);
    }
  });

  it("counts a site's own parts only, whatever alias the outer read names the site by (#1430)", async () => {
    await place(OTHER_SITE, 'Another serial site (parts fixture)', 10, 50);
    await place(OTHER_PART, 'Another part (parts fixture)', 10.01, 50.01);
    await point(OTHER_PART, 'Another part', '99-001', 10.01, 50.01, regionId);
    await pool.query(
      `INSERT INTO experience_parts (whole_id, part_id, reason) VALUES ($1, $2, 'curator')`, [OTHER_SITE, OTHER_PART],
    );
    // The finder names the site by the parts table's own alias.
    const counted = await pool.query<{ count: number }>(
      `SELECT (SELECT count(*)::int FROM ${pointsShownSql('prt.whole_id', 's')}) AS count
         FROM experience_parts prt WHERE prt.whole_id = $1`, [SITE],
    );
    expect(counted.rows).toEqual([{ count: 2 }]);
  });

  it("keeps the site's anchor where it is when a curator corrects one of the two points it shows (#1430)", async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, SITE);
      expect(await anchorToItsPoint(client, locked!.lock, 32.64, 25.70, luxorPoint)).toBe(false);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('places no part with no kind of its own in a region: its site is the one listed (#1424)', async () => {
    await pool.query(
      `INSERT INTO experience_location_regions (location_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
      [karnakPoint, KARNAK_REGION],
    );
    await assignRegionsForExperiences([SITE], KARNAK_WORLD_VIEW);
    expect((await pool.query('SELECT 1 FROM experience_regions WHERE experience_id = $1', [KARNAK])).rowCount).toBe(0);
  });

  it("answers the review queue in its schema, a part's answered point on the site's card (#1424)", async () => {
    // A curator called Karnak's point gone: the answered list walks every
    // place, and the part would otherwise carry it on a card with no kind.
    await pool.query(`UPDATE experience_locations SET existence = 'lost', state_decided_at = NOW() WHERE id = $1`, [karnakPoint]);
    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: 'parts fixture' }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });
    expect(ReviewQueue.safeParse(queue).success).toBe(true);
    expect(queue.answeredWithdrawals.map(card => card.id)).toEqual([SITE]);
  });

  it('keeps a point a published move replaced off the answered withdrawals (#1448)', async () => {
    // The Luxor Temple's point published 24 m away: the publish answered its old spot.
    const moved = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
       VALUES ($1, 'Luxor Temple', '87-002', ST_SetSRID(ST_MakePoint(32.6392, 25.6996), 4326), 'verified') RETURNING id`,
      [SITE],
    )).rows[0].id;
    await pool.query(
      `UPDATE experience_locations
          SET missing_since = NOW(), source_membership = 'former', moved_to_location_id = $2, state_decided_at = NOW()
        WHERE id = $1`,
      [luxorPoint, moved],
    );
    const answered = async () => (await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: 'parts fixture' }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    })).answeredWithdrawals;
    expect(await answered()).toEqual([]);
    // The same answer by a curator, with no move behind it, is on the card.
    await pool.query('UPDATE experience_locations SET moved_to_location_id = NULL WHERE id = $1', [luxorPoint]);
    expect((await answered()).map(card => card.id)).toEqual([SITE]);
  });

  it("clears where a point moved when a curator answers it still listed (#1448)", async () => {
    const moved = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
       VALUES ($1, 'Luxor Temple', '87-002', ST_SetSRID(ST_MakePoint(32.6392, 25.6996), 4326), 'verified') RETURNING id`,
      [SITE],
    )).rows[0].id;
    await pool.query(
      `UPDATE experience_locations SET missing_since = NOW(), source_membership = 'former', moved_to_location_id = $2
        WHERE id = $1`,
      [luxorPoint, moved],
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, SITE);
      await setPointVerdict(client, locked!.lock, luxorPoint, {
        sourceMembership: 'present', existence: 'extant', clearFlag: true, decidedBy: adminId, note: null,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const row = await pool.query('SELECT source_membership, moved_to_location_id FROM experience_locations WHERE id = $1', [luxorPoint]);
    expect(row.rows[0]).toEqual({ source_membership: 'present', moved_to_location_id: null });
  });
});

describe("a part's point with no name of its own (#1924)", () => {
  it("is named by its part place on every reader's read, and left unnamed on the curator's", async () => {
    // Etchmiadzin Cathedral's shape: a place of worship, holding its kind of its
    // own, which became the site's part 1011-001 when the two were found to be
    // one place; its point, which that kind placed, carries no name. A part
    // that holds a kind names itself (`part_follows_point`), so the point's
    // emptied name does not rename the part.
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, $2, 'verified', NOW() FROM experience_sources s WHERE s.id = 4`,
      [KARNAK, `${KARNAK}-worship`],
    );
    await pool.query('UPDATE experience_locations SET name = NULL WHERE id = $1', [karnakPoint]);

    const own = await getExperienceLocations({
      params: { id: SITE }, query: experienceLocationsQuerySchema.parse({}), caller: undefined,
    });
    expect(own.locations.find(l => l.id === karnakPoint)?.name).toBe('Temple of Karnak (parts fixture)');

    for (const query of [{}, { includeChildren: 'false' }]) {
      const { locationsByExperience } = await getRegionExperienceLocations({
        params: { regionId }, query: regionLocationsQuerySchema.parse(query),
      });
      expect(locationsByExperience[SITE]?.find(l => l.id === karnakPoint)?.name).toBe('Temple of Karnak (parts fixture)');
    }

    const world = await getWorldPoints({ query: worldPointsQuerySchema.parse({ detail: 'markers' }) });
    const at = (world.locationId ?? []).indexOf(karnakPoint);
    expect(world.name?.[at]).toBe('Temple of Karnak (parts fixture)');

    // A signed-in reader's rows come from the visited-status read, which Discover takes its names from.
    const status = await getExperienceVisitedStatus({ params: { id: SITE }, caller: traveller() });
    expect(status.locations.find(l => l.id === karnakPoint)?.name).toBe('Temple of Karnak (parts fixture)');

    // The curator's card reads what the source wrote, which it corrects.
    await pool.query(
      `INSERT INTO experience_component_item_proposals
              (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       VALUES ($1, 'Q9891', 'Karnak Temple Complex', 125, 0.62, false, 'near')`,
      [karnakPoint],
    );
    const card = (await queryComponentItems([SITE])).rows[0];
    expect(card.component_items.find((c: { locationId: number }) => c.locationId === karnakPoint)?.pointName).toBeNull();
  });
});

describe('a part reads as a place (ADR-0100, #1425)', () => {
  it("opens the part's own card, under its site's kind, naming the site and the point its card opens it at", async () => {
    const card = await getExperience({ params: { id: KARNAK }, caller: undefined });
    expect(card).toMatchObject({
      id: KARNAK, name: 'Temple of Karnak (parts fixture)', kind_id: 1, kinds: [],
      part_of: { id: SITE, name: 'Ancient Thebes with its Necropolis (parts fixture)', point_id: karnakPoint },
    });
    expect((await getExperience({ params: { id: SITE }, caller: undefined })).part_of).toBeNull();
    const own = await getExperienceLocations({ params: { id: KARNAK }, query: experienceLocationsQuerySchema.parse({}), caller: undefined });
    expect(own.locations.map(l => l.id)).toEqual([karnakPoint]);
  });

  it("closes the part's card where its site is closed, or where its source no longer lists it", async () => {
    await pool.query("UPDATE experience_kind_memberships SET admission = 'refused' WHERE id = $1", [membershipId]);
    await expect(getExperience({ params: { id: KARNAK }, caller: undefined })).rejects.toThrow(/not found/i);
    await pool.query("UPDATE experience_kind_memberships SET admission = 'admitted' WHERE id = $1", [membershipId]);
    await pool.query('UPDATE experience_locations SET missing_since = NOW() WHERE id = $1', [karnakPoint]);
    await expect(getExperience({ params: { id: KARNAK }, caller: undefined })).rejects.toThrow(/not found/i);
    await expect(markVisited({ params: { experienceId: KARNAK }, body: {}, caller: traveller() })).rejects.toThrow(/not found/i);
  });

  it('records a visit to the part by its id on the part, cascades it to the site, and clears the site with it', async () => {
    await markVisited({ params: { experienceId: KARNAK }, body: {}, caller: traveller() });
    expect((await pool.query(HELD, [userId])).rows).toEqual([{ experience_id: SITE }, { experience_id: KARNAK }]);
    const visited = await getVisitedLocationIds({ query: { experienceId: SITE }, caller: traveller() });
    expect(visited.visitedLocationIds).toEqual([karnakPoint]);

    await unmarkVisited({ params: { experienceId: KARNAK }, caller: traveller() });
    expect((await pool.query(HELD, [userId])).rows).toEqual([]);
  });

  it('keeps the site visited while another of its points is', async () => {
    await markLocationVisited({ params: { locationId: luxorPoint }, body: {}, caller: traveller() });
    await markVisited({ params: { experienceId: KARNAK }, body: {}, caller: traveller() });
    await unmarkVisited({ params: { experienceId: KARNAK }, caller: traveller() });
    expect((await pool.query(HELD, [userId])).rows).toEqual([{ experience_id: SITE }]);
  });

  it("marks all of the site's points, a part's on the part, and unmarks them all", async () => {
    const marked = await markAllLocationsVisited({
      params: { experienceId: SITE }, query: {}, caller: traveller(),
    });
    expect(marked.locationsMarked).toBe(2);
    expect((await pool.query(HELD, [userId])).rows).toEqual([{ experience_id: SITE }, { experience_id: KARNAK }]);
    expect((await pool.query(POINT_VISITS, [userId])).rows).toEqual([{ location_id: luxorPoint }]);
    expect(await getExperienceVisitedStatus({ params: { id: SITE }, caller: traveller() }))
      .toMatchObject({ visitedStatus: 'visited', visitedLocations: 2 });

    const unmarked = await unmarkAllLocationsVisited({ params: { experienceId: SITE }, query: {}, caller: traveller() });
    expect(unmarked.locationsUnmarked).toBe(2);
    expect((await pool.query(HELD, [userId])).rows).toEqual([]);
    expect((await pool.query(POINT_VISITS, [userId])).rows).toEqual([]);
  });

  it("tells a curator a component's point was visited when the visit is its part's", async () => {
    const visited = `SELECT ${someoneVisitedPointSql('el')} AS visited FROM experience_locations el WHERE el.id = $1`;
    expect((await pool.query(visited, [karnakPoint])).rows).toEqual([{ visited: false }]);
    await pool.query('INSERT INTO user_visited_experiences (user_id, experience_id) VALUES ($1, $2)', [userId, KARNAK]);
    expect((await pool.query(visited, [karnakPoint])).rows).toEqual([{ visited: true }]);
    // A visit to the site is no visit to each of its points.
    await pool.query('INSERT INTO user_visited_experiences (user_id, experience_id) VALUES ($1, $2)', [userId, SITE]);
    expect((await pool.query(visited, [luxorPoint])).rows).toEqual([{ visited: false }]);
  });

  it("watches a part's visit once its point leaves every map, as it watches a point's", async () => {
    await pool.query('INSERT INTO user_visited_experiences (user_id, experience_id) VALUES ($1, $2)', [userId, KARNAK]);
    await pool.query('UPDATE experience_locations SET missing_since = NOW() WHERE id = $1', [karnakPoint]);
    const check = catalogueAssertions.find(a => a.id === 'visits-on-places-no-reader-is-shown');
    const rows = (await pool.query(check!.sql)).rows.filter(row => row.location_id === karnakPoint);
    expect(rows).toEqual([expect.objectContaining({ place_name: 'Temple of Karnak', ticks: '1' })]);
  });

  it("takes back a tick a part's point still holds from before its parting", async () => {
    await pool.query('INSERT INTO user_visited_locations (user_id, location_id) VALUES ($1, $2)', [userId, karnakPoint]);
    await unmarkLocationVisited({ params: { locationId: karnakPoint }, caller: traveller() });
    expect((await pool.query(POINT_VISITS, [userId])).rows).toEqual([]);
  });

  it('marks all of a part by its id as a visit to the site too, and unmarks the site with it', async () => {
    await markAllLocationsVisited({ params: { experienceId: KARNAK }, query: {}, caller: traveller() });
    expect((await pool.query(HELD, [userId])).rows).toEqual([{ experience_id: SITE }, { experience_id: KARNAK }]);

    await unmarkAllLocationsVisited({ params: { experienceId: KARNAK }, query: {}, caller: traveller() });
    expect((await pool.query(HELD, [userId])).rows).toEqual([]);
  });
});

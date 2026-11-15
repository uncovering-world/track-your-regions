import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { partAssertions } from '../controllers/admin/dataAssertions/partAssertions.js';
import { CURATOR_REFUSAL_REASON } from '../controllers/experience/curatorRefusalController.js';
import { queryQueueKeys } from '../controllers/experience/reviewQueueKeys.js';
import { arrivalOpenSql } from '../controllers/experience/reviewQueuePredicates.js';
import { partOfferedSql } from './readerPredicates.js';
import { waitingCountsBySource } from '../controllers/experience/waitingCounts.js';

/**
 * A part's gate is its record in its whole (ADR-0213, #2123), against
 * PostgreSQL. While the review queue and the run still write the points, the
 * record follows the points of its list line (`refresh_part_record_gates()`),
 * and `part-gate-out-of-step` holds the two readings to each other.
 *
 * The fixture is Baalbek as the World Heritage run leaves it: three lines
 * placed by the site's membership and parted by `part_site_components()`, the
 * writer the run calls. Ids are the fixture's own, deleted before and after.
 */

const SITE = 9690;
/** A place the quarry's record moves to. */
const SURVIVOR = 9691;
const ARCHAEOLOGY_SOURCE = 5;
const COMPONENTS_SOURCE = 10;
const ADMIN_UUID = '00000000-0000-4000-8000-000000009690';
const TEMPLES = { ref: '294-001', name: 'Temples of Bacchus and Jupiter', lon: 36.2039, lat: 34.0069 };
const QUARRY = { ref: '294-002', name: 'Quarry of the Stone of the Pregnant Woman', lon: 36.1997, lat: 33.9993 };
const MOSQUE = { ref: '294-003', name: 'Great Mosque', lon: 36.2069, lat: 34.0048 };

let membershipId: number;

interface Gate {
  part_id: number;
  curation_state: string;
  admission: string;
  admission_reason: string | null;
  missing: boolean;
  source_membership: string;
}

async function clear(): Promise<void> {
  await pool.query(
    'DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1) OR merged_into_id = $1',
    [SITE],
  );
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[SURVIVOR, SITE]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN_UUID]);
}

/** A line of the site's list, as the run writes its point: on the site, placed by its membership. */
async function line(component: typeof TEMPLES, state: 'auto' | 'pending'): Promise<void> {
  await pool.query(
    `WITH pt AS (
       INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6) RETURNING id)
     INSERT INTO experience_location_placements (location_id, membership_id) SELECT id, $7 FROM pt`,
    [SITE, component.name, component.ref, component.lon, component.lat, state, membershipId],
  );
}

async function partOf(ref: string): Promise<number> {
  return (await pool.query<{ experience_id: number }>(
    'SELECT experience_id FROM source_records WHERE source_id = 10 AND whole_id = $1 AND external_id = $2',
    [SITE, ref],
  )).rows[0].experience_id;
}

async function gate(ref: string): Promise<Gate> {
  return (await pool.query<Gate>(
    `SELECT experience_id AS part_id, curation_state, admission, admission_reason,
            missing_since IS NOT NULL AS missing, source_membership
       FROM source_records WHERE source_id = 10 AND whole_id = $1 AND external_id = $2`,
    [SITE, ref],
  )).rows[0];
}

async function setPoint(ref: string, set: string): Promise<void> {
  await pool.query(`UPDATE experience_locations SET ${set} WHERE experience_id = $1 AND external_ref = $2`, [await partOf(ref), ref]);
}

async function outOfStep(): Promise<Array<Record<string, unknown>>> {
  const rule = partAssertions.find(assertion => assertion.id === 'part-gate-out-of-step')!;
  return (await pool.query<Record<string, unknown>>(rule.sql)).rows.filter(row => Number(row.whole_id) === SITE);
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, '9690', 'Baalbek (gate fixture)', ST_SetSRID(ST_MakePoint(36.2039, 34.0069), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [SITE],
  );
  membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9690', 'verified', NOW() FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'
     RETURNING id`,
    [SITE],
  )).rows[0].id;
  await line(TEMPLES, 'auto');
  await line(QUARRY, 'pending');
  await pool.query('SELECT part_site_components($1, $2)', [SITE, membershipId]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a new part takes its record in its point\'s state', () => {
  it('writes the record pending where its line waits for a curator, and auto where it was published', async () => {
    expect(await gate(TEMPLES.ref)).toMatchObject({ curation_state: 'auto', admission: 'admitted', missing: false });
    expect(await gate(QUARRY.ref)).toMatchObject({ curation_state: 'pending', admission: 'admitted', missing: false });
    expect(await outOfStep()).toEqual([]);
  });

  it('parts a line the next run adds into a part whose record waits too', async () => {
    await line(MOSQUE, 'pending');
    await pool.query('SELECT part_site_components($1, $2)', [SITE, membershipId]);

    expect(await gate(MOSQUE.ref)).toMatchObject({ curation_state: 'pending' });
    expect(await outOfStep()).toEqual([]);
  });
});

describe('the record follows its line points while the writers write the points', () => {
  it('is read once a curator publishes its point', async () => {
    await setPoint(QUARRY.ref, "curation_state = 'verified'");

    expect(await gate(QUARRY.ref)).toMatchObject({ curation_state: 'verified' });
    expect(await outOfStep()).toEqual([]);
  });

  it('is turned down as an arrival is while its point is refused, and taken back with it', async () => {
    await setPoint(QUARRY.ref, 'refused_at = NOW()');
    expect(await gate(QUARRY.ref)).toMatchObject({
      curation_state: 'pending', admission: 'refused', admission_reason: CURATOR_REFUSAL_REASON,
    });
    expect(await outOfStep()).toEqual([]);

    await setPoint(QUARRY.ref, 'refused_at = NULL');
    expect(await gate(QUARRY.ref)).toMatchObject({ curation_state: 'pending', admission: 'admitted', admission_reason: null });
  });

  it('is withdrawn while the list does not give its line, judged former with it, and listed again', async () => {
    await setPoint(TEMPLES.ref, 'missing_since = NOW()');
    expect(await gate(TEMPLES.ref)).toMatchObject({ missing: true, source_membership: 'present' });
    expect(await outOfStep()).toEqual([]);

    await setPoint(TEMPLES.ref, "source_membership = 'former'");
    expect(await gate(TEMPLES.ref)).toMatchObject({ missing: true, source_membership: 'former' });
    expect(await outOfStep()).toEqual([]);

    await setPoint(TEMPLES.ref, "missing_since = NULL, source_membership = 'present'");
    expect(await gate(TEMPLES.ref)).toMatchObject({ missing: false, source_membership: 'present' });
  });

  it('reads only its line: another kind\'s point on the part leaves the record alone', async () => {
    // The temples are also Archaeology's place, whose own point stands while the list withdraws the line.
    const temples = await partOf(TEMPLES.ref);
    const dig = (await pool.query<{ id: number }>(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state)
       SELECT $1, s.kind_id, s.id, 'Q9690001', 'verified' FROM experience_sources s WHERE s.id = $2 RETURNING id`,
      [temples, ARCHAEOLOGY_SOURCE],
    )).rows[0].id;
    await pool.query(
      `WITH pt AS (
         INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
         VALUES ($1, 'Baalbek temples', 'Q9690001', ST_SetSRID(ST_MakePoint(36.2040, 34.0070), 4326), 'verified') RETURNING id)
       INSERT INTO experience_location_placements (location_id, membership_id) SELECT id, $2 FROM pt`,
      [temples, dig],
    );
    await setPoint(TEMPLES.ref, 'missing_since = NOW()');

    expect(await gate(TEMPLES.ref)).toMatchObject({ curation_state: 'auto', missing: true });
    expect(await outOfStep()).toEqual([]);
  });

  it('takes the gate of the place a record moves to', async () => {
    // A merge folds the quarry into a place whose own point a curator has read, and moves its record there.
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'part:9691', 'Stone of the Pregnant Woman', ST_SetSRID(ST_MakePoint(36.1997, 33.9993), 4326)
         FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
      [SURVIVOR],
    );
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, location, curation_state)
       VALUES ($1, 'Stone of the Pregnant Woman', ST_SetSRID(ST_MakePoint(36.1997, 33.9993), 4326), 'verified')`,
      [SURVIVOR],
    );
    await pool.query(
      'UPDATE source_records SET experience_id = $1 WHERE source_id = 10 AND whole_id = $2 AND external_id = $3',
      [SURVIVOR, SITE, QUARRY.ref],
    );

    expect(await gate(QUARRY.ref)).toMatchObject({ part_id: SURVIVOR, curation_state: 'verified' });
  });
});

describe('a part\'s record asks the review queue nothing of its own', () => {
  /** The keys an admin's queue holds for the quarry's part, by kind. */
  async function quarryKeys(): Promise<string[]> {
    const admin = (await pool.query<{ id: number }>(
      "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN_UUID],
    )).rows[0].id;
    const quarry = await partOf(QUARRY.ref);
    const { keys } = await queryQueueKeys({
      userId: admin, isAdmin: true, filters: { q: 'Pregnant Woman', sort: 'date', limit: 25 },
    });
    return keys.filter(key => key.id === quarry).map(key => key.kind);
  }

  it('makes a pending part record no arrival: no key, no count, nothing still arriving', async () => {
    expect(await gate(QUARRY.ref)).toMatchObject({ curation_state: 'pending' });

    expect(await quarryKeys()).toEqual([]);
    expect((await waitingCountsBySource()).get(COMPONENTS_SOURCE)?.arrivals ?? 0).toBe(0);
    // What the visit and kind suggestions ask before they suggest (STILL_ARRIVING).
    const arriving = await pool.query(
      `SELECT 1 FROM source_records m JOIN experiences e ON e.id = m.experience_id
        WHERE m.experience_id = $1 AND ${arrivalOpenSql('e', 'm')}`,
      [await partOf(QUARRY.ref)],
    );
    expect(arriving.rows).toEqual([]);
  });

  it('makes a turned-down part record no refusal a rule asks about', async () => {
    await setPoint(QUARRY.ref, 'refused_at = NOW()');
    expect(await gate(QUARRY.ref)).toMatchObject({ admission: 'refused' });

    expect(await quarryKeys()).toEqual([]);
  });
});

describe('the review queue and a reader ask a part\'s gate of its record (ADR-0213)', () => {
  async function adminId(): Promise<number> {
    return (await pool.query<{ id: number }>(
      "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN_UUID],
    )).rows[0].id;
  }

  /** The subs of the site's waiting key in an admin's queue: 'contents' while it holds a part nobody has read. */
  async function siteSubs(admin: number): Promise<string[]> {
    const { keys } = await queryQueueKeys({
      userId: admin, isAdmin: true, filters: { q: 'Baalbek (gate fixture)', sort: 'date', limit: 25 },
    });
    return keys.filter(key => key.id === SITE && key.kind === 'waiting').flatMap(key => key.subs);
  }

  async function partOffered(ref: string): Promise<boolean> {
    return (await pool.query<{ offered: boolean }>(
      `SELECT ${partOfferedSql('e')} AS offered FROM experiences e WHERE e.id = $1`, [await partOf(ref)],
    )).rows[0].offered;
  }

  it('asks the site about a part while its record is unread, whatever its point says', async () => {
    const admin = await adminId();
    expect(await siteSubs(admin)).toEqual(['contents']);

    // The temples, read on their point, get a record nobody has read: written
    // as a new record is, outside the derivation, so only the record says so.
    const temples = await partOf(TEMPLES.ref);
    await pool.query('DELETE FROM source_records WHERE source_id = $1 AND whole_id = $2 AND experience_id = $3',
      [COMPONENTS_SOURCE, SITE, temples]);
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, curation_state)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [temples, SITE, COMPONENTS_SOURCE, TEMPLES.ref],
    );
    await setPoint(QUARRY.ref, "curation_state = 'verified'");

    expect(await gate(TEMPLES.ref)).toMatchObject({ curation_state: 'pending' });
    expect(await siteSubs(admin)).toEqual(['contents']);
    expect(await partOffered(TEMPLES.ref)).toBe(false);
  });

  it('shows a part by its record: withdrawn or turned down on its record, it is not offered', async () => {
    await setPoint(QUARRY.ref, "curation_state = 'verified'");
    expect(await partOffered(QUARRY.ref)).toBe(true);

    // Written on the record alone; its point still stands, published.
    await pool.query(
      'UPDATE source_records SET missing_since = NOW() WHERE source_id = $1 AND whole_id = $2 AND external_id = $3',
      [COMPONENTS_SOURCE, SITE, QUARRY.ref],
    );
    expect(await partOffered(QUARRY.ref)).toBe(false);

    await pool.query(
      `UPDATE source_records SET missing_since = NULL, admission = 'refused'
        WHERE source_id = $1 AND whole_id = $2 AND external_id = $3`,
      [COMPONENTS_SOURCE, SITE, QUARRY.ref],
    );
    expect(await partOffered(QUARRY.ref)).toBe(false);
  });

  it('hides a part whose line point a curator judged lost, which its record does not follow', async () => {
    expect(await partOffered(TEMPLES.ref)).toBe(true);

    await setPoint(TEMPLES.ref, "existence = 'lost'");

    expect(await gate(TEMPLES.ref)).toMatchObject({ curation_state: 'auto', admission: 'admitted', missing: false });
    expect(await partOffered(TEMPLES.ref)).toBe(false);
  });

  it('hides a part whose every line point a merge folded, which its record does not follow', async () => {
    await setPoint(QUARRY.ref, "curation_state = 'verified'");
    expect(await partOffered(TEMPLES.ref)).toBe(true);

    // The temples' point folded into the quarry's, as a merge folds a point into the one it keeps.
    const kept = (await pool.query<{ id: number }>(
      'SELECT id FROM experience_locations WHERE experience_id = $1', [await partOf(QUARRY.ref)],
    )).rows[0].id;
    await setPoint(TEMPLES.ref, `merged_into_id = ${kept}`);

    expect(await gate(TEMPLES.ref)).toMatchObject({ curation_state: 'auto', missing: false });
    expect(await partOffered(TEMPLES.ref)).toBe(false);
  });

  it('shows a part no source records in its whole by a point of its own', async () => {
    await setPoint(QUARRY.ref, "curation_state = 'verified'");
    // A curator's word makes the quarry a part, and the list's record goes.
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, admission, curation_state, published_at)
       VALUES ($1, $2, 11, 'curator-9690-1', 'admitted', 'verified', NOW())`,
      [await partOf(QUARRY.ref), SITE],
    );
    const quarry = await partOf(QUARRY.ref);
    await pool.query('DELETE FROM source_records WHERE source_id = $1 AND whole_id = $2 AND experience_id = $3',
      [COMPONENTS_SOURCE, SITE, quarry]);

    expect((await pool.query<{ offered: boolean }>(
      `SELECT ${partOfferedSql('e')} AS offered FROM experiences e WHERE e.id = $1`, [quarry],
    )).rows[0].offered).toBe(true);
  });
});

describe('a part whose record and points disagree (part-gate-out-of-step)', () => {
  it('names a part whose record did not follow its points', async () => {
    // A record written behind the derivation's back: withdrawn, while its line stands.
    await pool.query(
      "UPDATE source_records SET missing_since = NOW() WHERE source_id = 10 AND whole_id = $1 AND external_id = '294-001'",
      [SITE],
    );
    const temples = await partOf(TEMPLES.ref);

    const rows = await outOfStep();
    expect(rows).toMatchObject([{ part_id: temples, by_points: 'shown', by_record: 'withdrawn' }]);
    expect(partAssertions.find(a => a.id === 'part-gate-out-of-step')!.describe(rows[0]))
      .toBe(`Baalbek (gate fixture) (#${SITE}): Temples of Bacchus and Jupiter (#${temples}) is shown by its points and withdrawn by its record`);
  });

  it('names a part the list gives again at a new spot after it dropped its published line', async () => {
    // The temples' line was published, then dropped; the list gives a line of
    // the same name again, which waits for a curator, and the run moves it onto
    // the temples (part_site_components, #2182). The record stays read and
    // listed, since a read record never goes back to pending; the points read
    // the part as unread. The second known gap, until the writers move.
    await setPoint(TEMPLES.ref, 'missing_since = NOW()');
    await line({ ...TEMPLES, ref: '294-004', lon: 36.2045 }, 'pending');
    await pool.query('SELECT part_site_components($1, $2)', [SITE, membershipId]);
    const temples = await partOf(TEMPLES.ref);
    expect((await pool.query('SELECT count(*)::int AS n FROM experience_locations WHERE experience_id = $1', [temples])).rows[0].n)
      .toBe(2);

    expect(await gate(TEMPLES.ref)).toMatchObject({ curation_state: 'auto', missing: false });
    expect(await outOfStep()).toMatchObject([{ part_id: temples, by_points: 'unread', by_record: 'shown' }]);
  });

  it('names a part whose line point a curator judged lost, which the record leaves to the part', async () => {
    await setPoint(TEMPLES.ref, "existence = 'lost'");

    expect(await outOfStep()).toMatchObject([{ by_points: 'hidden', by_record: 'shown' }]);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerAdmissionUnderLock } from './lifecycleController.js';
import { publishUnderLock } from './publishController.js';
import { refuseArrivalUnderLock } from './curatorRefusalController.js';
import { answeredSourceId } from './experienceScope.js';

/**
 * A curator's answer names the membership it is about (#1264, ADR-0084),
 * executed against PostgreSQL: which membership a writer reaches is decided in
 * SQL under the place's lock.
 *
 * The fixture is the Capitoline Museums as Epic #755 will leave them: one place
 * readers already see as an art museum, and an Archaeology membership that has
 * just arrived and nobody has passed. Ids are the fixture's own, deleted before
 * and after.
 */

const CAPITOLINE = 9500;
const OTHER_PLACE = 9501;
const QID = 'Q9500-capitoline-fixture';
const USER_UUID = '00000000-0000-4000-8000-000000009500';

let userId = 0;
let artMembership = 0;
let archaeologyMembership = 0;
let otherMembership = 0;

async function membership(id: number): Promise<{ curation_state: string; admission: string; pinned: boolean }> {
  const result = await pool.query(
    `SELECT curation_state, admission, curated_fields ? 'admission' AS pinned
       FROM experience_kind_memberships WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [[CAPITOLINE, OTHER_PLACE]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[CAPITOLINE, OTHER_PLACE]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

async function insertMembership(
  placeId: number, sourceName: string, state: 'auto' | 'pending', externalId: string,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $3, $2::text, CASE WHEN $2::text = 'auto' THEN NOW() END
       FROM experience_sources s WHERE s.name = $4
     RETURNING id`,
    [placeId, state, externalId, sourceName],
  );
  return result.rows[0].id;
}

beforeEach(async () => {
  await clear();
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`,
    [USER_UUID],
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT v.id, s.id, v.qid, v.name, ST_SetSRID(ST_MakePoint(12.48278, 41.89306), 4326)
       FROM (VALUES ($1::int, $2::text, 'Capitoline Museums'), ($3::int, $2 || '-other', 'Another place')) AS v(id, qid, name)
       CROSS JOIN experience_sources s WHERE s.name = 'Art Museums'`,
    [CAPITOLINE, QID, OTHER_PLACE],
  );
  artMembership = await insertMembership(CAPITOLINE, 'Art Museums', 'auto', QID);
  archaeologyMembership = await insertMembership(CAPITOLINE, 'Archaeology', 'pending', QID);
  otherMembership = await insertMembership(OTHER_PLACE, 'Archaeology', 'pending', `${QID}-other`);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('an answer that names its membership (ADR-0084)', () => {
  it('publishes the Archaeology arrival and leaves the art museum as it was', async () => {
    const { refusal } = await publishUnderLock(CAPITOLINE, userId, null, { membershipId: archaeologyMembership });

    expect(refusal).toBeUndefined();
    expect((await membership(archaeologyMembership)).curation_state).not.toBe('pending');
    expect((await membership(artMembership)).curation_state).toBe('auto');
  });

  it('keeps out the arrival it names, and only that one', async () => {
    const { refusal } = await refuseArrivalUnderLock(CAPITOLINE, userId, null, { membershipId: archaeologyMembership });

    expect(refusal).toBeUndefined();
    expect((await membership(archaeologyMembership)).admission).toBe('refused');
    expect((await membership(artMembership)).admission).toBe('admitted');
  });

  it('answers the refusal of the membership it names', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET admission = 'refused', admission_reason = 'a fixture rule'
        WHERE id = ANY($1::int[])`,
      [[artMembership, archaeologyMembership]],
    );

    // Archaeology, though Art Museums comes first in the kinds' order and is the
    // one an answer naming no membership would reach.
    const { refusal } = await answerAdmissionUnderLock(
      CAPITOLINE, userId, null, { decision: 'override', membershipId: archaeologyMembership },
    );

    expect(refusal).toBeUndefined();
    expect(await membership(archaeologyMembership)).toMatchObject({ admission: 'admitted', pinned: true });
    expect(await membership(artMembership)).toMatchObject({ admission: 'refused', pinned: false });
  });

  it('is scoped by the source of the membership it names, not the place\'s first source', async () => {
    const sources = await pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM experience_sources WHERE name IN ('Art Museums', 'Archaeology')`,
    );
    const idOf = (name: string) => sources.rows.find(row => row.name === name)!.id;

    expect(await answeredSourceId(CAPITOLINE, archaeologyMembership)).toBe(idOf('Archaeology'));
    expect(await answeredSourceId(CAPITOLINE)).toBe(idOf('Art Museums'));
    // A membership of another place leaves the place's own source; the writer refuses the answer.
    expect(await answeredSourceId(CAPITOLINE, otherMembership)).toBe(idOf('Art Museums'));
    expect(await answeredSourceId(9599)).toBeNull();
  });

  it('refuses a membership of another place as a question this place does not have', async () => {
    const { refusal } = await refuseArrivalUnderLock(CAPITOLINE, userId, null, { membershipId: otherMembership });

    expect(refusal?.status).toBe(409);
    expect((await membership(otherMembership)).admission).toBe('admitted');
    expect((await membership(archaeologyMembership)).admission).toBe('admitted');

    // A publish says the card is stale, not that the place belongs to no kind.
    const published = await publishUnderLock(CAPITOLINE, userId, null, { membershipId: otherMembership });
    expect(published.refusal).toMatchObject({ status: 409, error: expect.stringMatching(/reload/) });
    expect((await membership(archaeologyMembership)).curation_state).toBe('pending');
  });
});

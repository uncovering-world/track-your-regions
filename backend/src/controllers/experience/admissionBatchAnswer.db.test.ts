import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerAdmissionUnderLock } from './lifecycleController.js';
import { markNotAdmitted, markRefused } from '../../services/sync/admission.js';
import { refusedOpenSql } from './reviewQueuePredicates.js';
import { admissionAnsweredSql } from '../../db/membership.js';

/**
 * A batch answer to a refusal pins nothing (#906, ADR-0067), executed against
 * PostgreSQL: what is asserted is which question a row is left asking after
 * the answer and after the next run, which only the real statements can say.
 *
 * The fixture is the Egyptian Museum of Berlin as the Art Museums rule refused
 * it — folded into the Neues Museum that houses it — and a curator. Its ids
 * are its own, deleted before and after.
 */

const EXPERIENCE_ID = 9400;
const EXTERNAL_ID = 'Q9400-egyptian-museum';
const USER_UUID = '00000000-0000-4000-8000-000000009400';
const REASON = 'folded into Neues Museum — housed in it, 11 m away';

let sourceId = 0;
let userId = 0;

interface State {
  admission: string;
  pinned: boolean;
  answered: boolean;
  open: boolean;
}

async function state(): Promise<State> {
  const result = await pool.query<State>(
    `SELECT m.admission,
            m.curated_fields ? 'admission' AS pinned,
            ${admissionAnsweredSql('m')} AS answered,
            (${refusedOpenSql('m')}) AS open
       FROM experience_kind_memberships m
      WHERE m.experience_id = $1`,
    [EXPERIENCE_ID],
  );
  return result.rows[0];
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [EXPERIENCE_ID]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [EXPERIENCE_ID]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'Art Museums'`,
  );
  expect(source.rowCount).toBe(1);
  sourceId = source.rows[0].id;
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`,
    [USER_UUID],
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Egyptian Museum of Berlin', ST_SetSRID(ST_MakePoint(13.3975, 52.5206), 4326))`,
    [EXPERIENCE_ID, sourceId, EXTERNAL_ID],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, admission, admission_reason, curation_state)
     VALUES ($1, $2, $3, 'refused', $4, 'auto')`,
    [EXPERIENCE_ID, source.rows[0].kind_id, sourceId, REASON],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a batch answer to a refusal (#906)', () => {
  it('keeps the row out on accept, closing the question without a pin', async () => {
    const outcome = await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'confirm', pin: false });
    expect(outcome.refusal).toBeUndefined();

    expect(await state()).toEqual({ admission: 'refused', pinned: false, answered: true, open: false });
  });

  it('leaves a confirmed refusal answered when the next run refuses it again', async () => {
    await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'confirm', pin: false });

    await markRefused(sourceId, [{ externalId: EXTERNAL_ID, reason: REASON }], false);

    expect(await state()).toEqual({ admission: 'refused', pinned: false, answered: true, open: false });
  });

  it('puts the row back for now on reject, and the next run asks again if the rule still refuses it', async () => {
    await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'override', pin: false });
    expect(await state()).toEqual({ admission: 'admitted', pinned: false, answered: false, open: false });

    await markNotAdmitted(sourceId, ['some-other-museum'], REASON, false);

    expect(await state()).toEqual({ admission: 'refused', pinned: false, answered: false, open: true });
  });

  it('still pins a card\'s answer, which a person gave to this one row', async () => {
    await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'confirm' });

    expect(await state()).toEqual({ admission: 'refused', pinned: true, answered: true, open: false });
  });

  it('refuses a batch put-back over a card\'s answer, so a batch never keeps a person\'s pin', async () => {
    // The card confirms between the batch's open-question read and its lock.
    await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'confirm' });

    const batch = await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'override', pin: false });

    expect(batch.refusal?.status).toBe(409);
    expect(await state()).toEqual({ admission: 'refused', pinned: true, answered: true, open: false });
  });

  it('refuses a second batch confirmation of a question already answered', async () => {
    await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'confirm', pin: false });

    const second = await answerAdmissionUnderLock(EXPERIENCE_ID, userId, null, { decision: 'confirm', pin: false });

    expect(second.refusal?.status).toBe(409);
  });
});

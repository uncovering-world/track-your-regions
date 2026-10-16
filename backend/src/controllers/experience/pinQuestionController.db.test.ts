import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { reviewQueueQuerySchema } from '../../types/index.js';
import { answerPinQuestionUnderLock } from './pinQuestionController.js';
import { getReviewQueue } from './reviewQueueController.js';

/**
 * A curator's answer to a run that asked again about their admission pin
 * (#1367), executed against PostgreSQL: the question as the queue shows it,
 * and both answers under the place's lock.
 *
 * The fixture is Villa Farnesina as the development catalogue held it on
 * 2026-10-12: put back into Art Museums on 2026-08-08 over the rule's "probe:
 * site class villa", while the run of 2026-10-07 refuses it as "site, not a
 * venue: villa — named by Galatea (25 sitelinks)". Ids are the fixture's own,
 * deleted before and after.
 */

const FARNESINA = 9530;
const QID = 'Q9530-farnesina-fixture';
const NAME = 'Villa Farnesina (pin fixture)';
const ANSWERED = 'probe: site class villa — put back by the kept-out card';
const ASKED = 'site, not a venue: villa — named by Galatea (25 sitelinks)';
const ADMIN = '00000000-0000-4000-8000-000000009530';

let adminId = 0;
let membershipId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [FARNESINA]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(12.4672, 41.8936), 4326)
       FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [FARNESINA, QID, NAME],
  );
  membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curated_fields,
       admission_pin_verdict, admission_pin_reason,
       admission_question_verdict, admission_question_reason, admission_questioned_at)
     SELECT $1, s.kind_id, s.id, $2, 'admitted', '["admission"]', 'refused', $3, 'refused', $4, NOW()
       FROM experience_sources s WHERE s.name = 'Art Museums' RETURNING id`,
    [FARNESINA, QID, ANSWERED, ASKED],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_curation_log (experience_id, curator_id, action, details)
     VALUES ($1, $2, 'admission_overridden', $3)`,
    [FARNESINA, adminId, JSON.stringify({ membershipId, reason: ANSWERED, note: 'Raphael’s frescoes are the point' })],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const membership = async () => (await pool.query<{
  admission: string; pinned: boolean; admission_reason: string | null; admission_pin_reason: string | null;
  admission_question_verdict: string | null;
}>(
  `SELECT admission, curated_fields ? 'admission' AS pinned, admission_reason, admission_pin_reason,
          admission_question_verdict
     FROM experience_kind_memberships WHERE id = $1`,
  [membershipId],
)).rows[0];

const answer = (decision: 'keep' | 'release', asked = { verdict: 'refused' as const, reason: ASKED as string | null }) =>
  answerPinQuestionUnderLock(FARNESINA, adminId, null, { decision, membershipId, asked, note: 'read again' });

describe("a run's question about a pin, in the queue", () => {
  it("is one card naming the curator's answer, its note, and what the run says now", async () => {
    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });

    expect(queue.order).toEqual([expect.objectContaining({ kind: 'pin-question', id: FARNESINA })]);
    expect(queue.pinQuestions).toEqual([expect.objectContaining({
      id: FARNESINA, membership_id: membershipId,
      pin_question: expect.objectContaining({
        answer: 'admitted', answeredReason: ANSWERED, askedVerdict: 'refused', askedReason: ASKED,
        note: 'Raphael’s frescoes are the point', restated: false,
      }),
    })]);
  });

  it('says when the run asks again in the words the curator answered over (#1370)', async () => {
    // A run started to ask again about the pins: the same refusal, its counts aside.
    await pool.query(
      `UPDATE experience_kind_memberships SET admission_pin_reason = '17 sitelinks: below the line',
              admission_question_reason = '19 sitelinks: below the line' WHERE id = $1`,
      [membershipId],
    );
    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });
    expect(queue.pinQuestions?.[0]?.pin_question).toMatchObject({ restated: true });
  });
});

describe("a curator's answer to it", () => {
  it('keeps the pin, which now answers what the run says', async () => {
    const outcome = await answer('keep');

    expect(outcome.result).toEqual({ experienceId: FARNESINA, membershipId, admission: 'admitted', pinned: true });
    expect(await membership()).toMatchObject({
      admission: 'admitted', pinned: true, admission_pin_reason: ASKED, admission_question_verdict: null,
    });
    const log = await pool.query(
      "SELECT details FROM experience_curation_log WHERE experience_id = $1 AND action = 'admission_pin_kept'", [FARNESINA],
    );
    expect(log.rows[0].details).toMatchObject({ membershipId, reason: ASKED, note: 'read again' });
  });

  it("lets the rule decide: the run's refusal written in the pin's place", async () => {
    const outcome = await answer('release');

    expect(outcome.result).toMatchObject({ admission: 'refused', pinned: false });
    expect(await membership()).toMatchObject({
      admission: 'refused', pinned: false, admission_reason: ASKED, admission_pin_reason: null,
      admission_question_verdict: null,
    });
  });

  it('refuses an answer to a question the run has changed since the card was read', async () => {
    const outcome = await answer('keep', { verdict: 'refused', reason: ANSWERED });

    expect(outcome.refusal).toMatchObject({ status: 409 });
    expect((await membership()).admission_question_verdict).toBe('refused');
  });

  it('refuses a second answer, and writes nothing', async () => {
    await answer('keep');
    const second = await answer('release');

    expect(second.refusal).toMatchObject({ status: 409 });
    expect(await membership()).toMatchObject({ admission: 'admitted', pinned: true });
  });
});

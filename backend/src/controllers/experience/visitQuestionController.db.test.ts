import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { reviewQueueQuerySchema } from '../../types/index.js';
import { getJevUsage } from '../admin/jevUsageController.js';
import { answerRow } from './reviewAnswerDispatch.js';
import { getReviewQueue } from './reviewQueueController.js';
import { answerVisitQuestionUnderLock, VISIT_REFUSAL_REASON } from './visitQuestionController.js';

/**
 * A curator's answer to a run's question about an offered place with nothing
 * to see (#1770), executed against PostgreSQL: the question as the queue
 * shows it, both answers under the place's lock, and the batch's.
 *
 * The fixture is Eboracum, Roman York, as the survey of 2026-10-21 found it in
 * Archaeology: offered, no visit witness vouching for it, and read by Jev as
 * not a place (a Roman town under a living city, whose remains are shown in
 * other places' cards). Ids are the fixture's own, deleted before and after.
 */

const EBORACUM = 9771;
const QID = 'Q9771-eboracum-fixture';
const NAME = 'Eboracum (visit question fixture)';
const ADMIN = '00000000-0000-4000-8000-000000009771';

let adminId = 0;
let membershipId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [EBORACUM]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(-1.0803, 53.9623), 4326)
       FROM experience_sources s WHERE s.name = 'Archaeology'`,
    [EBORACUM, QID, NAME],
  );
  membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = 'Archaeology' RETURNING id`,
    [EBORACUM, QID],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_visit_questions (membership_id, witnesses, reading, confidence)
     VALUES ($1, '{}', 'not-a-place', 0.9)`,
    [membershipId],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const caller = () => ({ id: adminId, role: 'admin' } as Express.User);
const queue = () => getReviewQueue({ query: reviewQueueQuerySchema.parse({ q: NAME }), caller: caller() });

const state = async () => (await pool.query<{
  admission: string; pinned: boolean; admission_reason: string | null;
  answer: string | null; answered_by: number | null; answered: boolean;
}>(
  `SELECT m.admission, m.curated_fields ? 'admission' AS pinned, m.admission_reason,
          q.answer, q.answered_by, q.answered_at IS NOT NULL AS answered
     FROM experience_kind_memberships m JOIN experience_visit_questions q ON q.membership_id = m.id
    WHERE m.id = $1`,
  [membershipId],
)).rows[0];

const answer = (decision: 'keep' | 'refuse') =>
  answerVisitQuestionUnderLock(EBORACUM, adminId, null, { decision, membershipId, note: 'Roman York is the city' });

describe("a run's question about a place with nothing to see, in the queue", () => {
  it('is one card naming the witnesses and the reading it was raised on', async () => {
    const read = await queue();

    expect(read.order).toEqual([expect.objectContaining({ kind: 'visit-question', id: EBORACUM })]);
    expect(read.visitQuestions).toEqual([expect.objectContaining({
      id: EBORACUM, membership_id: membershipId, kind_name: 'Archaeology',
      visit_question: expect.objectContaining({ witnesses: [], reading: 'not-a-place', confidence: 0.9 }),
    })]);
  });

  it('asks nothing once a curator pinned the admission another way', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET curated_fields = '["admission"]', admission_pin_verdict = 'admitted'
        WHERE id = $1`,
      [membershipId],
    );
    expect((await queue()).visitQuestions).toEqual([]);
  });
});

describe("a curator's answer to it", () => {
  it('refuses the place from the kind as a curator does, pinned, and in the kept-out list', async () => {
    const outcome = await answer('refuse');

    expect(outcome.result).toEqual({ experienceId: EBORACUM, membershipId, answer: 'refused', admission: 'refused' });
    expect(await state()).toEqual({
      admission: 'refused', pinned: true, admission_reason: VISIT_REFUSAL_REASON,
      answer: 'refused', answered_by: adminId, answered: true,
    });
    const log = await pool.query(
      "SELECT details FROM experience_curation_log WHERE experience_id = $1 AND action = 'visit_question_answered'",
      [EBORACUM],
    );
    expect(log.rows[0].details).toMatchObject({
      membershipId, answer: 'refused', reading: 'not-a-place', confidence: 0.9, witnesses: [], note: 'Roman York is the city',
    });
    const read = await queue();
    expect(read.visitQuestions).toEqual([]);
    expect(read.keptOut).toEqual([expect.objectContaining({
      id: EBORACUM, membership_id: membershipId, admission_reason: VISIT_REFUSAL_REASON, state_note: 'Roman York is the city',
    })]);
  });

  it('keeps the place as it was, and the question is answered', async () => {
    const outcome = await answer('keep');

    expect(outcome.result).toMatchObject({ answer: 'kept', admission: 'admitted' });
    expect(await state()).toEqual({
      admission: 'admitted', pinned: false, admission_reason: null, answer: 'kept', answered_by: adminId, answered: true,
    });
    expect((await queue()).visitQuestions).toEqual([]);
  });

  it('refuses a second answer with nothing written', async () => {
    await answer('keep');

    expect((await answer('refuse')).refusal).toMatchObject({ status: 409 });
    expect(await state()).toMatchObject({ admission: 'admitted', answer: 'kept' });
  });

  it("counts toward Jev's agreement: a refusal agrees with the reading", async () => {
    const before = (await getJevUsage()).byQuestion.find((q) => q.question === 'visits')!;
    await answer('refuse');
    const after = (await getJevUsage()).byQuestion.find((q) => q.question === 'visits')!;

    expect([after.compared - before.compared, after.agreed - before.agreed]).toEqual([1, 1]);
  });
});

describe('a batch answer to it', () => {
  const who = () => ({ experienceId: EBORACUM, userId: adminId, logRegionId: null, runId: null, membershipId });

  it('refuses accept, since a refusal pins and a batch pins nothing (ADR-0067)', async () => {
    expect(await answerRow(who(), 'visit-question', 'accept')).toMatchObject({ refusal: { status: 409 } });
    expect(await state()).toMatchObject({ admission: 'admitted', pinned: false, answer: null });
  });

  it('keeps on reject', async () => {
    expect(await answerRow(who(), 'visit-question', 'reject')).toEqual({ did: { visitQuestions: 1 } });
    expect(await state()).toMatchObject({ admission: 'admitted', answer: 'kept' });
  });

  it('refuses a row that names no kind', async () => {
    expect(await answerRow({ ...who(), membershipId: null }, 'visit-question', 'reject'))
      .toMatchObject({ refusal: { status: 409 } });
  });
});

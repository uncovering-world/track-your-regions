import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { questionPins } from './admissionStep.js';
import { writePinQuestions } from './pinQuestion.js';
import type { SyncServiceConfig } from './syncContract.js';
import type { SyncProgress } from './types.js';

/**
 * A run asks about a curator's admission pin when it disagrees with it, and
 * stops asking when it no longer does (#1367), executed against PostgreSQL:
 * the question is written beside the pin, and the row's admission never moves.
 *
 * The fixture is the Isabella Stewart Gardner Museum as the development
 * catalogue held it on 2026-10-12: put back into Art Museums over the rule's
 * "its famous works cannot be seen", and pinned. Ids are the fixture's own,
 * deleted before and after.
 */

const GARDNER = 9520;
const QID = 'Q9520-gardner-fixture';
const ANSWERED = 'its famous works cannot be seen — The Storm on the Sea of Galilee (whereabouts unknown)';

let sourceId = 0;
let syncLogId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [GARDNER]);
  await pool.query("DELETE FROM experience_sync_logs WHERE error_details @> '[{\"fixture\": \"pin-question\"}]'");
}

beforeEach(async () => {
  await clear();
  sourceId = (await pool.query<{ id: number }>("SELECT id FROM experience_sources WHERE name = 'Art Museums'")).rows[0].id;
  syncLogId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, error_details)
     VALUES ($1, 'success', NOW(), '[{"fixture": "pin-question"}]') RETURNING id`,
    [sourceId],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Isabella Stewart Gardner Museum (fixture)', ST_SetSRID(ST_MakePoint(-71.0989, 42.3382), 4326))`,
    [GARDNER, sourceId, QID],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curated_fields,
       admission_pin_verdict, admission_pin_reason)
     SELECT $1, s.kind_id, s.id, $2, 'admitted', '["admission"]', 'refused', $3 FROM experience_sources s WHERE s.id = $4`,
    [GARDNER, QID, ANSWERED, sourceId],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const config = { sourceId: 0, recomputesMembership: true, logPrefix: '[fixture]' } as unknown as SyncServiceConfig<unknown>;
const run = (refusals: { externalId: string; reason: string }[], admitted: string[]) => questionPins(
  { ...config, sourceId },
  { logId: syncLogId, dryRun: false } as SyncProgress,
  refusals, admitted, { swept: false, skipReason: null },
);

async function membership() {
  return (await pool.query<{
    admission: string; admission_question_verdict: string | null; admission_question_reason: string | null;
    admission_questioned_at: Date | null; admission_question_sync_log_id: number | null;
  }>(
    `SELECT admission, admission_question_verdict, admission_question_reason, admission_questioned_at,
            admission_question_sync_log_id
       FROM experience_kind_memberships WHERE experience_id = $1`,
    [GARDNER],
  )).rows[0];
}

describe("a run's question about a curator's admission pin (#1367)", () => {
  it('asks when the rule refuses the put-back for another reason, and leaves the admission alone', async () => {
    await run([{ externalId: QID, reason: 'site, not a venue: museum' }], []);

    expect(await membership()).toMatchObject({
      admission: 'admitted', admission_question_verdict: 'refused',
      admission_question_reason: 'site, not a venue: museum', admission_question_sync_log_id: syncLogId,
    });
  });

  it('keeps the date a question was first asked while runs ask the same', async () => {
    await run([{ externalId: QID, reason: 'site, not a venue: museum' }], []);
    const first = (await membership()).admission_questioned_at;
    await run([{ externalId: QID, reason: 'site, not a venue: museum' }], []);

    expect((await membership()).admission_questioned_at).toEqual(first);
  });

  it('asks nothing while the rule refuses for the reason the pin answered, a count aside', async () => {
    await run([{ externalId: QID, reason: ANSWERED }], []);
    expect((await membership()).admission_question_verdict).toBeNull();

    await pool.query(
      `UPDATE experience_kind_memberships SET admission_pin_reason = $2 WHERE experience_id = $1`,
      [GARDNER, "17 sitelinks: below the world tier's line (22 to enter, 18 to stay)"],
    );
    await run([{ externalId: QID, reason: "19 sitelinks: below the world tier's line (22 to enter, 18 to stay)" }], []);
    expect((await membership()).admission_question_verdict).toBeNull();
  });

  it("asks nothing when only the rule's word for the measure changed (#1589)", async () => {
    // The Warsaw Uprising Monument's pin, answered before #1240 renamed the measure.
    await pool.query(
      `UPDATE experience_kind_memberships SET admission_pin_reason = $2 WHERE experience_id = $1`,
      [GARDNER, "17 sitelinks: below the world tier's line (22 to enter, 18 to stay)"],
    );
    await run([{ externalId: QID, reason: "16 Wikipedia editions: below the world tier's line (22 to enter, 18 to stay)" }], []);

    expect((await membership()).admission_question_verdict).toBeNull();
  });

  it('closes the question once the rule admits what the curator put back', async () => {
    await run([{ externalId: QID, reason: 'site, not a venue: museum' }], []);
    await run([], [QID]);

    expect(await membership()).toMatchObject({ admission_question_verdict: null, admission_questioned_at: null });
  });

  it('keeps the date while the question stands and only a count in it ticks', async () => {
    await run([{ externalId: QID, reason: 'not an art museum — painting-share: 0 painting(s) vs 2 sculptural work(s)' }], []);
    const first = (await membership()).admission_questioned_at;
    await run([{ externalId: QID, reason: 'not an art museum — painting-share: 0 painting(s) vs 3 sculptural work(s)' }], []);

    expect(await membership()).toMatchObject({
      admission_questioned_at: first,
      admission_question_reason: 'not an art museum — painting-share: 0 painting(s) vs 3 sculptural work(s)',
    });
  });

  it('asks nothing of a pin a curator answered after the run read it', async () => {
    const membershipId = (await pool.query<{ id: number }>(
      'SELECT id FROM experience_kind_memberships WHERE experience_id = $1', [GARDNER],
    )).rows[0].id;
    // The curator kept the pin over another reason in between: the view the run read is not the pin's any more.
    await pool.query(
      "UPDATE experience_kind_memberships SET admission_pin_reason = 'site, not a venue: museum' WHERE id = $1",
      [membershipId],
    );
    await writePinQuestions([{
      membershipId, verdict: 'refused', reason: 'site, not a venue: museum',
      read: { answer: 'admitted', answeredVerdict: 'refused', answeredReason: ANSWERED },
    }], [], syncLogId, false);

    expect((await membership()).admission_question_verdict).toBeNull();
  });

  it('keeps a question the run said nothing about this time', async () => {
    await run([{ externalId: QID, reason: 'site, not a venue: museum' }], []);
    await run([], []);

    expect((await membership()).admission_question_verdict).toBe('refused');
  });

  it('asks nothing about a row whose pin was handed back while the run ran', async () => {
    await pool.query("UPDATE experience_kind_memberships SET curated_fields = '[]' WHERE experience_id = $1", [GARDNER]);
    await run([{ externalId: QID, reason: 'site, not a venue: museum' }], []);

    expect((await membership()).admission_question_verdict).toBeNull();
  });
});

describe("a run started to ask again about the source's pins (#1370)", () => {
  const runWith = async (refusals: { externalId: string; reason: string }[], admitted: string[], askAll: boolean) => {
    const progress = { logId: syncLogId, dryRun: false } as SyncProgress;
    await questionPins({ ...config, sourceId }, progress, refusals, admitted, { swept: false, skipReason: null }, [], askAll);
    return progress.pins;
  };

  it('asks about a pin it disagrees with in the very words the curator answered', async () => {
    expect(await runWith([{ externalId: QID, reason: ANSWERED }], [], true)).toEqual({ asked: 1, agreed: 0, standing: 0 });
    expect(await membership()).toMatchObject({
      admission: 'admitted', admission_question_verdict: 'refused', admission_question_reason: ANSWERED,
    });
  });

  it('leaves such a pin standing on an ordinary run, and counts it', async () => {
    expect(await runWith([{ externalId: QID, reason: ANSWERED }], [], false)).toEqual({ asked: 0, agreed: 0, standing: 1 });
    expect((await membership()).admission_question_verdict).toBeNull();
  });

  it('keeps the question it raised through the ordinary runs after it, until a curator answers', async () => {
    await runWith([{ externalId: QID, reason: ANSWERED }], [], true);
    const raised = await membership();
    expect(await runWith([{ externalId: QID, reason: ANSWERED }], [], false)).toEqual({ asked: 1, agreed: 0, standing: 0 });
    expect(await membership()).toMatchObject({
      admission_question_verdict: 'refused', admission_question_reason: ANSWERED, admission_questioned_at: raised.admission_questioned_at,
    });
    // Once the rule comes round to the curator, the question closes as any does.
    expect(await runWith([], [QID], false)).toEqual({ asked: 0, agreed: 1, standing: 0 });
    expect((await membership()).admission_question_verdict).toBeNull();
  });

  it('closes a question an ordinary run raised once a run says the answered words again', async () => {
    // Reason A answered; a run refuses for B and asks; the next refuses for A again.
    await runWith([{ externalId: QID, reason: 'site, not a venue: museum' }], [], false);
    expect((await membership()).admission_question_reason).toBe('site, not a venue: museum');
    expect(await runWith([{ externalId: QID, reason: ANSWERED }], [], false)).toEqual({ asked: 0, agreed: 0, standing: 1 });
    expect((await membership()).admission_question_verdict).toBeNull();
  });

  it('asks nothing about a pin it agrees with, and counts it', async () => {
    expect(await runWith([], [QID], true)).toEqual({ asked: 0, agreed: 1, standing: 0 });
    expect((await membership()).admission_question_verdict).toBeNull();
  });
});

describe('a question stands only on a pinned row', () => {
  it('is refused by the schema on a row nobody pinned', async () => {
    await pool.query("UPDATE experience_kind_memberships SET curated_fields = '[]' WHERE experience_id = $1", [GARDNER]);
    await expect(pool.query(
      `UPDATE experience_kind_memberships
          SET admission_question_verdict = 'refused', admission_questioned_at = NOW() WHERE experience_id = $1`,
      [GARDNER],
    )).rejects.toThrow(/experience_kind_memberships_question_check/);
  });
});

/**
 * A curator's edit answers the held proposal for the field it sets (#2293).
 *
 * A gated run's change to a place readers already see waits on the place's
 * held card until a curator publishes or refuses it (ADR-0025 decision 5,
 * `heldDecisions.ts`). A curator who sets the same field by hand, from the
 * place's curation dialog, has answered that question: the field is theirs
 * now (`curated_fields`), and publishing would skip it. Left open, the card
 * would keep offering a value the curator has already ruled on, a question
 * with no answer left to give.
 *
 * So the edit records the answer it gave, by value, as the card's own two
 * answers are recorded: *published* where the curator typed what the run
 * proposed, *refused* otherwise. Both are standing answers to *that* value
 * only, so a source that comes back with something different asks again.
 * Recorded under the lock the edit took and in its transaction. A membership
 * left with nothing open loses its pointer the way a decline clears one
 * (`clearAnsweredHeldPointers`).
 *
 * A held row is answered per field (ADR-0038), and decision 2 there keeps
 * claiming apart from refusing: "this value is mine now" is not "I do not
 * want this value". An edit says the first, and it claims the field as it
 * always has. What it adds is that the held row it ruled on is settled, by
 * value, beside the claim: a refusal of a value the curator did not keep, a
 * publication of the one they typed.
 *
 * A picture and its credit are one answer (ADR-0038 decision 1a, `pictureCreditPartner`):
 * wherever the edit set the picture, the credit row takes the picture row's
 * answer, and is refused where the run proposed a credit alone for the picture
 * the edit replaced. Left open, such a credit could later be published under
 * the curator's photograph and name someone who did not take it. The one
 * credit left asked is the run's own beside the run's picture, which the edit
 * published without naming anyone: it is that picture's credit.
 *
 * The type within a kind is the membership's (ADR-0084): an edit writes it on
 * the membership the place is shown under, so it answers that membership's
 * run alone, and another kind's type proposal stays open.
 */
import type { PoolClient } from 'pg';
import { isEmptyValue, jsonEquals } from '@tyr/shared/equality';
import { HELD_CREDIT_FIELD, pictureCreditPartner } from '@tyr/shared/pictures';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { answeredHeldRows, KIND_FIELDS, recordHeldAnswers, tidyNameValue, type HeldAnswer } from './heldDecisions.js';
import { heldObjectRows, type HeldRow, type ProposedField } from './heldSelection.js';
import { clearAnsweredHeldPointers } from './membershipWriter.js';

/** One held row the edit answered: the field, the answer, the value it answered and the run that proposed it. */
export interface HeldSettled {
  field: string;
  answer: HeldAnswer;
  proposed: unknown;
  fromSyncLogId: number;
}

/** Whether what the curator stored is what the run proposed: names as stored, nothing as nothing. */
function sameAsProposed(field: string, proposed: unknown, stored: unknown): boolean {
  if (isEmptyValue(proposed) && isEmptyValue(stored)) return true;
  return jsonEquals(tidyNameValue(field, proposed), tidyNameValue(field, stored));
}

/**
 * Answer the open held rows of one membership's proposal whose field the edit
 * set, and say which.
 */
async function settleProposal(
  client: PoolClient,
  lock: LockedExperience,
  userId: number,
  edited: ReadonlyMap<string, unknown>,
  ofTheType: boolean,
  pointer: number,
): Promise<HeldSettled[]> {
  // The run's newest record of the place, the one its card and the decline read.
  const proposal = await client.query<{ changed_fields: ProposedField[] | null }>(
    `SELECT changed_fields FROM experience_sync_changes
      WHERE experience_id = $1 AND sync_log_id = $2
      ORDER BY id DESC LIMIT 1`,
    [lock.id, pointer],
  );
  const changed = proposal.rows?.[0]?.changed_fields;
  if (!changed) return [];
  const answered = await answeredHeldRows(client, lock.id, pointer);
  const open = heldObjectRows(changed, answered).filter(row => ofTheType || !KIND_FIELDS.has(row.ref.field));
  const answerOf = (field: string, proposed: unknown): HeldAnswer =>
    (sameAsProposed(field, proposed, edited.get(field)) ? 'published' : 'refused');
  const picture = pictureCreditPartner(HELD_CREDIT_FIELD, 'object') ?? '';
  const pictureRow = open.find(row => row.ref.field === picture);
  // The credit is the picture's: answered as its picture is, and refused where
  // the run proposed it alone for the picture the edit replaced.
  const creditAnswer: HeldAnswer = pictureRow ? answerOf(picture, pictureRow.proposed) : 'refused';
  const answerFor = (row: HeldRow): HeldAnswer | null => {
    const { field } = row.ref;
    if (field !== HELD_CREDIT_FIELD) return edited.has(field) ? answerOf(field, row.proposed) : null;
    // A credit is the edit's to answer only where it set the picture. The run's
    // credit stays asked beside the run's own picture, published by the edit,
    // where the edit could name nobody: it is then that picture's only credit.
    if (!edited.has(picture)) return null;
    return creditAnswer === 'published' && !edited.has(HELD_CREDIT_FIELD) ? null : creditAnswer;
  };
  const rows = open.flatMap(row => {
    const answer = answerFor(row);
    return answer ? [{ row, answer }] : [];
  });
  const settled: HeldSettled[] = [];
  for (const { row, answer } of rows) {
    const { field } = row.ref;
    await recordHeldAnswers(client, lock.id, userId, answer, [{ row: row.ref, value: row.proposed }], pointer);
    settled.push({ field, answer, proposed: row.proposed, fromSyncLogId: pointer });
  }
  return settled;
}

/**
 * Answer every open held row of the place whose field the edit set.
 *
 * @param edited each field the edit wrote, by the name a changeset gives it
 *   (`name`, `image_url`, `metadata.website`, …), with the value now stored
 * @param typeSourceId the source whose membership the edit's type was written on
 */
export async function settleHeldByEdit(
  client: PoolClient,
  lock: LockedExperience,
  userId: number,
  edited: ReadonlyMap<string, unknown>,
  typeSourceId: number | undefined,
): Promise<HeldSettled[]> {
  if (edited.size === 0) return [];
  const pending = await client.query<{ source_id: number; pointer: number }>(
    `SELECT m.source_id, m.pending_change_sync_log_id AS pointer FROM ${MEMBERSHIPS} m
      WHERE m.experience_id = $1 AND m.pending_change_sync_log_id IS NOT NULL
      ORDER BY m.id`,
    [lock.id],
  );
  const settled: HeldSettled[] = [];
  for (const { source_id: sourceId, pointer } of pending.rows ?? []) {
    settled.push(...await settleProposal(client, lock, userId, edited, sourceId === typeSourceId, pointer));
  }
  if (settled.length > 0) await clearAnsweredHeldPointers(client, lock);
  return settled;
}

/** What the edit's curation-log row says it answered, or nothing where it answered none. */
export function heldSettledDetails(settled: readonly HeldSettled[]): { heldSettled?: readonly HeldSettled[] } {
  return settled.length > 0 ? { heldSettled: settled } : {};
}

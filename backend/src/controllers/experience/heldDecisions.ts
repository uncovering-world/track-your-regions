/**
 * Which rows of a held proposal a curator has already answered, in the one place
 * that decides it.
 *
 * A gated run's proposal against a row readers can already see is kept out of the
 * columns and recorded (ADR-0025 decision 5, ADR-0037 for a field of a place or a
 * work). The card used to have one answer for the whole proposal. Since #722 it
 * has one per row, and this is the record of those answers: what was answered
 * about, and which of the two answers it was.
 *
 * Recorded **by value**, exactly as a conflict refusal is in
 * experience_conflict_decisions: the readers suppress a row only while the
 * proposal is jsonb-equal to what was answered, so a source that comes back with
 * a different value asks again. A field-level rule would be simpler and would
 * hide the one case a curator must see.
 *
 * Both verdicts, not only the refusal. Publishing the whole card clears
 * pending_change_sync_log_id, which is what takes the card away; publishing one
 * row of six leaves the pointer standing for the other five, and the run's record
 * still says the field it wrote was held. Without a row here that card would go
 * on offering a value it has already applied. The run's record is never rewritten
 * to say otherwise — what a changeset holds is what happened.
 *
 * Readers have to agree about whether one row is still open — the queue's held
 * card, the admin panel's count, the catalogue assertion comparing a danger flag
 * with its tag, and publishing. They agree by sharing these fragments rather than
 * by four spellings of one rule: the comparison is jsonb equality against a value
 * read off the proposal, and a copy of it in JavaScript would compare a
 * re-serialised object instead.
 *
 * One reader deliberately disagrees, and shares the module in order to say so
 * exactly once: `picture-with-nobody-credited` asks `heldFieldRefusedSql` /
 * `heldPartRefusedSql`, because a *published* credit may still be unwritten and
 * one click from being written. That is a different question, not a second
 * spelling of this one — see those functions.
 *
 * The part is identified the way partRecord.ts identifies it, which is the way
 * the record names it (ADR-0026 decision 4): the reference narrows, the name
 * decides. Nine (experience_id, external_ref) pairs on this database are
 * duplicated — a component crossing a border, listed once per country under one
 * number — and one point carries no reference at all, so neither half alone is an
 * identity. IS NOT DISTINCT FROM on both is what lets the referenceless point be
 * matched and what keeps NULL from swallowing the comparison.
 */

import type { PoolClient } from 'pg';
import type { ContentKind } from '../../services/sync/types.js';

/** The two answers a curator can give one held row. */
export type HeldAnswer = 'published' | 'refused';

/**
 * A held row, as both endpoints and the record name it: the object's own field
 * (kind null) or a field of one part.
 *
 * Never an id. The record names a part and never identifies it, and an answer has
 * to outlive the row it is about — the whole point of storing what was answered
 * rather than that something was.
 */
export interface HeldRowRef {
  kind: ContentKind | null;
  ref: string | null;
  name: string | null;
  field: string;
}

/**
 * The same row named twice is the same string.
 *
 * JSON rather than a joined string: a name may contain any character a curator or
 * a source can type, and a delimiter that appears inside a value is how two
 * different rows come to share a key.
 */
export function heldRowKey(row: HeldRowRef): string {
  return JSON.stringify([row.kind, row.ref, row.name, row.field]);
}

/**
 * Whether the curator has answered what this changed_fields entry proposes for
 * the object's own field.
 *
 * COALESCE for the reason the conflict query has it: a proposal can carry no
 * value at all — a source that stops publishing a key proposes undefined, which
 * JSON.stringify drops from the record — and the answer stores a jsonb null for
 * it. Comparing against SQL NULL would answer NULL rather than true, so that
 * class of card would come back after an answer that reported success.
 *
 * @param experience SQL expression for the experience id (e.id, ch.experience_id)
 * @param entry SQL alias of the jsonb changed_fields element
 */
export function heldFieldAnsweredSql(experience: string, entry = 'f'): string {
  return heldFieldMatchSql(experience, entry);
}

/**
 * The same question narrowed to a **refusal**, for the one reader that needs it.
 *
 * Answered and refused are the same thing to the queue — either way the row has
 * left the card — but not to `picture-with-nobody-credited`. Publishing the
 * object's `metadata` row on a card whose picture is still open and different
 * deliberately withholds the run's credit (`publishHeldFields.ts`, `creditPin`:
 * "a prior publication is deliberately not a fourth shape"), and publishing the
 * picture afterwards finishes what that call had to leave. So a *published*
 * credit may still be waiting on a curator, and reading it as settled would
 * send an admin to go and find a photographer the queue is one click from
 * naming. A refusal is the only answer after which nothing will come.
 *
 * The verdict is interpolated from the two-literal `HeldAnswer` union rather
 * than from a string, the way `curatorUnrestrictedScopeExists()` takes its own.
 */
export function heldFieldRefusedSql(experience: string, entry = 'f'): string {
  return heldFieldMatchSql(experience, entry, 'refused');
}

function heldFieldMatchSql(experience: string, entry: string, verdict?: HeldAnswer): string {
  const verdictClause = verdict === undefined ? '' : `AND d.answer = '${verdict}'`;
  return `EXISTS (
      SELECT 1 FROM experience_held_decisions d
       WHERE d.experience_id = ${experience}
         AND d.part_kind IS NULL
         AND d.field = ${entry}->>'field'
         AND d.value = COALESCE(${entry}->'new', 'null'::jsonb)
         ${verdictClause})`;
}

/**
 * The same question for a field of one of the object's parts.
 *
 * @param experience SQL expression for the experience id
 * @param kind SQL expression for the contents kind the part was filed under
 * @param item SQL alias of the jsonb contents entry (it carries item.ref, item.name)
 * @param entry SQL alias of the jsonb field element inside it
 */
export function heldPartAnsweredSql(
  experience: string, kind: string, item = 'c', entry = 'f',
): string {
  return heldPartMatchSql(experience, kind, item, entry);
}

/** A part's row narrowed to a refusal, for the reason `heldFieldRefusedSql` gives. */
export function heldPartRefusedSql(
  experience: string, kind: string, item = 'c', entry = 'f',
): string {
  return heldPartMatchSql(experience, kind, item, entry, 'refused');
}

function heldPartMatchSql(
  experience: string, kind: string, item: string, entry: string, verdict?: HeldAnswer,
): string {
  const verdictClause = verdict === undefined ? '' : `AND d.answer = '${verdict}'`;
  return `EXISTS (
      SELECT 1 FROM experience_held_decisions d
       WHERE d.experience_id = ${experience}
         AND d.part_kind = ${kind}
         AND d.part_ref IS NOT DISTINCT FROM (${item}->'item'->>'ref')
         AND d.part_name IS NOT DISTINCT FROM (${item}->'item'->>'name')
         AND d.field = ${entry}->>'field'
         AND d.value = COALESCE(${entry}->'new', 'null'::jsonb)
         ${verdictClause})`;
}

/**
 * Which answer stands against this changed_fields entry.
 *
 * The verdict and not merely the fact of one, because the two are different
 * instructions to a writer: publishing a row means the column already holds the
 * run's value, refusing it means the column must never come to hold it. The
 * credit rule reads this to tell those apart on a card answered one row at a
 * time (#722).
 */
function answerOfSql(experience: string, entry = 'f'): string {
  return `(SELECT d.answer FROM experience_held_decisions d
            WHERE d.experience_id = ${experience}
              AND d.part_kind IS NULL
              AND d.field = ${entry}->>'field'
              AND d.value = COALESCE(${entry}->'new', 'null'::jsonb))`;
}

/** The same, for a field of a part. */
function answerOfPartSql(
  experience: string, kind: string, item = 'c', entry = 'f',
): string {
  return `(SELECT d.answer FROM experience_held_decisions d
            WHERE d.experience_id = ${experience}
              AND d.part_kind = ${kind}
              AND d.part_ref IS NOT DISTINCT FROM (${item}->'item'->>'ref')
              AND d.part_name IS NOT DISTINCT FROM (${item}->'item'->>'name')
              AND d.field = ${entry}->>'field'
              AND d.value = COALESCE(${entry}->'new', 'null'::jsonb))`;
}

/**
 * Every held row of one proposal that already carries an answer, with it.
 *
 * Read once per call, inside the caller's transaction, and matched in TypeScript
 * by name alone — the value comparison stays in SQL, where jsonb equality lives.
 * Both endpoints filter their work by this set, so an answered row is never
 * written again by the object-level button and never counted as something the
 * call left open.
 *
 * Both levels in one statement, and the object's arm carries a NULL kind so the
 * two sides of the UNION have one shape.
 */
export async function answeredHeldRows(
  client: PoolClient, experienceId: number, syncLogId: number,
): Promise<Map<string, HeldAnswer>> {
  const result = await client.query(
    `SELECT NULL::text AS kind, NULL::text AS ref, NULL::text AS name, f->>'field' AS field,
            ${answerOfSql('ch.experience_id')} AS answer
       FROM experience_sync_changes ch
       CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) AS f
      WHERE ch.experience_id = $1 AND ch.sync_log_id = $2
        AND (f->>'held')::boolean
        AND ${heldFieldAnsweredSql('ch.experience_id')}
      UNION ALL
     SELECT k.kind, c->'item'->>'ref', c->'item'->>'name', f->>'field',
            ${answerOfPartSql('ch.experience_id', 'k.kind')}
       FROM experience_sync_changes ch
       CROSS JOIN (VALUES ('locations'), ('treasures')) AS k(kind)
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(ch.contents -> k.kind -> 'changed', '[]'::jsonb)) AS c
       CROSS JOIN LATERAL jsonb_array_elements(c -> 'fields') AS f
      WHERE ch.experience_id = $1 AND ch.sync_log_id = $2
        AND (f->>'held')::boolean
        AND ${heldPartAnsweredSql('ch.experience_id', 'k.kind')}`,
    [experienceId, syncLogId],
  );
  return new Map(result.rows.map(row => [
    heldRowKey({
      kind: row.kind as ContentKind | null,
      ref: row.ref as string | null,
      name: row.name as string | null,
      field: row.field as string,
    }),
    row.answer as HeldAnswer,
  ]));
}

/**
 * Record what a curator answered, replacing any standing answer about the same
 * row.
 *
 * One row per (experience, part, field), for the reason 022 gives: this is the
 * standing answer, not a history. Who answered what and when is the curation
 * log's, written in the same transaction by both callers.
 *
 * Replaced rather than kept because the newer answer is the one that holds: a
 * curator who refuses a value and later publishes the same one has changed their
 * mind, and two rows would leave the readers asking which.
 *
 * The value is the caller's to supply and the caller reads it off the locked
 * proposal — never off the request. A client naming what it answers could
 * disagree with what the source is actually proposing, and the readers compare by
 * equality, so an answer about a value nobody proposed would silence nothing
 * while looking like one.
 */
export async function recordHeldAnswers(
  client: PoolClient,
  experienceId: number,
  userId: number,
  answer: HeldAnswer,
  rows: ReadonlyArray<{ row: HeldRowRef; value: unknown }>,
): Promise<void> {
  for (const { row, value } of rows) {
    await client.query(
      `INSERT INTO experience_held_decisions
              (experience_id, part_kind, part_ref, part_name, field, answer, value, decided_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (experience_id, part_kind, part_ref, part_name, field)
       DO UPDATE SET answer = EXCLUDED.answer,
                     value = EXCLUDED.value,
                     decided_by = EXCLUDED.decided_by,
                     decided_at = NOW()`,
      [experienceId, row.kind, row.ref, row.name, row.field, answer,
        JSON.stringify(value ?? null), userId],
    );
  }
}

/**
 * Which rows of a held proposal a curator has already answered, in the one place
 * that decides it.
 *
 * A gated run's proposal against a row readers can already see is kept out of the
 * columns and recorded (ADR-0025 decision 5, ADR-0037 for a field of a place or a
 * work). The card has one answer per row rather than one for the whole
 * proposal (#722), and this is the record of those answers: what was answered
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
 *
 * A serial site's part is answered by its record in the site (ADR-0213
 * decision 4): the answer stores the record the entry's reference resolves to
 * (`itemRecordSql`), and an entry is matched by its record where both sides
 * have one, so a line the list renumbers or renames keeps its answer. The changeset still
 * names the part, never by id (ADR-0026 decision 4); every other part, a
 * museum's work, a cast, is matched by its name as before.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import type { CheckValue } from '../../db/schema.generated.js';
import type { ContentKind } from '../../services/sync/types.js';
import { tidyLabel } from '@tyr/shared/labels';
import { sameTypographySql, tidyLabelSql } from '../../services/sync/labelFold.js';
import { MEMBERSHIPS, partRecordSql } from '../../db/membership.js';

/** The two answers a curator can give one held row — the column's own CHECK list. */
export type HeldAnswer = CheckValue<'experience_held_decisions', 'answer'>;

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
 * The object's fields whose answer is a kind's rather than the place's: the
 * type within the kind is the membership's (ADR-0084, `publishTypeOnMembership`),
 * so an answer to one kind's type proposal answers that kind alone (ADR-0125,
 * #1720). Every other field is a fact of the place, answered once for every
 * kind's run that proposes the same value.
 */
export const KIND_FIELDS: ReadonlySet<string> = new Set(['type']);

/**
 * An answer recorded for a source answers only that source's runs; one with no
 * source, which is every answer but a type's and a type answer recorded before
 * ADR-0125, answers every run of the place.
 *
 * @param syncLog SQL expression for the sync log of the run whose proposal is read
 */
function answersThisRunSql(syncLog: string): string {
  return `(d.source_id IS NULL
           OR d.source_id = (SELECT l.source_id FROM experience_sync_logs l WHERE l.id = ${syncLog}))`;
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
 * @param syncLog SQL expression for the sync log of the run whose proposal it is
 * @param entry SQL alias of the jsonb changed_fields element
 */
export function heldFieldAnsweredSql(experience: string, syncLog: string, entry = 'f'): string {
  return heldFieldMatchSql(experience, syncLog, entry);
}

/**
 * The same question narrowed to a **refusal**, for the one reader that needs it.
 *
 * Answered and refused are the same thing to the queue — either way the row has
 * left the card — but not to `picture-with-nobody-credited`. On a card filed
 * before ADR-0039, publishing the object's source-data row while its picture is
 * still open and different deliberately withholds the run's credit (`publishHeldFields.ts`, `creditPin`:
 * "a prior publication is deliberately not a fourth shape"), and publishing the
 * picture afterwards finishes what that call had to leave. So a *published*
 * credit may still be waiting on a curator, and reading it as settled would
 * send an admin to go and find a photographer the queue is one click from
 * naming. A refusal is the only answer after which nothing will come.
 *
 * The verdict is interpolated from the two-literal `HeldAnswer` union rather
 * than from a string, the way `curatorUnrestrictedScopeExists()` takes its own.
 */
export function heldFieldRefusedSql(experience: string, syncLog: string, entry = 'f'): string {
  return heldFieldMatchSql(experience, syncLog, entry, 'refused');
}

function heldFieldMatchSql(experience: string, syncLog: string, entry: string, verdict?: HeldAnswer): string {
  const verdictClause = verdict === undefined ? '' : `AND d.answer = '${verdict}'`;
  return `EXISTS (
      SELECT 1 FROM experience_held_decisions d
       WHERE d.experience_id = ${experience}
         AND d.part_kind IS NULL
         AND d.field = ${entry}->>'field'
         AND d.value = COALESCE(${entry}->'new', 'null'::jsonb)
         AND ${answersThisRunSql(syncLog)}
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

/**
 * The part's name, on both sides, by the store rule (`tidyLabelSql`, #835).
 *
 * A decision is keyed by the record's name as the run saw it, and a run before
 * the writers tidied saw *marmalo  IV* with two spaces where the next run —
 * reading the row migration 047 tidied — records one. Compared raw, a refused
 * move of such a point would come back on the card after one run, publishable
 * by the next "publish all": the contract above broken across exactly one run.
 * A name the run since rewrote in typography alone, its first capital included
 * (`sameTypographySql`, ADR-0160), still names the part the answer was given
 * to: an answer to *mas de Torres* stands against a record naming *Mas de
 * Torres*. The same rule `recordedLocationSql` identifies the part by.
 */
function heldPartMatchSql(
  experience: string, kind: string, item: string, entry: string, verdict?: HeldAnswer,
): string {
  const verdictClause = verdict === undefined ? '' : `AND d.answer = '${verdict}'`;
  return `EXISTS (
      SELECT 1 FROM experience_held_decisions d
       WHERE d.experience_id = ${experience}
         AND d.part_kind = ${kind}
         AND ${partAnsweredSql(experience, kind, item)}
         AND d.field = ${entry}->>'field'
         AND d.value = COALESCE(${entry}->'new', 'null'::jsonb)
         ${verdictClause})`;
}

/**
 * The record of a serial site's part that a held row names, as an SQL
 * expression (ADR-0213 decision 4): the part's record in the object
 * `experience` under the row's reference, a record whose part or view carries
 * the row's name first, since a component crossing a border is listed once per
 * country under one number. NULL for a row of any other kind of part, and for
 * one no record answers: a changeset filed under a reference the line has
 * since left.
 *
 * @param ref SQL expression for the row's reference
 * @param name SQL expression for the row's name
 */
export function itemRecordSql(experience: string, kind: string, ref: string, name: string): string {
  return `(CASE WHEN ${kind} = 'locations' THEN (
      SELECT ir.id FROM ${MEMBERSHIPS} ir JOIN experiences ip ON ip.id = ir.experience_id
       WHERE ir.whole_id = ${experience} AND ${partRecordSql('ir')}
         AND lower(ir.external_id) = lower(${ref})
       ORDER BY (${tidyLabelSql('ip.name')} = ${tidyLabelSql(name)}
                 OR ${tidyLabelSql('ir.reported_name')} = ${tidyLabelSql(name)}) IS TRUE DESC, ir.id
       LIMIT 1) END)`;
}

/**
 * Whether the answer `d` is about the part the contents entry `item` names:
 * by its record where the answer and the entry both resolve to one, by its
 * reference and name otherwise (`partNamedSql`).
 */
function partAnsweredSql(experience: string, kind: string, item: string): string {
  const record = itemRecordSql(experience, kind, `(${item}->'item'->>'ref')`, `(${item}->'item'->>'name')`);
  return `(CASE WHEN d.record_id IS NOT NULL AND ${record} IS NOT NULL THEN d.record_id = ${record}
               ELSE d.part_ref IS NOT DISTINCT FROM (${item}->'item'->>'ref') AND ${partNamedSql(item)} END)`;
}

/** Whether a decision's part name names the record's item, by the rule above. */
function partNamedSql(item: string): string {
  const named = `(${item}->'item'->>'name')`;
  return `(${tidyLabelSql('d.part_name')} IS NOT DISTINCT FROM ${tidyLabelSql(named)}
           OR ${sameTypographySql('d.part_name', named)})`;
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
function answerOfSql(experience: string, syncLog: string, entry = 'f'): string {
  // The kind's own answer ahead of one recorded for the place before ADR-0125.
  return `(SELECT d.answer FROM experience_held_decisions d
            WHERE d.experience_id = ${experience}
              AND d.part_kind IS NULL
              AND d.field = ${entry}->>'field'
              AND d.value = COALESCE(${entry}->'new', 'null'::jsonb)
              AND ${answersThisRunSql(syncLog)}
            ORDER BY d.source_id NULLS LAST LIMIT 1)`;
}

/**
 * The same, for a field of a part: the latest answer, since a part's name
 * rewritten in typography alone can match two answers, given before and after
 * the rewrite (`partNamedSql`), and the later one is the one that holds.
 */
function answerOfPartSql(
  experience: string, kind: string, item = 'c', entry = 'f',
): string {
  return `(SELECT d.answer FROM experience_held_decisions d
            WHERE d.experience_id = ${experience}
              AND d.part_kind = ${kind}
              AND ${partAnsweredSql(experience, kind, item)}
              AND d.field = ${entry}->>'field'
              AND d.value = COALESCE(${entry}->'new', 'null'::jsonb)
            ORDER BY d.decided_at DESC, d.id DESC LIMIT 1)`;
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
            ${answerOfSql('ch.experience_id', 'ch.sync_log_id')} AS answer
       FROM experience_sync_changes ch
       CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) AS f
      WHERE ch.experience_id = $1 AND ch.sync_log_id = $2
        AND (f->>'held')::boolean
        AND ${heldFieldAnsweredSql('ch.experience_id', 'ch.sync_log_id')}
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
 * One row per (experience, part, field) — and, for a kind's field, per source
 * (ADR-0125) — for the reason 022 gives: this is the
 * standing answer, not a history. Who answered what and when is the curation
 * log's, written in the same transaction by every caller.
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
/** Whether a field's value is a name: the object's, a language of its local names, its makers, a part's. */
function namesAName(field: string): boolean {
  return field === 'name' || field === 'artists' || field === 'metadata.creators' || field.startsWith('nameLocal.');
}

/**
 * A recorded value as the catalogue stores a name: a string tidied, a list's
 * strings tidied, anything else as it is. Shared with the claimed field's
 * refusal (`recordConflictRefusals`), which is matched by value the same way.
 */
export function tidyNameValue(field: string, value: unknown): unknown {
  if (!namesAName(field)) return value;
  if (typeof value === 'string') return tidyLabel(value);
  if (Array.isArray(value)) return value.map(item => (typeof item === 'string' ? tidyLabel(item) : item));
  return value;
}

export async function recordHeldAnswers(
  client: PoolClient,
  experienceId: number,
  userId: number,
  answer: HeldAnswer,
  rows: ReadonlyArray<{ row: HeldRowRef; value: unknown }>,
  syncLogId: number | null,
): Promise<void> {
  for (const { row, value } of rows) {
    // The part's name and a name-carrying value as the catalogue stores a
    // name (`tidyLabel`, #835): a record filed before the writers tidied names
    // its part with the run of spaces the run saw, and an answer keyed by that
    // would not meet the tidied record the next run files. Tidied at the
    // write, the unique key above is a key on the tidied form; a name the run
    // rewrote in typography alone can still meet two answers, of which
    // `answerOfPartSql` reads the latest.
    // A kind's field is answered for the source of the run that proposed it (ADR-0125).
    const forTheKind = row.kind === null && KIND_FIELDS.has(row.field);
    const name = row.name === null ? null : tidyLabel(row.name);
    // A serial site's part is answered by its record (ADR-0213 decision 4),
    // under its own key; the reference and name it was answered under ride
    // along, the latest of them, for the readers that name the part.
    const record = row.kind !== 'locations' ? null : (await client.query<{ id: number | null }>(
      `SELECT ${itemRecordSql('$1::int', '$2::text', '$3::text', '$4::text')} AS id`,
      [experienceId, row.kind, row.ref, name],
    )).rows[0]?.id ?? null;
    await client.query(
      `INSERT INTO experience_held_decisions
              (experience_id, part_kind, part_ref, part_name, field, answer, value, decided_by, source_id, record_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8,
               CASE WHEN $9::boolean THEN (SELECT source_id FROM experience_sync_logs WHERE id = $10) END, $11)
       ${record === null
    ? `ON CONFLICT (experience_id, part_kind, part_ref, part_name, field, source_id) WHERE record_id IS NULL
       DO UPDATE SET`
    : `ON CONFLICT (experience_id, record_id, field, source_id) WHERE record_id IS NOT NULL
       DO UPDATE SET part_ref = EXCLUDED.part_ref,
                     part_name = EXCLUDED.part_name,`}
                     answer = EXCLUDED.answer,
                     value = EXCLUDED.value,
                     decided_by = EXCLUDED.decided_by,
                     decided_at = NOW()`,
      [experienceId, row.kind, row.ref, name, row.field, answer,
        JSON.stringify(tidyNameValue(row.field, value ?? null)), userId, forTheKind, syncLogId, record],
    );
  }
}

/**
 * Move a place's answers to held fields to another place on a merge, or the
 * ones a merge moved back on its undo (ADR-0086 decision 4): an answer goes
 * with the proposals it answers. An answer keyed by a part's record in the
 * place it leaves is keyed by the receiving place's record of the same part
 * from the same source, where that place holds one: a merge leaves the folded
 * site's record of a part the survivor already records where it is
 * (`moveWholeRecords`), and the proposals moved with the answer are read
 * against the survivor's record. The same rule takes it back on the undo.
 * Where the receiving place already holds an answer to the same field, of
 * that record or the same named part, its own stands and the moving one stays
 * where it is.
 */
export async function moveHeldDecisions(
  client: PoolClient,
  from: LockedExperience,
  to: LockedExperience,
  only?: number[],
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `WITH moving AS (
       SELECT f.id, COALESCE(
                (SELECT tr.id FROM ${MEMBERSHIPS} fr
                   JOIN ${MEMBERSHIPS} tr ON tr.whole_id = $2 AND tr.experience_id = fr.experience_id
                                         AND tr.source_id = fr.source_id
                  WHERE fr.id = f.record_id AND fr.whole_id IS DISTINCT FROM $2
                  ORDER BY tr.id LIMIT 1),
                f.record_id) AS record_id
         FROM experience_held_decisions f
        WHERE f.experience_id = $1 AND ($3::int[] IS NULL OR f.id = ANY($3::int[])))
     UPDATE experience_held_decisions f SET experience_id = $2, record_id = m.record_id
       FROM moving m
      WHERE f.id = m.id
        AND NOT EXISTS (
          SELECT 1 FROM experience_held_decisions s
           WHERE s.experience_id = $2 AND s.field = f.field AND s.source_id IS NOT DISTINCT FROM f.source_id
             AND CASE WHEN m.record_id IS NOT NULL THEN s.record_id = m.record_id
                      ELSE s.record_id IS NULL AND s.part_kind IS NOT DISTINCT FROM f.part_kind
                           AND s.part_ref IS NOT DISTINCT FROM f.part_ref
                           AND s.part_name IS NOT DISTINCT FROM f.part_name END)
      RETURNING f.id`,
    [from.id, to.id, only ?? null],
  );
  return result.rows.map(row => row.id);
}

/**
 * The held-proposal half of publishing, one level down: the fields of an
 * object's parts a gated run recorded rather than wrote (ADR-0037).
 *
 * `publishHeldFields.ts` answers "which columns does publishing assign from
 * `changed_fields`" for the object itself. This answers the same question for
 * the entries of `contents.<kind>.changed[]` — a place's name, a work's
 * attribution, picture and credit — and adds the two things a part needs that
 * the object does not: the row has to be *found*, since the record names a
 * part and never identifies it (`partRecord.ts` is the one rule, shared with
 * the card), and a part the record names that no row answers to any more is
 * reported rather than refused, because 409ing over a place the source has
 * since withdrawn would leave a card no answer can clear.
 *
 * Two phases, and the split is the same as the object's. `planHeldPartWrites`
 * resolves and locks the rows and decides what each write would be — reads
 * only, so the caller can still refuse the whole call over an unwritable field
 * or a stale pointer with nothing to roll back but locks. `applyHeldPartWrites`
 * runs the statements the plan produced. Both take the client inside the
 * caller's transaction, under the object lock it already holds; the part row
 * is locked after it, which is `OBJECT_LOCK`'s order (`db/locks.ts`).
 */

import type { PoolClient } from 'pg';
import { recordedLocationSql, recordedTreasureSql } from './partRecord.js';
import type { ContentKind, ContentsByKind, ContentItemChange } from '../../services/sync/types.js';

/** One part publishing wrote to, as the response and the audit row name it. */
export interface AppliedPart {
  kind: ContentKind;
  /** The part as the record names it — what the curator saw on the card. */
  name: string;
  fields: string[];
  /** Fields left alone because the part's own `curated_fields` claims them. */
  claimedFieldsSkipped: string[];
}

/** A part the record names that no offered row answers to. */
export interface PartNotFound {
  kind: ContentKind;
  name: string;
}

/** One statement the plan will run, with the part it is about. */
interface PlannedWrite {
  part: AppliedPart;
  sql: string;
  params: unknown[];
}

export interface HeldPartPlan {
  writes: PlannedWrite[];
  notFound: PartNotFound[];
  /** Held part fields this writer cannot produce, named with their part. Any at all refuses the call. */
  unwritable: string[];
  /**
   * Whether the record holds anything on a part at all, found or not — the
   * staleness check's question, which has to be asked of the proposal rather
   * than of the writes, or a proposal whose every part has since been withdrawn
   * would be published under a pointer nobody checked.
   */
  heldAny: boolean;
}

/** The columns publishing may write on each kind of part, per its `curated_fields` vocabulary. */
const WRITABLE: Record<ContentKind, ReadonlySet<string>> = {
  // `location` is deliberately absent: a held coordinate cannot occur — a kept
  // row is within ten metres of the source's point, and a claimed one is the
  // claim's to refuse — so a record carrying one is a shape this code has never
  // seen, and refusing it is the safety net the object's own writer has.
  locations: new Set(['name']),
  treasures: new Set(['name', 'artist', 'year', 'image_url', 'metadata.imageCredit']),
};

/** The claim a field answers to: the credit is the picture's, as `accept-source` releases them together. */
function claimKeyOf(field: string): string {
  return field === 'metadata.imageCredit' ? 'image_url' : field;
}

/** What the record calls the part, for a person: the name, or the source's handle where it has none. */
function labelOf(entry: ContentItemChange): string {
  return entry.item.name ?? entry.item.ref ?? 'an unnamed part';
}

/** The entries of one kind that carry a held field, with only those fields. */
function heldEntries(contents: ContentsByKind | null, kind: ContentKind): ContentItemChange[] {
  return (contents?.[kind]?.changed ?? [])
    .map(entry => ({ ...entry, fields: entry.fields.filter(field => field.held) }))
    .filter(entry => entry.fields.length > 0);
}

/**
 * The stored row a record entry names, locked for the write, or null.
 *
 * Locked here and not merely read: the value is written by id in the next
 * phase, and a claim landing on the part between the read and the write would
 * otherwise be overwritten — the same window `editLocation` closes by locking
 * the point it edits.
 */
async function lockPart(
  client: PoolClient, experienceId: number, kind: ContentKind, entry: ContentItemChange,
): Promise<{ id: number; curated_fields: string[] } | null> {
  const found = kind === 'locations'
    ? await client.query(
      `${recordedLocationSql({ experienceId: '$1', ref: '$2', name: '$3' })} FOR UPDATE`,
      [experienceId, entry.item.ref, entry.item.name],
    )
    : await client.query(
      `${recordedTreasureSql({ experienceId: '$1', ref: '$2' })} FOR UPDATE`,
      [experienceId, entry.item.ref],
    );
  const row = found.rows[0] as { id: number; curated_fields: string[] | null } | undefined;
  return row ? { id: row.id, curated_fields: row.curated_fields ?? [] } : null;
}

/**
 * The statement that writes the held fields of one part, or null where every
 * one of them was claimed since — nothing to write, and the part is reported
 * with its skipped fields so the curator sees why.
 */
function writeFor(
  kind: ContentKind, rowId: number, entry: ContentItemChange, writable: ContentItemChange['fields'],
): { sql: string; params: unknown[] } | null {
  if (writable.length === 0) return null;
  const params: unknown[] = [rowId];
  const bind = (value: unknown) => `$${params.push(value)}`;

  if (kind === 'locations') {
    // `name` is the one writable column, so this is one assignment.
    return { sql: `UPDATE experience_locations SET name = ${bind(writable[0].new ?? null)} WHERE id = $1`, params };
  }

  const assignments: string[] = [];
  for (const field of writable) {
    if (field.field === 'metadata.imageCredit') {
      // Absent and null are one case, as they are for the object's credit: the
      // key goes rather than being written as a jsonb null nothing reads.
      assignments.push(field.new == null
        ? `metadata = COALESCE(metadata, '{}'::jsonb) - 'imageCredit'`
        : `metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('imageCredit', ${bind(JSON.stringify(field.new))}::jsonb)`);
    } else {
      // name, artist, year, image_url — the column is the field's own name, and
      // Postgres infers each parameter's type from the column it is assigned to.
      assignments.push(`${field.field} = ${bind(field.new ?? null)}`);
    }
  }
  // `treasures` has `updated_at` where the location table does not, and a row
  // whose value changed without its timestamp moving is one nothing downstream
  // can tell has changed.
  assignments.push('updated_at = NOW()');
  return { sql: `UPDATE treasures SET ${assignments.join(', ')} WHERE id = $1`, params };
}

/**
 * Resolve every held part of the proposal to its row, lock it, and decide the
 * writes — without running one.
 */
export async function planHeldPartWrites(
  client: PoolClient,
  experienceId: number,
  contents: ContentsByKind | null,
): Promise<HeldPartPlan> {
  const plan: HeldPartPlan = { writes: [], notFound: [], unwritable: [], heldAny: false };

  for (const kind of ['locations', 'treasures'] as const) {
    for (const entry of heldEntries(contents, kind)) {
      plan.heldAny = true;
      const name = labelOf(entry);

      // Unwritable first, before any row is looked for: a field this writer
      // cannot produce refuses the whole call, and a lock taken for a call
      // about to be refused is a lock for nothing.
      const unwritable = entry.fields.filter(field => !WRITABLE[kind].has(field.field));
      if (unwritable.length > 0) {
        plan.unwritable.push(...unwritable.map(field => `${field.field} of ${name}`));
        continue;
      }

      const row = await lockPart(client, experienceId, kind, entry);
      if (!row) {
        plan.notFound.push({ kind, name });
        continue;
      }

      // A claim made since the run is an answer someone already gave about
      // whose value this is; publishing answers a different question, so a
      // claimed field is skipped rather than a reason to refuse.
      const claimed = entry.fields.filter(field => row.curated_fields.includes(claimKeyOf(field.field)));
      const writable = entry.fields.filter(field => !claimed.includes(field));
      const part: AppliedPart = {
        kind, name,
        fields: writable.map(field => field.field),
        claimedFieldsSkipped: claimed.map(field => field.field),
      };
      const write = writeFor(kind, row.id, entry, writable);
      plan.writes.push({ part, sql: write?.sql ?? '', params: write?.params ?? [] });
    }
  }
  return plan;
}

/** Run the plan's statements, and say which parts were written to. */
export async function applyHeldPartWrites(client: PoolClient, plan: HeldPartPlan): Promise<AppliedPart[]> {
  const applied: AppliedPart[] = [];
  for (const write of plan.writes) {
    if (write.sql) await client.query(write.sql, write.params);
    applied.push(write.part);
  }
  return applied;
}

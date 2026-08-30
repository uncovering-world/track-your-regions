/**
 * A proposal as a table of facts: which rows, of what kind, about which subject.
 *
 * The queue hands a card a list of fields — `metadata` with an object on each side,
 * `tags`, `location`, `shortDescription` — and this turns it into what a curator reads:
 * one row per fact that moved, each knowing what it is (`fieldMeaning`), whether it is
 * new, changed or removed, and what the change means. Pure, so the card's shape is
 * testable without rendering it (#570).
 *
 * Rows are **grouped by subject**. Today the queue proposes about the object itself;
 * a run also records what moved inside it — a place of a serial site renamed, a work's
 * attribution corrected (ADR-0026, `contents.locations.changed[]` and
 * `contents.treasures.changed[]`, the same field shape one level down) — and when the
 * queue carries those, each part is its own group under the object's, headed by the
 * part's name with a way to open it. The table is built for that from the start rather
 * than retrofitted: a change inside a part is a change on the object's card, not a
 * separate queue.
 */

import { changedKeys, isEmptyValue } from './objectDiff';
import { keyMeaningOf, meaningOf, type ChangeContext, type FieldMeaning, type ProposedField } from './fieldMeaning';
import type { FieldProvenance } from './ProvenanceTrail';

export type FactKind = 'new' | 'changed' | 'removed';

export interface FactRow {
  /** Stable within a card: the field, and the key inside it where there is one. */
  id: string;
  /** The changeset field the row belongs to — what an answer applies to. */
  field: string;
  meaning: FieldMeaning;
  before: unknown;
  after: unknown;
  kind: FactKind;
  /** One line about this change, where the fact has one. */
  sentence: string | null;
  /** False for fields `accept-source` cannot write now (conflict cards). */
  acceptable?: boolean;
  /** Who claimed the field and what was answered before (conflict cards). */
  provenance?: FieldProvenance;
}

export interface FactSubject {
  kind: 'object' | 'place' | 'work';
  /** The part's name — a place's, a work's. The object's group carries its card's header instead. */
  label: string;
  /** "place 4 of 7", "by Vermeer" — what tells one part from another. */
  detail?: string | null;
  /** Opens the part where it can be looked at: a point on the map, a work with its picture. */
  onOpen?: () => void;
}

export interface FactGroup {
  subject: FactSubject;
  rows: FactRow[];
}

/**
 * Is this field's object value one thing, or a set of named parts?
 *
 * One thing wherever the vocabulary can say it whole: a coordinate is a place, and split
 * into `lat` and `lon` rows it would ask a curator to judge a move as two unrelated
 * numbers; a picture credit claimed per key (`editExperience` claims `metadata.imageCredit`
 * on its own) is the photographer and the terms, and split into `author` and `license`
 * rows it would carry a definition written for neither. A `render` on the meaning is
 * exactly the vocabulary saying it knows the whole, so it is the rule rather than a list
 * of field names that would fall behind the vocabulary.
 */
function saidWhole(meaning: FieldMeaning): boolean {
  return meaning.render !== undefined;
}

/**
 * Fields that are not a question, kept off the card even where an older run filed them.
 *
 * Tags are labels the import derives from other facts on the row — the criteria, the
 * danger listing, the type — and nothing on the site reads them, so a tags row restated
 * the row beside it to a person who could change nothing readers see by answering. Newer
 * runs no longer file them; the cards earlier runs filed still carry them, and publishing
 * still writes them, which is harmless for the same reason they are not shown.
 */
const NOT_A_QUESTION = new Set(['tags']);

function kindOf(before: unknown, after: unknown): FactKind {
  if (isEmptyValue(before)) return 'new';
  if (isEmptyValue(after)) return 'removed';
  return 'changed';
}

type Proposal = ProposedField & { acceptable?: boolean } & FieldProvenance;

function row(
  id: string, field: string, meaning: FieldMeaning, before: unknown, after: unknown,
  proposal: Proposal, context: ChangeContext,
): FactRow {
  return {
    id,
    field,
    meaning,
    before,
    after,
    kind: kindOf(before, after),
    sentence: meaning.describeChange?.(before, after, context) ?? null,
    acceptable: proposal.acceptable,
    // Only where there is one: a held card's fields carry no claim and no earlier
    // answer, and a trail on every row would be a guard that never guards.
    ...(proposal.claim || proposal.decidedBefore?.length
      ? { provenance: { claim: proposal.claim, decidedBefore: proposal.decidedBefore } }
      : {}),
  };
}

/**
 * The rows a proposal makes, in the order the queue gave the fields.
 *
 * A field with named parts — the source's extra data, the local-names map — becomes one
 * row per part that moved, named as that part; its rows stay contiguous and share the
 * field, which is what lets a conflict card answer them together. The grouping that was
 * on screen — "source data", then the keys under it — is gone: it was how the value is
 * stored, not a fact a curator was asked about.
 */
export function rowsFor(proposed: ReadonlyArray<Proposal>, context: ChangeContext): FactRow[] {
  const rows: FactRow[] = [];
  for (const proposal of proposed) {
    const { field } = proposal;
    if (NOT_A_QUESTION.has(field)) continue;
    const meaning = meaningOf(field);
    const keys = saidWhole(meaning) ? null : changedKeys(proposal.old, proposal.new);
    if (keys) {
      for (const change of keys) {
        rows.push(row(`${field}.${change.key}`, field, keyMeaningOf(field, change.key),
          change.old, change.new, proposal, context));
      }
    } else {
      rows.push(row(field, field, meaning, proposal.old, proposal.new, proposal, context));
    }
  }
  return rows;
}

/** The rows by kind, for the line that says what a run proposes before the rows do. */
export function summarize(rows: ReadonlyArray<FactRow>): Record<FactKind, FactRow[]> {
  const byKind: Record<FactKind, FactRow[]> = { changed: [], new: [], removed: [] };
  for (const r of rows) byKind[r.kind].push(r);
  return byKind;
}

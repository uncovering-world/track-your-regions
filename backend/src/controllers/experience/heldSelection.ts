/**
 * Which rows of a held proposal a caller is answering, resolved against the
 * proposal itself.
 *
 * A held card used to be one act — publish all of it or none — and is now
 * answered row by row (#722): "publish this" writes one field, "not this"
 * records a refusal of one value. Both endpoints have to agree about what "one
 * row" is, or a curator would refuse the row they were shown and publish a
 * different one, so the naming rule lives here and both read it.
 *
 * A row is named the way the record names it and never by id: the object's own
 * field, or a part's kind, the reference and the name the record carries, plus
 * the field. `partRecord.ts` is the neighbouring rule for the other direction —
 * from that same name to the stored row a write lands on — and the two are
 * deliberately separate: this one has to work for a part whose row is gone,
 * since a place the source withdrew after proposing a rename still has a card
 * row and still needs an answer.
 *
 * Nothing here reads a value out of the request. A selection names rows; what
 * each row proposes is read off the locked proposal, which is what makes a
 * refusal comparable against a later run's offer and a publication the writing
 * of a value a curator actually saw.
 */

import type { ContentKind, ContentsByKind } from '../../services/sync/types.js';
import { heldRowKey, type HeldAnswer, type HeldRowRef } from './heldDecisions.js';

/**
 * One entry of a stored change set, as jsonb holds it rather than as the writer
 * built it.
 *
 * `held` is optional here and required on `FieldChange`: a row filed before
 * #519 carries no flag at all, and reading a stored record through the writer's
 * own type would have TypeScript promise a boolean the database does not have.
 * The same reason `publishHeldFields.ts` keeps its own `ProposedField`.
 */
interface ProposedField {
  field: string;
  new?: unknown;
  held?: boolean;
}

/** One part of a selection, as a request names it. */
export interface SelectedPart {
  kind: ContentKind;
  ref?: string | null;
  name?: string | null;
  fields: string[];
}

/** What a caller asked to answer, or null for "the whole card". */
export interface HeldSelection {
  fields?: string[];
  parts?: SelectedPart[];
}

/** One answerable row of a proposal: how it is named, and what it proposes. */
export interface HeldRow {
  ref: HeldRowRef;
  /** The value the run proposed for it, read off the record. */
  proposed: unknown;
}

/** The held fields of the object's own change set, unanswered ones only. */
export function heldObjectRows(
  changedFields: ReadonlyArray<ProposedField>,
  answered: ReadonlyMap<string, HeldAnswer>,
): HeldRow[] {
  return changedFields
    .filter(field => field.held === true)
    .map(field => ({
      ref: { kind: null, ref: null, name: null, field: field.field },
      proposed: field.new,
    }))
    .filter(row => !answered.has(heldRowKey(row.ref)));
}

/** The held fields of every part the record names, unanswered ones only. */
export function heldPartRows(
  contents: ContentsByKind | null,
  answered: ReadonlyMap<string, HeldAnswer>,
): HeldRow[] {
  const rows: HeldRow[] = [];
  for (const kind of ['locations', 'treasures'] as const) {
    for (const entry of contents?.[kind]?.changed ?? []) {
      for (const field of entry.fields) {
        if (field.held !== true) continue;
        const ref: HeldRowRef = {
          kind, ref: entry.item.ref, name: entry.item.name, field: field.field,
        };
        if (answered.has(heldRowKey(ref))) continue;
        rows.push({ ref, proposed: field.new });
      }
    }
  }
  return rows;
}

/**
 * A part's picture and the credit that belongs to it, each naming the other.
 *
 * On a part the two are separate writable fields (`publishHeldParts.ts`), so
 * without this an answer could take a work's new photograph and leave the old
 * photographer's name under it, or refuse the photograph and let its credit
 * land for a picture nobody is shown. The gate held them together — ADR-0037
 * holds a credit only with the picture it belongs to — and they are answered
 * together for the reason `accept-source` releases their claims together.
 *
 * It holds at **both** levels now. A run records every metadata key on its own
 * (`changeSet.ts`), so the object's credit is `metadata.imageCredit` — a fact
 * with its own two buttons, exactly like a work's — and the pairing that kept a
 * work's photograph with its photographer keeps the object's too. Before that
 * the object's credit rode inside the `metadata` catch-all with no name of its
 * own, which is why the rule there had to be a rule about one key inside
 * `nextMetadata` and why refusing the catch-all and then publishing the picture
 * could put a photograph on the site under nobody's name.
 *
 * The two levels spell the picture differently — the object's changeset field is
 * `imageUrl`, a part's is its column `image_url` — so the partner cannot be one
 * lookup table: `metadata.imageCredit` pairs with a different name depending on
 * which it belongs to.
 */
const OBJECT_PICTURE = 'imageUrl';
const PART_PICTURE = 'image_url';
const CREDIT = 'metadata.imageCredit';

function partnerOf(field: string, kind: ContentKind | null): string | undefined {
  const picture = kind === null ? OBJECT_PICTURE : PART_PICTURE;
  if (field === picture) return CREDIT;
  if (field === CREDIT) return picture;
  return undefined;
}

/**
 * Whether a selection names this row.
 *
 * A part matches on the pair the record carries — reference *and* name — because
 * neither is an identity on its own: nine (experience_id, external_ref) pairs on
 * this database are duplicated, and one point has no reference at all. Absent
 * and null are one case on both halves, since a client echoing a JSON record
 * back drops the keys whose value was null.
 *
 * A part's field is named by its partner too, which is what makes a picture and
 * its credit one answer at both endpoints. The widening lives here rather than
 * in each of them: a coupling only one endpoint honoured would let a refusal
 * separate what a publication cannot.
 */
function names(selection: HeldSelection, row: HeldRowRef): boolean {
  const partner = partnerOf(row.field, row.kind);
  const named = (fields: readonly string[]) => fields.includes(row.field)
    || (partner !== undefined && fields.includes(partner));
  if (row.kind === null) return named(selection.fields ?? []);
  return (selection.parts ?? []).some(part => part.kind === row.kind
    && (part.ref ?? null) === row.ref
    && (part.name ?? null) === row.name
    && named(part.fields));
}

/**
 * Whether a row the caller named was reached, its partner counting as itself.
 *
 * The matcher above widens across `PAIRED_WITH`, so the accounting has to widen
 * with it: a caller naming a work's picture *and* its credit where the run held
 * only one of them reaches one row, and an unmatched entry refuses the whole
 * call. Exported so publishing's own loop asks the same question — two copies
 * of this drifting from the matcher is precisely the shape that produced the
 * defect.
 */
export function namedRowReached(reached: ReadonlySet<string>, row: HeldRowRef): boolean {
  if (reached.has(heldRowKey(row))) return true;
  const partner = partnerOf(row.field, row.kind);
  return partner !== undefined && reached.has(heldRowKey({ ...row, field: partner }));
}

/** What a selection came to: the rows it reached, and the names that reached none. */
export interface ResolvedSelection {
  selected: HeldRow[];
  /**
   * Rows the caller named that carry no unanswered held proposal — a field the
   * run never held, one already published or refused, a part the record does not
   * name. Reported rather than ignored: a click that answered nothing must not
   * come back as success, which is how a card comes to look answered while
   * standing.
   */
  unmatched: string[];
}

/**
 * The open rows a selection reaches, or all of them where it names nothing.
 *
 * `null` is the whole card — the object-level button, and the shape every caller
 * sent before per-row answers existed. An empty selection object is not the same
 * thing and is refused by the schema, since "answer nothing" is not an answer.
 */
export function resolveHeldSelection(
  open: ReadonlyArray<HeldRow>, selection: HeldSelection | null,
): ResolvedSelection {
  if (!selection) return { selected: [...open], unmatched: [] };

  const selected = open.filter(row => names(selection, row.ref));
  const reached = new Set(selected.map(row => heldRowKey(row.ref)));
  const unmatched: string[] = [];
  for (const field of selection.fields ?? []) {
    const ref: HeldRowRef = { kind: null, ref: null, name: null, field };
    if (!namedRowReached(reached, ref)) unmatched.push(field);
  }
  for (const part of selection.parts ?? []) {
    for (const field of part.fields) {
      const ref: HeldRowRef = {
        kind: part.kind, ref: part.ref ?? null, name: part.name ?? null, field,
      };
      if (!namedRowReached(reached, ref)) {
        unmatched.push(`${field} of ${part.name ?? part.ref ?? 'an unnamed part'}`);
      }
    }
  }
  return { selected, unmatched };
}

/** Whether this row is one the selection answers — the filter the writers apply. */
export function selectedFilter(
  selection: HeldSelection | null,
): (row: HeldRowRef) => boolean {
  if (!selection) return () => true;
  return row => names(selection, row);
}

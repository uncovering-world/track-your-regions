/**
 * The two answers to one row of a held card (#722).
 *
 * The card used to have one answer for the whole proposal: run 68 wants to drop
 * "(Phase II)" from Getbol's name, rewrite its description for the 2026
 * extension and replace its photograph, and the buttons were all of it or none
 * of it. The one way to refuse a single field was to edit it by hand — which
 * *claims* it, a statement about whose value it is rather than about this value,
 * and one that outlives the question.
 *
 * So the answer sits in its own column, once per fact and spanning every row the
 * fact made — the shape the conflict card has had since #516, because it is the
 * same decision: two versions of one fact, and a person choosing between them.
 * A key inside the source's data is answered with the field it belongs to, never
 * on its own, which is what the span is for.
 *
 * Neither button is a primary. The card's premise is that readers keep what they
 * can see until somebody says otherwise, and colouring one answer would make the
 * screen recommend the other.
 */

import { Button, Stack, Typography } from '@mui/material';
import type { HeldSelectionPart } from '../../api/experiences';
import type { FactSubject } from './factRows';

/** What a curator answered: rows of the object's own, rows of its parts, or both. */
export interface HeldSelection {
  fields?: string[];
  parts?: HeldSelectionPart[];
}

/**
 * One fact of one subject, as a selection the server can match.
 *
 * The object's group names the field and nothing else. A part's carries the pair
 * the record identifies it by — the reference and the name the run stored, which
 * is what it was called *before* the run — echoed back exactly as the queue gave
 * them: neither half is an identity on its own, since a reference is shared by
 * the components of a serial site listed once per country, and a name is not
 * unique either.
 */
export function heldSelectionFor(subject: FactSubject, field: string): HeldSelection {
  if (!subject.part) return { fields: [field] };
  return { parts: [{ ...subject.part, fields: [field] }] };
}

/**
 * A work's picture and the credit that belongs to it, as the card has to say it.
 *
 * The server answers the two together — `heldSelection.ts`'s `PAIRED_WITH`
 * widens the match at both endpoints — but they are two changeset fields, and
 * `FactTable` draws one answer cell per field. So a work whose run held both
 * gets two cells and four buttons, any of which answers both rows. The card
 * says so under them rather than pretending they are independent: two buttons
 * under a promise they will not keep is the screen misleading a curator about
 * an act that has no undo.
 *
 * Merging the two into one cell would be the other fix, and it would put a copy
 * of the server's pairing into the table's layout rule. This says it instead.
 */
const PARTNER_NOTE: Record<string, { partner: string; note: string }> = {
  image_url: { partner: 'metadata.imageCredit', note: 'Answered with its credit.' },
  'metadata.imageCredit': { partner: 'image_url', note: 'Answered with its picture.' },
};

/**
 * The answer column's two buttons for one fact.
 *
 * "publish this" writes that value and leaves the rest of the card open; "not
 * this" writes nothing at all — the stored value has already won every run
 * since the gate first held this one — and settles the question for that value,
 * so a source that comes back with something different is heard again.
 *
 * The one exception to "the rest of the card" is a work's picture and its
 * credit, which either button answers together; the note under them says so —
 * but only where the partner row is actually open. `heldFields` is what this
 * subject's proposal holds, and the note is drawn against it rather than
 * against the field's name alone: the server widens the selection only onto a
 * row that is there, so on a work whose run held a picture and no credit —
 * which is the ordinary shape, since `creditToWrite` returns nothing for a
 * changed picture the Commons batch did not come back for, and the writer drops
 * an entry whose two sides are equal — the note would promise a second answer
 * that is not happening. A caption that overstates what a button does is the
 * defect it was added to fix, one row over.
 */
export function HeldAnswer({ subject, field, busy, heldFields, onPublish, onRefuse }: {
  subject: FactSubject;
  field: string;
  busy: boolean;
  /** Every field this subject's held proposal carries — what the server can widen onto. */
  heldFields: readonly string[];
  onPublish: (selection: HeldSelection) => void;
  onRefuse: (selection: HeldSelection) => void;
}) {
  const selection = heldSelectionFor(subject, field);
  const pairing = subject.part ? PARTNER_NOTE[field] : undefined;
  const partnerNote = pairing !== undefined && heldFields.includes(pairing.partner)
    ? pairing.note
    : undefined;
  return (
    <Stack spacing={0.5}>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => onPublish(selection)}>
        publish this
      </Button>
      {/* "not this", not "keep mine": nobody wrote the value readers are looking
          at — it is what the source said last time — so a word implying the
          curator's authorship would be false on every one of these cards. */}
      <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={() => onRefuse(selection)}>
        not this
      </Button>
      {partnerNote !== undefined && (
        <Typography variant="caption" color="text.secondary">
          {partnerNote}
        </Typography>
      )}
    </Stack>
  );
}

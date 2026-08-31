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
 * So the answer sits in its own column, once per fact — the shape the conflict
 * card has had since #516, because it is the same decision: two versions of one
 * fact, and a person choosing between them. **A key inside the source's data is
 * a fact** and carries its own two buttons (ADR-0039, which narrows ADR-0038
 * decision 1 for exactly this): it used to be answered with the field it
 * belonged to and never on its own, which is what folded a site's inscription
 * criteria together with a picture credit nobody had checked.
 *
 * The cell still spans in two shapes, and both are this defect somewhere else:
 * a card filed before ADR-0039, whose bare `metadata` entry splits into a row
 * per key that all carry one field, kept alive because a changeset is never
 * rewritten; and a language map, whose names share one answer for the same
 * reason (#728). There `FactTable`'s `Answers all N.` is the only thing saying
 * so.
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
 * A picture and the credit that belongs to it, as the card has to say it.
 *
 * The server answers the two together — `heldSelection.ts`'s `partnerOf` widens
 * the match at both endpoints — but they are two changeset fields, and
 * `FactTable` draws one answer cell per field. So a subject whose run held both
 * gets two cells and four buttons, any of which answers both rows. The card
 * says so under them rather than pretending they are independent: two buttons
 * under a promise they will not keep is the screen misleading a curator about
 * an act that has no undo, since a refusal settles that value for good.
 *
 * **Level-aware, because the server's rule is.** It was a work's rule only while
 * the object's credit had no name of its own; since ADR-0039 the object has
 * `metadata.imageCredit` as a fact and the pairing reaches it. The two levels
 * spell the picture differently — `imageUrl` on the object, the column
 * `image_url` on a part — so this mirrors `partnerOf` rather than keying on one
 * name. Backend and frontend cannot import each other (#527), so the two are
 * pinned by the same cases on both sides.
 *
 * Merging the two into one cell would be the other fix, and it would put a copy
 * of the server's pairing into the table's layout rule. This says it instead.
 */
const CREDIT = 'metadata.imageCredit';
const PICTURE_OF = { object: 'imageUrl', part: 'image_url' } as const;

function pairingFor(field: string, isPart: boolean): { partner: string; note: string } | undefined {
  const picture = PICTURE_OF[isPart ? 'part' : 'object'];
  if (field === picture) return { partner: CREDIT, note: 'Answered with its credit.' };
  if (field === CREDIT) return { partner: picture, note: 'Answered with its picture.' };
  return undefined;
}

/**
 * The answer column's two buttons for one fact.
 *
 * "publish this" writes that value and leaves the rest of the card open; "not
 * this" writes nothing at all — the stored value has already won every run
 * since the gate first held this one — and settles the question for that value,
 * so a source that comes back with something different is heard again.
 *
 * The one exception to "the rest of the card" is a picture and its credit — an
 * object's as well as a work's, since ADR-0039 — which either button answers
 * together; the note under them says so —
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
  const pairing = pairingFor(field, subject.part !== undefined);
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

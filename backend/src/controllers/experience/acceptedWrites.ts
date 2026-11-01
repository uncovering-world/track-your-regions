/**
 * What taking the source's value writes, field by field (#2222).
 *
 * A curator answering a claimed field with *Use proposed* gets the value the
 * answered run proposed on the row at once, whatever the field: the run kept the
 * stored value because of the claim and recorded what it offered instead, so
 * there is nothing a later run would know better. The shapes are the ones
 * publishing a held proposal writes (`publishHeldFields.ts`), since a claimed
 * field and a held one are the same column written from the same record: a
 * coordinate becomes a geometry, the country arrays and the texts are assigned,
 * and `metadata` and `name_local` are merged per key over what is stored.
 *
 * The type is not here: it is the proposing source's membership's (ADR-0084),
 * written by `acceptTypeOnSourceMembership`. Neither is a kind's own fact, which
 * lives on that membership too (ADR-0153) and no curator edit claims; one such
 * entry is released and left to the kind's next run, as every field was before.
 *
 * A value no writer may store — a picture from a host this catalogue may not
 * show, a coordinate that is not a pair — is named as unwritable, and the
 * caller refuses the whole answer, as publishing a held proposal does: released
 * without a write, a refused picture would leave the curator's photograph on the
 * row with its credit dropped.
 */

import {
  assignmentFor, isKindFactField, isMetadataField, isNameLocalField, nextMetadata, nextNameLocal,
  type CreditPin, type ProposedField,
} from './publishHeldFields.js';

const CREDIT_FIELD = 'metadata.imageCredit';

/** The proposed picture's credit as Commons answered it before the transaction, null where it could not. */
export interface PictureCredit {
  url: string;
  credit: unknown;
}

/** The SQL that writes the accepted values onto the place, and which fields it covers. */
export interface AcceptedWrites {
  assignments: string[];
  /** Fields written now, the type included. */
  written: string[];
  /** Fields released only: the kind's next run writes them. */
  released: string[];
  /** Fields whose proposed value no writer may store: the caller refuses the answer. */
  unwritable: string[];
}

/**
 * The assignments for the accepted entries, bound through `bind`.
 *
 * `stored` is the place's `metadata` and `name_local` as read under the lock, and
 * `remainingClaims` the place's claims once the accepted ones are gone: a key a
 * curator still claims is put back over a merged entry, as a run would put it
 * back. `acceptedImage` says the picture is among the accepted fields, so the
 * curator's credit goes with it. What replaces it is the run's own credit where
 * it is accepted beside the picture, else `pictureCredit`, the proposed file's
 * credit resolved before the transaction as a curator's edit resolves one: a
 * run resends the stored credit over a claimed picture rather than resolving
 * the source's (`creditToWrite`), so a conflict card seldom carries one, and a
 * picture must not go out uncredited until its source runs again.
 */
export function acceptedWrites(
  accepted: readonly ProposedField[],
  stored: { metadata: unknown; name_local: unknown },
  remainingClaims: string[],
  acceptedImage: boolean,
  pictureCredit: PictureCredit | null,
  bind: (value: unknown) => string,
): AcceptedWrites {
  const writes: AcceptedWrites = { assignments: [], written: [], released: [], unwritable: [] };
  const merged: ProposedField[] = [];
  for (const entry of accepted) {
    if (entry.field === 'type') {
      writes.written.push(entry.field);
    } else if (isKindFactField(entry.field)) {
      writes.released.push(entry.field);
    } else if (isMetadataField(entry.field) || isNameLocalField(entry.field)) {
      merged.push(entry);
      writes.written.push(entry.field);
    } else {
      const assignment = assignmentFor(entry.field, entry.new, bind);
      if (assignment === null) writes.unwritable.push(entry.field);
      else {
        writes.assignments.push(assignment);
        writes.written.push(entry.field);
      }
    }
  }

  const pin = creditPinFor(accepted, acceptedImage, pictureCredit);
  const metadata = nextMetadata(stored.metadata, merged, remainingClaims, pin);
  if (metadata !== null) writes.assignments.push(`metadata = ${bind(JSON.stringify(metadata))}::jsonb`);
  const names = nextNameLocal(stored.name_local, merged);
  if (names !== null) writes.assignments.push(`name_local = ${bind(JSON.stringify(names))}::jsonb`);
  return writes;
}

/** What the credit becomes beside an accepted picture, or null where the entries decide it. */
function creditPinFor(
  accepted: readonly ProposedField[], acceptedImage: boolean, pictureCredit: PictureCredit | null,
): CreditPin {
  if (!acceptedImage || accepted.some(entry => entry.field === CREDIT_FIELD)) return null;
  const picture = accepted.find(entry => entry.field === 'imageUrl');
  if (picture === undefined || pictureCredit === null || pictureCredit.url !== picture.new) return { value: undefined };
  return { value: pictureCredit.credit ?? undefined };
}

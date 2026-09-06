/**
 * A part of an object, opened where it can be looked at.
 *
 * The held card groups a run's proposal about one of the object's parts under
 * the part's name (ADR-0037), and a name is not enough to judge a proposal by:
 * whether "Château de Montségur" is the right spelling for the pin at 42.88°N,
 * or whether the painting a source now attributes to a namesake is the Vermeer
 * a curator knows, is answered by looking at the thing — and answering it is
 * what a curator is here for, so each part opens in the dialog it is *corrected*
 * in: a place in `PointPreviewDialog`, as a withdrawn point does, and a work in
 * `WorkPreviewDialog`, the one every surface that shows a curator a work opens.
 *
 * One dialog, one open part at a time — `PointPreviewDialog`'s own docblock
 * gives the reason: a map is a WebGL context, browsers keep about a dozen per
 * tab, and this page renders up to a page of cards. Until a part has an
 * address of its own (#575), this is where it can be seen.
 *
 * A part opened here is also a part a curator is looking at, so the dialog offers
 * the correction — the third answer to a held value, where "take the source's"
 * and "keep what is here" are both wrong. For a place since #583 and for a work
 * since #731, and in both cases only where the stored row was found: a record
 * naming a row the source has since withdrawn opens nothing and corrects
 * nothing, and is not opened at all: everything a card would draw — the picture,
 * the makers, the year — belongs to that row, and `factRows`' own `openable`
 * gives such a part no door in the first place.
 */

import type { HeldPart } from '../../api/experiences';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { WorkPreviewDialog } from '../shared/WorkPreviewDialog';

export function PartPreviewDialog({ part, onClose, object, onDone }: {
  /** The part to show, or null for nothing open. */
  part: HeldPart | null;
  onClose: () => void;
  /** The object the part belongs to — whose caches a correction clears, and whose name the outcome leads with. */
  object: { id: number; name: string };
  /** Where a correction's outcome line goes: the card's own reporting. */
  onDone: (message: string) => void;
}) {
  if (part?.kind === 'locations' && part.latitude != null && part.longitude != null) {
    const { latitude, longitude } = part;
    return (
      <PointPreviewDialog
        open
        onClose={onClose}
        name={part.storedName ?? part.item.name ?? part.item.ref ?? 'an unnamed place'}
        latitude={latitude}
        longitude={longitude}
        correction={part.locationId != null
          ? {
            place: {
              locationId: part.locationId,
              experienceId: object.id,
              objectName: object.name,
              // The row's name, not the record's: the form diffs against what
              // is stored, and a place renamed from here and reopened would
              // otherwise be seeded with the old name.
              name: part.storedName ?? part.item.name,
              latitude,
              longitude,
            },
            onDone,
          }
          : undefined}
      />
    );
  }

  // A work whose stored row was found is a work this curator may correct, and the
  // card's two answers — "take the source's" and "keep what is here" — are exactly
  // the two that cannot say *this instead* (#731). So the same dialog every other
  // surface opens, rather than a look with the answer missing from it.
  if (part?.kind === 'treasures' && part.treasureId != null && part.item.ref) {
    return (
      <WorkPreviewDialog
        work={{
          treasureId: part.treasureId,
          experienceId: object.id,
          museumName: object.name,
          // The row as stored, since that is what the change is against — the
          // name included. The record's is a snapshot: a title corrected after
          // the run wrote it, from this very dialog, would otherwise come back
          // as the seed, beside a chip saying it was corrected.
          name: part.storedName ?? part.item.name ?? part.item.ref,
          artists: part.artists ?? [],
          artistsCurated: part.artistsCurated ?? false,
          year: part.year ?? null,
          imageUrl: part.imageUrl ?? null,
          imageCredit: part.imageCredit ?? null,
          venueCount: part.venueCount,
          treasureType: part.treasureType ?? null,
          externalId: part.item.ref,
        }}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  // Nothing else opens here. A treasures part reaching this component always
  // carries its `treasureId`, because `factRows`' `openable` is the only thing
  // that gives a part a door and it asks exactly that — so a record whose stored
  // row is gone is never opened at all, rather than opened onto a card with
  // nothing in it: the picture, the makers and the year a card would draw are
  // all the row's. Kept as `null` rather than as a read-only fallback, because a
  // fallback guarded by the same predicate as the branch above is a branch
  // nothing can reach, and the sentences describing it would be describing
  // something the code will not do.
  return null;
}

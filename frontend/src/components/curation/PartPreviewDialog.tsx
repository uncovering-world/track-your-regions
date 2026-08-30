/**
 * A part of an object, opened where it can be looked at.
 *
 * The held card groups a run's proposal about one of the object's parts under
 * the part's name (ADR-0037), and a name is not enough to judge a proposal by:
 * whether "Château de Montségur" is the right spelling for the pin at 42.88°N,
 * or whether the painting a source now attributes to a namesake is the Vermeer
 * a curator knows, is answered by looking at the thing. A place opens on the
 * map, as a withdrawn point does; a work opens as the works preview draws one,
 * with its picture, its maker and the page it came from.
 *
 * One dialog, one open part at a time — `PointPreviewDialog`'s own docblock
 * gives the reason: a map is a WebGL context, browsers keep about a dozen per
 * tab, and this page renders up to a page of cards. Until a part has an
 * address of its own (#575), this is where it can be seen.
 */

import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { HeldPart } from '../../api/experiences';
import { PointPreviewDialog } from './PointPreviewDialog';
import { WorkCard } from './WorksPreview';

export function PartPreviewDialog({ part, onClose }: {
  /** The part to show, or null for nothing open. */
  part: HeldPart | null;
  onClose: () => void;
}) {
  if (part?.kind === 'locations' && part.latitude != null && part.longitude != null) {
    return (
      <PointPreviewDialog
        open
        onClose={onClose}
        name={part.item.name ?? part.item.ref ?? 'an unnamed place'}
        latitude={part.latitude}
        longitude={part.longitude}
      />
    );
  }

  const work = part?.kind === 'treasures' && part.treasureId != null && part.item.ref
    ? {
        // The row as stored, since that is what the change is against; the
        // record's name where the row's is not carried, which is the same string
        // unless the name itself is what is held.
        name: part.item.name ?? part.item.ref,
        type: part.treasureType ?? null,
        artist: part.artist ?? null,
        imageUrl: part.imageUrl ?? null,
        imageCredit: part.imageCredit ?? null,
        year: part.year ?? null,
        externalId: part.item.ref,
      }
    : null;

  return (
    <Dialog open={work !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        A work in this object
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {work && <WorkCard work={work} />}
      </DialogContent>
    </Dialog>
  );
}

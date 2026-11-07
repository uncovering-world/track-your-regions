/**
 * The arrival's third answer (#2213): the place belongs in another kind.
 *
 * An arrival card asked whether the place belongs in the kind that brought it,
 * and a place that belongs in another kind could only be kept out here and
 * then found and added by hand. The Monument to Peter I before St Michael's
 * Castle arrived in Public art as a sculpture; a traveller looks for it under
 * Monuments & memorials. Open, this is the kind, a type from its vocabulary,
 * whether the place also stays in the kind that brought it, and an optional
 * reason; one press answers both kinds (`answerArrivalWithKind`), and the
 * answer is what the rule review reads (#2069, #2177).
 *
 * The form is its own chunk (`ArrivalKindForm`), fetched when the curator
 * opens it: most arrivals are published or kept out, and the review queue's
 * chunk carries only the button. The card holds whether it is open, so Jev's
 * reading of the kind (`KindReadingLine`, #2342) can open it with its kind chosen.
 */

import { Button } from '@mui/material';
import { lazyChunk } from '../../utils/lazyChunk';
import { ChunkBoundary } from '../shared/ChunkBoundary';

const ArrivalKindForm = lazyChunk(() => import('./ArrivalKindForm').then(m => ({ default: m.ArrivalKindForm })));

export function ArrivalKindChoice({ disabled, open, onOpen, onClose, ...form }: {
  experienceId: number;
  name: string;
  /** The arrival's membership, the one the answer is about. */
  membershipId: number | null | undefined;
  /** The kind that brought the place, by name. */
  arrivingKind: string;
  /** The kind chosen when the form opens, where Jev's reading named one; none otherwise. */
  initialKindId?: number;
  disabled: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  if (!open) {
    return (
      <Button variant="outlined" color="inherit" disabled={disabled} onClick={onOpen}>
        Belongs in another kind…
      </Button>
    );
  }
  return (
    <ChunkBoundary>
      {/* Keyed by the kind chosen, so following Jev's reading with the form open starts it again with that kind. */}
      <ArrivalKindForm key={form.initialKindId ?? 'none'} {...form} disabled={disabled} onCancel={onClose} />
    </ChunkBoundary>
  );
}

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
 * chunk carries only the button.
 */

import { useState } from 'react';
import { Button } from '@mui/material';
import { lazyChunk } from '../../utils/lazyChunk';
import { ChunkBoundary } from '../shared/ChunkBoundary';

const ArrivalKindForm = lazyChunk(() => import('./ArrivalKindForm').then(m => ({ default: m.ArrivalKindForm })));

export function ArrivalKindChoice({ disabled, ...form }: {
  experienceId: number;
  name: string;
  /** The arrival's membership, the one the answer is about. */
  membershipId: number | null | undefined;
  /** The kind that brought the place, by name. */
  arrivingKind: string;
  disabled: boolean;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="outlined" color="inherit" disabled={disabled} onClick={() => setOpen(true)}>
        Belongs in another kind…
      </Button>
    );
  }
  return (
    <ChunkBoundary>
      <ArrivalKindForm {...form} disabled={disabled} onCancel={() => setOpen(false)} />
    </ChunkBoundary>
  );
}

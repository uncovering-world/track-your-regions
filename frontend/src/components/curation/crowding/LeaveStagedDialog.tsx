/**
 * Asked before a curator leaves the *Crowded cities* tab for the queue's with
 * answers staged in its cities (#2282). Staged answers are not sent until
 * Apply, and the queue's tab shows none of them: a tab left without a word
 * would hold them where nobody looks.
 */

import { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { plural } from '../../../utils/plural';

export function LeaveStagedDialog({ staged, onStay, onDiscard }: {
  /** How many answers are staged; the dialog is open while this is set. */
  staged: number | null;
  onStay: () => void;
  onDiscard: () => void;
}) {
  // The count asked about, kept while the dialog fades out, so its words do not turn to "0 answers".
  const [asked, setAsked] = useState(0);
  if (staged !== null && staged !== asked) setAsked(staged);
  const n = staged ?? asked;
  return (
    <Dialog open={staged !== null} onClose={onStay} aria-labelledby="leave-staged-title">
      <DialogTitle id="leave-staged-title">{`${plural(n, 'answer')} not applied`}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {n === 1 ? 'The answer you gave in a crowded city is' : 'The answers you gave in the crowded cities are'} staged,
          not applied. Apply {n === 1 ? 'it' : 'them'} before you leave, or discard {n === 1 ? 'it' : 'them'}.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onStay} autoFocus>Stay and apply</Button>
        <Button color="error" onClick={onDiscard}>{`Discard ${plural(n, 'answer')}`}</Button>
      </DialogActions>
    </Dialog>
  );
}

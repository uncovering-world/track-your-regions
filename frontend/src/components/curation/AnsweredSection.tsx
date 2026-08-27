/**
 * A block of answered work at the foot of the review page: collapsed, out of the way, one
 * click from reach.
 *
 * Its own component because there are two of them and they are the same shape for the
 * same reason — a row that is answered appears on no other surface, so the page that
 * answered it is the only place a mis-click can be undone. `keptOut` is that at the level
 * of an object a rule refused; `answeredWithdrawals` is that at the level of a point a
 * curator decided about (#544). A second copy of the divider, the toggle and the count
 * would have drifted, and the drift a reader would notice first is the promise: both say
 * "answered, so not waiting on you", and one of them saying something else is how a
 * curator learns to distrust the sentence.
 *
 * Collapsed by default in both, and that is the product decision this holds: someone
 * opening the review page is here for what is *not* answered.
 */

import { useState } from 'react';
import { Button, Divider, Stack, Typography } from '@mui/material';

export function AnsweredSection({ label, count, explanation, children, pager }: {
  /** The noun the toggle offers, in the page's own words: "what you have kept out". */
  label: string;
  /** How many the block holds. Shown on the toggle, so the size is known before opening. */
  count: number;
  /** Why the block exists at all — which is what makes it something other than clutter. */
  explanation: string;
  children: React.ReactNode;
  /** This kind's own pager, rendered under the rows when the kind has another page. */
  pager?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Divider sx={{ mt: 4 }} />
      <Button size="small" sx={{ mt: 2 }} onClick={() => setOpen(v => !v)}>
        {open ? 'Hide' : 'Show'} {label} ({count})
      </Button>
      {open && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            {explanation}
          </Typography>
          <Stack spacing={2}>{children}</Stack>
          {pager}
        </>
      )}
    </>
  );
}

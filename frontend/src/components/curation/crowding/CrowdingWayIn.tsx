/**
 * The way from a review card into the crowded-city window (ADR-0180, #2282):
 * "Squares around (22)" on a card of a place in a kind with the display rule,
 * and, where the place is shadowed, in which kind and how many outrank it
 * (#2228).
 *
 * Read off the card's own `crowding`, which the queue's page carries: nothing
 * is asked of the server until the curator opens the window, so a page of
 * cards spends none of the request budget the answers share. The window opens
 * on the region's list of the place's group with the place open in its own
 * circle (#2358), which names every place the button counts. The line above
 * the button says when the rule found nothing better known, or has not
 * measured the place yet (#2420).
 *
 * The window is its own chunk (`LazyCrowdingWindow`), fetched when the
 * curator opens it: the review page carries only this line and its button.
 */

import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { aroundLabel, circleLine } from './crowdingWords';
import { LazyCrowdingWindow } from './LazyCrowdingWindow';

export function CrowdingWayIn({ item, onDone }: {
  /** The card's place, its membership and kind, and how crowded its city is: nothing where `crowding` is null. */
  item: Pick<ReviewQueueItem, 'id' | 'membership_id' | 'kind_id' | 'kind_name' | 'kind_type' | 'curation_state' | 'crowding'>;
  /** What the card's own answers call: the window's report, and the place to refresh. */
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const { membership_id: membershipId, crowding } = item;
  if (membershipId == null || !crowding) return null;
  const line = circleLine(item, crowding);

  return (
    <Box sx={{ mt: 1.5 }}>
      {line && <Typography variant="body2" sx={{ mb: 1 }}>{line}</Typography>}
      <Button variant="outlined" color="inherit" onClick={() => setOpen(true)}>
        {aroundLabel(item, crowding)}
      </Button>
      {open && (
        <LazyCrowdingWindow
          membershipId={membershipId}
          onClose={message => {
            setOpen(false);
            if (message) onDone(message, item.id);
          }}
        />
      )}
    </Box>
  );
}

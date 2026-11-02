/**
 * The way from a review card into the crowded-city window (ADR-0180, #2282):
 * "Squares around (22)" on a card of a place in a kind with the display rule.
 *
 * Read off the card's own `crowding`, which the queue's page carries: nothing
 * is asked of the server until the curator opens the window, so a page of
 * cards spends none of the request budget the answers share.
 *
 * The window is its own chunk (`LazyCrowdingWindow`), fetched when the
 * curator opens it: the review page carries only its button.
 */

import { useState } from 'react';
import { Box, Button } from '@mui/material';
import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { aroundLabel } from './crowdingWords';
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

  return (
    <Box sx={{ mt: 1.5 }}>
      <Button variant="outlined" color="inherit" onClick={() => setOpen(true)}>
        {aroundLabel(item, crowding)}
      </Button>
      {open && (
        <LazyCrowdingWindow
          memberships={[membershipId]}
          onClose={message => {
            setOpen(false);
            if (message) onDone(message, item.id);
          }}
        />
      )}
    </Box>
  );
}

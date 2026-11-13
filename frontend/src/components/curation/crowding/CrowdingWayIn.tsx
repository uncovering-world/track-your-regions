/**
 * The way from a review card into the crowded-city window (ADR-0180, #2282):
 * "Squares around (22)" on a card of a place in a kind with the display rule,
 * and, where the place is shadowed, in which kind and how many outrank it
 * (#2228).
 *
 * Read off the card's own `crowding`, which the queue's page carries: nothing
 * is asked of the server until the curator follows it. It links to the review
 * page's *Crowded cities* tab open on the place (`crowdedPlaceUrl`, #2487),
 * which shows the region's list of the place's group with the place open in
 * its own circle, every place the button counts; Back returns to the card. The
 * line above the button says when the rule found nothing better known, or has
 * not measured the place yet (#2420).
 */

import { Link as RouterLink } from 'react-router';
import { Box, Button, Typography } from '@mui/material';
import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { crowdedPlaceUrl } from '../../../utils/appUrl';
import { aroundLabel, circleLine } from './crowdingWords';

export function CrowdingWayIn({ item }: {
  /** The card's place, its membership and kind, and how crowded its city is: nothing where `crowding` is null. */
  item: Pick<ReviewQueueItem, 'membership_id' | 'kind_id' | 'kind_name' | 'kind_type' | 'curation_state' | 'crowding'>;
}) {
  const { membership_id: membershipId, crowding } = item;
  if (membershipId == null || !crowding) return null;
  const line = circleLine(item, crowding);

  return (
    <Box sx={{ mt: 1.5 }}>
      {line && <Typography variant="body2" sx={{ mb: 1 }}>{line}</Typography>}
      <Button variant="outlined" color="inherit" component={RouterLink} to={crowdedPlaceUrl(membershipId)}>
        {aroundLabel(item, crowding)}
      </Button>
    </Box>
  );
}

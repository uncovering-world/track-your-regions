/**
 * The note on a whole none of whose places a reader is shown yet (#2122): a
 * whole has no coordinate of its own, so with no place shown the map draws and
 * frames nothing for it, and the card says so. Nothing for any other place.
 */

import { Typography } from '@mui/material';
import type { Experience } from '../../api/experiences';
import { ownPoint } from '../../utils/placePosition';

export function NoPlaceShownNote({ place }: { place: Pick<Experience, 'longitude' | 'latitude' | 'focus'> }) {
  if (ownPoint(place) || place.focus) return null;
  return (
    <Typography variant="caption" color="text.secondary" component="p">
      None of its places is on the map yet.
    </Typography>
  );
}

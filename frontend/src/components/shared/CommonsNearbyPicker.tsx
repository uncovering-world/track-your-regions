/**
 * The Wikimedia Commons pictures geotagged near a point, for a curator to pick
 * the point's own picture from (#1341).
 *
 * For a component nothing else gives a picture: no Wikidata item, so no P18.
 * A geotag says where the camera stood, not what it shows — at Paimio
 * Sanatorium the nearest files are of its dining room and lobby, on a lakeshore
 * they are of the lake — so this is an offer the curator reads, with each
 * file's distance and photographer, and nothing is written until the point's
 * form is saved with the one picked. Asked only when the curator opens it: one
 * request to Commons per opening.
 */

import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getNearbyPictures, type NearbyPicture } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from './ImageCreditLine';

/** One file on offer: the picture, how far off it was taken, and whose it is. */
function Tile({ picture, chosen, onPick }: { picture: NearbyPicture; chosen: boolean; onPick: () => void }) {
  const [failed, setFailed] = useState(false);
  const src = toThumbnailUrl(picture.url, 120);
  // A tile whose picture did not load is left out rather than credited beside nothing.
  if (!src || failed) return null;
  return (
    <Box sx={{ width: 120 }}>
      <Box
        component="button"
        type="button"
        onClick={onPick}
        aria-pressed={chosen}
        aria-label={`Use ${picture.file}, ${picture.distanceM} m from the point`}
        sx={{
          p: 0, border: 2, borderColor: chosen ? 'primary.main' : 'transparent', borderRadius: 1,
          cursor: 'pointer', display: 'block', bgcolor: 'transparent',
        }}
      >
        <Box component="img" src={src} alt="" loading="lazy" onError={() => setFailed(true)}
          sx={{ width: 116, height: 88, objectFit: 'cover', borderRadius: 0.5, display: 'block' }} />
      </Box>
      <Typography variant="caption" color="text.secondary" display="block">{picture.distanceM} m away</Typography>
      <ImageCreditLine credit={picture.credit} />
    </Box>
  );
}

export function CommonsNearbyPicker({ locationId, chosenUrl, onPick }: {
  locationId: number;
  /** The address the form holds now, which marks a tile as the one picked. */
  chosenUrl: string;
  onPick: (picture: NearbyPicture) => void;
}) {
  const [open, setOpen] = useState(false);
  const nearby = useQuery({
    queryKey: queryKeys.experience.nearbyPictures(locationId),
    queryFn: () => getNearbyPictures(locationId),
    enabled: open,
    staleTime: 600_000,
    retry: false,
  });

  if (!open) {
    return (
      <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        Pick a picture from Commons nearby
      </Button>
    );
  }
  if (nearby.isPending) return <CircularProgress size={20} aria-label="Asking Commons" />;
  if (nearby.isError) {
    return (
      <Alert
        severity="warning"
        action={<Button color="inherit" size="small" onClick={() => nearby.refetch()}>Try again</Button>}
      >
        {nearby.error instanceof Error ? nearby.error.message : 'Commons did not answer.'}
      </Alert>
    );
  }
  const { pictures, radiusM } = nearby.data;
  if (pictures.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No picture on Wikimedia Commons is geotagged within {radiusM} m of this point.
      </Typography>
    );
  }
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        Geotagged within {radiusM} m on Wikimedia Commons, nearest first. A geotag is where the camera stood, not
        what it shows: pick one that shows this place.
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {pictures.map(picture => (
          <Tile key={picture.url} picture={picture} chosen={picture.url === chosenUrl} onPick={() => onPick(picture)} />
        ))}
      </Box>
    </Stack>
  );
}

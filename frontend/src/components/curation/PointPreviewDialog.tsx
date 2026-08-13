/**
 * Where the object actually is, for a curator judging a claim about it.
 *
 * A coordinate printed as text answers almost nothing: "14.1303, 38.7186" does not tell
 * anyone whether a description's "close to Ethiopia's northern border" is true. A map
 * does, in one look.
 *
 * A dialog rather than a map on every card, and the reason is a hard limit rather than
 * taste: each MapLibre instance holds its own WebGL context, browsers keep about a dozen
 * per tab, and this page renders up to 25 cards *per kind* across seven kinds. Mounting
 * one map per card would evict the earlier contexts and blank the maps — the failure
 * looks like a rendering bug and is really a resource cap. One dialog can only ever be
 * open once, so the count is one by construction, and nothing loads until it is asked
 * for.
 *
 * When the bench arrives (queue left, object right) this moves there and stays open for
 * the selected item — the layout that makes a permanent map affordable is the one where
 * there is only ever one object in view.
 */

import { Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Marker } from 'react-map-gl/maplibre';
import { GuardedMap } from '../shared/GuardedMap';
import { MAP_STYLE } from '../../constants/mapStyles';

export function PointPreviewDialog({ open, onClose, name, latitude, longitude }: {
  open: boolean;
  onClose: () => void;
  name: string;
  latitude: number;
  longitude: number;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {name}
        <Typography variant="body2" color="text.secondary">
          {latitude.toFixed(4)}, {longitude.toFixed(4)}
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ height: 420, p: 0 }}>
        {/* Mounted only while the dialog is open — MUI unmounts the content by default,
            which is what keeps the WebGL context to the moment it is wanted. Zoom 11
            shows the surroundings a description talks about rather than the roof of the
            building, which is what a curator is checking. */}
        {open && (
          <GuardedMap
            initialViewState={{ latitude, longitude, zoom: 11 }}
            mapStyle={MAP_STYLE}
            style={{ width: '100%', height: '100%' }}
            unavailableCompact
            unavailableDetail="The coordinate is above; the rest of this card needs no map."
          >
            <Marker latitude={latitude} longitude={longitude} />
          </GuardedMap>
        )}
      </DialogContent>
    </Dialog>
  );
}

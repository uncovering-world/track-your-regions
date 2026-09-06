/**
 * Where a place actually is, for a curator judging a claim about it — and, where
 * the place is theirs to correct, the pin already in their hands.
 *
 * A coordinate printed as text answers almost nothing: "14.1303, 38.7186" does not tell
 * anyone whether a description's "close to Ethiopia's northern border" is true. A map
 * does, in one look.
 *
 * A dialog rather than a map on every card, and the reason is a hard limit rather than
 * taste: each MapLibre instance holds its own WebGL context, browsers keep about a dozen
 * per tab, and the review page renders up to 25 cards *per kind*, across every kind the
 * queue returns. Stated as a rule and not a number because the number keeps growing, and
 * the newest kind grows it fastest: an answered withdrawal is one card holding up to 25
 * points, each with a dialog of its own, where a withdrawal card holds one per lost part.
 * Mounting one map per card would evict the earlier contexts and blank the maps — the
 * failure looks like a rendering bug and is really a resource cap. The conclusion is
 * unmoved by any of that arithmetic: MUI's `Dialog` mounts no children while closed and
 * only one can be open, so the count is one by construction, and nothing loads until it
 * is asked for.
 *
 * One mode, not two. Where a caller hands in a `correction`, the dialog opens on
 * `PointCorrection` — the map already on the place, the pin already draggable, Save
 * asleep until something changed — rather than on a look with a button to press before
 * editing. The count stays at one: the picker's map *is* the map then, and the read-only
 * one is drawn only where nothing may be corrected. Which is still most callers: a reader
 * looking at a place, and `ObjectContext`, which shows the source's locator rather than
 * a place.
 *
 * In `shared/` because the same look is asked for from three places — the review
 * page's cards, the object's own screen and the places list on a map — and the rule
 * for where a place may be corrected is the same on all of them: wherever a curator is
 * looking at one.
 */

import { Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Marker } from 'react-map-gl/maplibre';
import { GuardedMap } from './GuardedMap';
import { MAP_STYLE } from '../../constants/mapStyles';
import { PointCorrection, type PlaceToCorrect } from './PointCorrection';

export function PointPreviewDialog({ open, onClose, name, latitude, longitude, correction }: {
  open: boolean;
  onClose: () => void;
  name: string;
  latitude: number;
  longitude: number;
  /**
   * Offered where a curator may correct the place: what to correct, and where the
   * outcome line goes. Absent, the dialog is the look it always was.
   */
  correction?: { place: PlaceToCorrect; onDone: (message: string) => void };
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {name}
        <Typography variant="body2" color="text.secondary">
          {latitude.toFixed(4)}, {longitude.toFixed(4)}
          {/* Whose place this is — unless the place is named for the object already,
              as a museum's one place is, where the line would say the name twice. */}
          {correction && correction.place.objectName !== name ? ` · ${correction.place.objectName}` : ''}
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      {correction ? (
        <DialogContent>
          {/* Keyed on the place, since the card that owns this dialog is mounted
              unkeyed and a form holding one place's draft must not carry it onto
              the next. Cancel is the dialog's close: there is no look to go back to. */}
          <PointCorrection
            key={correction.place.locationId}
            place={correction.place}
            onDone={(message) => {
              correction.onDone(message);
              onClose();
            }}
            onCancel={onClose}
          />
        </DialogContent>
      ) : (
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
      )}
    </Dialog>
  );
}

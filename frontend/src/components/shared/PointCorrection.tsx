/**
 * A curator's correction to one place: what it is called, or where it is.
 *
 * The body of `PointPreviewDialog` wherever a curator may correct the place it
 * shows, and only the body: the dialog decides where a place can be looked at,
 * this decides what a correction says and sends. The map comes first and opens
 * on the building — the question is whether the pin is on the right one — with
 * the source's own position left as a faded pin under the one that moves, so a
 * move is read against something. Under the map, in the queue's own words
 * (`describeMove`, the sentence under a coordinate row on the review page),
 * how far the pin has gone; then the name; then what a save costs, since a claim
 * is not obvious from a text field. After a save, one thing more, read off the
 * reply rather than promised: whether the object's own position moved with the
 * place. The server decides that (`editLocation`'s anchor rule) and a screen
 * cannot know it in advance, since a pending place moves nothing whatever the
 * count.
 *
 * Sends only what changed. The endpoint takes the coordinate as a pair or not
 * at all and refuses an empty body, so a save with nothing changed is not
 * offered rather than refused. A name cannot be cleared here: the endpoint's
 * `name` is `min(1)`, and "this place has no name" is #696's question, asked
 * of an object today and of a place never.
 *
 * The mutation lives here rather than in the caller, so the invalidation does
 * too — `invalidateExperiences` reaches the object's own points, the region
 * batch that draws its pin and the review queue, which is every surface this
 * form opens from.
 */

import { useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { editLocation } from '../../api/experiences';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { placementNotice } from '../../utils/placementNotice';
import { describeMove, moveLabel } from '../../utils/moveDescription';
import { tidyLabel } from '../../utils/labelFold';
import { LocationPicker } from './LocationPicker';

/**
 * Why readers do not see the place, where they do not — two causes with two
 * remedies, so a boolean would print the wrong one. A withdrawn place (or one
 * answered lost) comes back only through the verdict "false alarm"; an unread
 * one, `pending` under a gated source, only through publication (ADR-0025).
 * Absent means readers see it.
 */
export type UnseenReason = 'withdrawn' | 'unread' | 'refused' | 'dropped' | 'blocked';

/** The place a curator is correcting, as the surface that opened it knows it. */
export interface PlaceToCorrect {
  locationId: number;
  /** The object the place belongs to: whose caches to clear, and whose name the outcome leads with. */
  experienceId: number;
  objectName: string;
  name: string | null;
  latitude: number;
  longitude: number;
  /** Set where readers do not see the place, so the form and the outcome say why a moved pin is still shown to nobody. */
  unseen?: UnseenReason;
  /** The region whose batch drew the pin, where the caller is looking at a region's map. */
  regionId?: number | null;
}

type Correction = { name?: string; latitude?: number; longitude?: number };
type Reply = Awaited<ReturnType<typeof editLocation>>;

/** A building fills the frame at this zoom; a country does at the picker's default. */
const PLACE_ZOOM = 15;

/** What shows the place to readers, per reason — the half of the sentence the reason decides. */
const REMEDY: Record<UnseenReason, string> = {
  withdrawn: 'only answering “false alarm” shows it',
  unread: 'only publishing it shows it',
  // Two steps rather than one, and both are named because a curator correcting a
  // pin here has turned it down themselves (#859): the mark comes off first, and
  // publishing it is still what shows it — the take-back restores the question,
  // never the answer.
  refused: 'asking about it again and then publishing it shows it',
  // And the case where that sequence would be a promise nothing can keep: a part
  // turned down *and* since dropped by the source. Publishing composes
  // `offeredLocationSql` beside the unread test, so it never reaches this row —
  // asking about it again puts the question back and nothing else moves.
  dropped: 'nothing will show it until the source lists it again',
  // And where the object itself is the open question — nobody has passed it, a
  // rule kept it out, or the source has dropped it — the take-back is refused
  // outright, so naming it as the next step would name the one thing the surface
  // that opened this has just disabled.
  blocked: 'answering this place’s own question first, and then asking about the '
    + 'point again, shows it',
};

/**
 * What landed, in one line: the object, the place, what changed, what followed.
 *
 * Pure and exported for its test, because it is the one place three surfaces
 * agree on what a correction did. The object's own position is mentioned only
 * where it moved: on a serial site it never does and saying so on every part
 * would be noise, while on a place readers cannot see the thing worth saying
 * is that they still cannot, and what would change that.
 */
export function correctionOutcome(place: PlaceToCorrect, correction: Correction, reply: Reply): string {
  const label = place.name ?? 'the place';
  const renamed = correction.name !== undefined;
  const moved = correction.latitude !== undefined && correction.longitude !== undefined;
  const changes: string[] = [];
  if (renamed) changes.push(`renamed to “${correction.name}”`);
  if (moved) {
    const by = moveLabel(
      { lon: place.longitude, lat: place.latitude },
      { lon: correction.longitude as number, lat: correction.latitude as number },
    );
    changes.push(by ? `moved ${by}` : 'moved');
  }
  const sentences = [`${place.objectName}: ${label} ${changes.join(' and ')}.`];
  if (reply.anchorMoved) {
    sentences.push('The object’s own position moved with it.');
  } else if (place.unseen) {
    sentences.push(`Readers still do not see this place; ${REMEDY[place.unseen]}.`);
  }
  sentences.push(`The source will no longer overwrite ${claimedFields(renamed, moved)}.`);
  const placement = placementNotice({ name: place.objectName }, reply);
  if (placement) sentences.push(placement);
  return sentences.join(' ');
}

/** The fields a correction claimed, as the outcome names them. */
function claimedFields(renamed: boolean, moved: boolean): string {
  if (renamed && moved) return 'its name or where it is';
  if (renamed) return 'its name';
  return 'where it is';
}

export function PointCorrection({ place, onDone, onCancel }: {
  place: PlaceToCorrect;
  /** The outcome line, for wherever the caller reports the rest of its answers. */
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(place.name ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    { lat: place.latitude, lng: place.longitude },
  );

  // Tidied on both sides, as the endpoint stores a name (`tidyLabel`, #835):
  // a name that differs from the stored one only by whitespace is the same
  // name, and sending it would claim the column over an edit nobody made.
  const trimmed = tidyLabel(name);
  const renamed = trimmed.length > 0 && trimmed !== tidyLabel(place.name ?? '');
  const moved = coords !== null && (coords.lat !== place.latitude || coords.lng !== place.longitude);
  const correction: Correction = {
    ...(renamed ? { name: trimmed } : {}),
    ...(moved && coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
  };

  const save = useMutation({
    mutationFn: () => editLocation(place.locationId, correction),
    onSuccess: (reply) => {
      invalidateExperiences(queryClient, { experienceId: place.experienceId, regionId: place.regionId });
      onDone(correctionOutcome(place, correction, reply));
    },
  });

  const moveSentence = moved && coords
    ? describeMove({ lon: place.longitude, lat: place.latitude }, { lon: coords.lng, lat: coords.lat })
    : null;

  return (
    <Stack spacing={1.5}>
      {/* The picker's map is the map of this dialog: the read-only one is drawn
          only where nothing may be corrected, so there is one WebGL context here
          as everywhere else. */}
      <LocationPicker
        value={coords}
        onChange={setCoords}
        name={place.name ?? place.objectName}
        initialZoom={PLACE_ZOOM}
        origin={{ lat: place.latitude, lng: place.longitude }}
      />
      {moveSentence && (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{moveSentence}</Typography>
      )}
      {place.unseen && (
        <Typography variant="caption" color="text.secondary">
          Readers do not see this place. A correction is kept, and shows nobody anything
          — {REMEDY[place.unseen]}.
        </Typography>
      )}
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        size="small"
        fullWidth
        slotProps={{ htmlInput: { maxLength: 500 } }}
      />
      {save.isError && (
        <Alert severity="error">
          {save.error instanceof Error ? save.error.message : 'The correction could not be saved.'}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          Saving claims what you change: the source stops overwriting that field at every later
          run, while everything else about this place still follows it.
        </Typography>
        <Button onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          disabled={save.isPending || (!renamed && !moved)}
        >
          Save
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * A curator's correction to one place: what it is called, where it is, and —
 * where the surface that opened it knows them — its own picture and description
 * (#1270), which a World Heritage run fills from the part's Wikidata item.
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
import { editLocation, type LocationEditResult } from '../../api/curation';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { placementNotice } from '../../utils/placementNotice';
import { describeMove, moveLabel } from '../../utils/moveDescription';
import { tidyLabel } from '@tyr/shared/labels';
import { LocationPicker } from './LocationPicker';
import { PictureWithCredit } from './PictureWithCredit';
import type { ImageCredit } from '../../api/experiences';

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
  /**
   * The place's own picture, where the caller knows it: absent hides the field,
   * since a field opened empty over a stored picture would read as none.
   */
  imageUrl?: string | null;
  /** Whose photograph the stored picture is, shown under it in the preview and never under an unsaved one. */
  imageCredit?: ImageCredit | null;
  /** The place's own description, where the caller's read carries it (the object's own read does). */
  description?: string | null;
}

type Correction = { name?: string; latitude?: number; longitude?: number; imageUrl?: string; description?: string };

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
export function correctionOutcome(place: PlaceToCorrect, correction: Correction, reply: LocationEditResult): string {
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
  if (correction.imageUrl !== undefined) changes.push(pictureChange(correction.imageUrl, reply));
  if (correction.description !== undefined) {
    changes.push(correction.description ? 'given a new description' : 'left without a description');
  }
  const sentences = [`${place.objectName}: ${label} ${joinChanges(changes)}.`];
  if (reply.anchorMoved) {
    sentences.push('The object’s own position moved with it.');
  } else if (place.unseen) {
    sentences.push(`Readers still do not see this place; ${REMEDY[place.unseen]}.`);
  }
  sentences.push(`The source will no longer overwrite ${claimedFields(correction)}.`);
  const placement = placementNotice({ name: place.objectName }, reply);
  if (placement) sentences.push(placement);
  return sentences.join(' ');
}

/** "a", "a and b", "a, b and c". */
function joinChanges(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What happened to the picture, with whom it is now credited to — answered by
 * the server rather than promised, since Commons may name nobody in time.
 */
function pictureChange(imageUrl: string, reply: LocationEditResult): string {
  if (!imageUrl) return 'left to show its object’s picture';
  // A picture we host is not Commons', so Commons was never asked about it.
  if (imageUrl.startsWith('/images/')) return 'given a picture we host';
  // No credit at all is Commons not answering in time; a credit with no author
  // is Commons answering with a licence and nobody named.
  if (!reply.imageCredit) return 'given a picture Commons named no photographer for in time';
  const author = reply.imageCredit.author;
  return author ? `given a picture credited to ${author}` : 'given a picture Commons credits to no one by name';
}

/** The fields a correction claimed, as the outcome names them. */
function claimedFields(correction: Correction): string {
  const fields: string[] = [];
  if (correction.name !== undefined) fields.push('its name');
  if (correction.latitude !== undefined) fields.push('where it is');
  if (correction.imageUrl !== undefined) fields.push('its picture');
  if (correction.description !== undefined) fields.push('its description');
  return fields.length <= 1 ? fields.join('') : `${fields.slice(0, -1).join(', ')} or ${fields[fields.length - 1]}`;
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
  const [picture, setPicture] = useState(place.imageUrl ?? '');
  const [description, setDescription] = useState(place.description ?? '');

  // Tidied on both sides, as the endpoint stores a name (`tidyLabel`, #835):
  // a name that differs from the stored one only by whitespace is the same
  // name, and sending it would claim the column over an edit nobody made.
  const trimmed = tidyLabel(name);
  const renamed = trimmed.length > 0 && trimmed !== tidyLabel(place.name ?? '');
  const moved = coords !== null && (coords.lat !== place.latitude || coords.lng !== place.longitude);
  // Sent only where the caller knew the stored value: '' clears it, which is a
  // claim too — "this part has no picture of its own" — so it must be meant.
  const repictured = place.imageUrl !== undefined && picture.trim() !== (place.imageUrl ?? '');
  const redescribed = place.description !== undefined && description.trim() !== (place.description ?? '');
  const correction: Correction = {
    ...(renamed ? { name: trimmed } : {}),
    ...(moved && coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
    ...(repictured ? { imageUrl: picture.trim() } : {}),
    ...(redescribed ? { description: description.trim() } : {}),
  };
  const changed = renamed || moved || repictured || redescribed;

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
      {place.imageUrl !== undefined && (
        <TextField
          label="Picture"
          value={picture}
          onChange={(e) => setPicture(e.target.value)}
          size="small"
          fullWidth
          helperText={`A Wikimedia Commons file, or a picture we host (/images/…). Empty shows ${place.objectName}’s own picture; a Commons photographer is looked up on save.`}
        />
      )}
      {/* The file the field names, drawn before it is claimed: a curator must see
          the photograph they are about to give this part. The stored credit only
          under the stored picture — none exists for an address not yet saved. */}
      {place.imageUrl !== undefined && picture.trim() !== '' && (
        <PictureWithCredit
          url={picture.trim()}
          credit={repictured ? undefined : place.imageCredit}
          alt={place.name ?? place.objectName}
          width={250}
        />
      )}
      {place.description !== undefined && (
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      )}
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
          disabled={save.isPending || !changed}
        >
          Save
        </Button>
      </Stack>
    </Stack>
  );
}

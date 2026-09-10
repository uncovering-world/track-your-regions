/**
 * Where the object is, as a field of the curate dialog — beside its name, where a
 * fact about the object belongs — with the way to correct it.
 *
 * The one door to a place for 1178 of 1671 objects — all 127 museums, all 265
 * monuments, 786 World Heritage sites (measured 2026-09-06). An object with one
 * place has no row for it anywhere: every places list on a card is drawn for
 * `isMultiLocation` only, and for a reader that is right, since the object row is
 * the place. A curator who opened the object to fix a pin on the wrong side of the
 * block had nothing to click. A serial site gets the same field, its parts folded
 * behind a count, so the object screen follows the rule #583 is built on: a place
 * is corrected wherever a curator is looking at one.
 *
 * A field and not a section, on the product review of 2026-09-06: the dialog is a
 * form, and "where it is" read as a form row after the name is the object's own
 * fact, where the same thing as a heading under Reject read as an afterthought.
 * Read-only, since the value is a map's to change, not a keyboard's.
 *
 * Reads `GET /api/experiences/:id/locations`, which answers a curator the unread
 * rows as well (`maySeeUnreadExperience`, ADR-0025): a gated arrival's places are
 * part of what a curator is judging, and the row says so, since correcting one
 * shows readers nothing until it is published. It answers *nothing* for an object
 * whose every place the source withdrew or a curator declared gone — the read
 * offers what readers can be sent to — and that is said as what it is rather than
 * as a count of nothing. Under the key Discover's panel reads, so a correction
 * saved in the dialog refetches both, and under the one `invalidateExperiences`
 * names.
 *
 * Capped the way the review page caps its lists: the largest serial nomination
 * holds 758 points, and a dialog is not a place to read 758 of anything. The cap
 * is said and lifted on request, never silent.
 */

import { useState } from 'react';
import {
  Alert, Box, Button, Chip, Collapse, IconButton, InputAdornment, TextField, Tooltip, Typography,
} from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import EditLocationAltIcon from '@mui/icons-material/EditLocationAlt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useQuery } from '@tanstack/react-query';
import { fetchExperienceLocations, type ExperienceLocation } from '../../api/experiences';
import { locationLabel } from '../../utils/locationLabel';
import { claimLabel } from '../../utils/placeClaims';
import { ContentsList } from './ContentsList';
import { PointPreviewDialog } from './PointPreviewDialog';
import type { UnseenReason } from './PointCorrection';

/** As many as the review page lists before it says "showing N of M". */
const PLACES_SHOWN = 25;

/**
 * Why readers do not see the place, where the read says they do not.
 *
 * The mark is asked first, because the state cannot tell the two apart: a point a
 * curator turned down stays `pending` (ADR-0053), and reading the state alone
 * called it unread and offered publishing as the remedy — which the publish
 * refuses, composing `unreadPointSql` and its `refused_at IS NULL` (#859).
 */
function unseenReason(
  place: ExperienceLocation, objectMissingSince?: string | null,
): UnseenReason | undefined {
  if (place.refused_at) return objectMissingSince ? 'blocked' : 'refused';
  return place.curation_state === 'pending' ? 'unread' : undefined;
}

/**
 * Who sees the place, in the words its own reason decides.
 *
 * Three states rather than two since #859: a turned-down point is not unread and
 * not shown either, and the sentence a boolean produced for it was the wrong one
 * on both branches — "readers are sent here once it is published" of a point
 * publishing refuses, and "the one place readers are sent to" of a point nobody
 * is sent to.
 */
const WHO_SEES_IT: Record<UnseenReason | 'seen', string> = {
  unread: 'Unread: readers are sent here once it is published.',
  withdrawn: 'Withdrawn: readers are not sent here, and only “false alarm” brings it back.',
  refused: 'Turned down: readers are not sent here, and publishing will not send them — '
    + 'ask about it again on the review page first.',
  // Unreachable on this screen — `getExperienceLocations` carries
  // `offeredLocationSql`, so a place the source has dropped is not served here at
  // all — and stated anyway, because the table is what a fifth value would be
  // added to and a gap is how one arrives unnoticed.
  dropped: 'Turned down, and the source has stopped listing it: nothing will show it '
    + 'until the source lists it again.',
  blocked: 'Turned down, under an object with a question of its own: answer that first, '
    + 'then ask about this place again.',
  seen: 'The one place readers are sent to.',
};

/** The same three states as a chip, and nothing where readers do see the place. */
const UNSEEN_CHIP: Record<UnseenReason | 'seen', string | null> = {
  unread: 'unread',
  withdrawn: 'withdrawn',
  refused: 'turned down',
  dropped: 'turned down, dropped',
  blocked: 'turned down',
  seen: null,
};

function coordinate(place: ExperienceLocation): string {
  return `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
}

/** The pin icon every shape of the field opens with. */
const pinAdornment = (
  <InputAdornment position="start"><PlaceIcon fontSize="small" color="primary" /></InputAdornment>
);

export function CurationPlaces({
  experienceId, experienceName, regionId, countryNames, objectMissingSince,
}: {
  experienceId: number;
  experienceName: string;
  /** The region whose batch draws the pins, where the dialog was opened from a region's map. */
  regionId: number | null;
  /** The countries the object counts in, for the one-place row's value line. */
  countryNames?: string[] | null;
  /**
   * Set where the source has stopped listing the *object*, which is a question of
   * its own and blocks the take-back under it (#859).
   *
   * The read this screen uses does not filter the object on it — it hides a refused
   * or unread object and deliberately not a withdrawn one — so a turned-down place
   * under such an object is served here while the review page disables *Ask about
   * it again* on the same row. Without this the two screens say opposite things.
   */
  objectMissingSince?: string | null;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['experience-locations', experienceId],
    queryFn: () => fetchExperienceLocations(experienceId),
  });
  // The place a curator opened, held as the place rather than a flag. The dialog
  // around this reconciles across objects and keys this field on the object, so
  // a place opened here never outlives the object it belongs to.
  const [open, setOpen] = useState<ExperienceLocation | null>(null);
  // What the last correction did, said here: this screen has no other line for it.
  const [notice, setNotice] = useState<string | null>(null);

  if (isLoading) {
    return <TextField label="Location" size="small" fullWidth value="Loading…" slotProps={{ input: { readOnly: true } }} />;
  }
  if (isError || !data) {
    return (
      <Typography variant="body2" color="error">
        Could not list its places{error instanceof Error ? `: ${error.message}` : '.'}
      </Typography>
    );
  }

  const places = data.locations;
  if (places.length === 0) return <NoPlaceField />;

  const single = places.length === 1 ? places[0] : null;
  // The one place of a museum or a monument is the object: its row reads the
  // object's name, not "Location 2" off an ordinal the source happened to give.
  // A serial site's parts keep the map's own labels, since telling them apart
  // is the point.
  const label = (place: ExperienceLocation) =>
    (single && !place.name ? experienceName : locationLabel(place));

  return (
    <>
      {single
        ? (
          <SinglePlaceField
            place={single}
            label={label(single)}
            countryNames={countryNames}
            objectMissingSince={objectMissingSince}
            onOpen={setOpen}
          />
        )
        : (
          <PlacesListField
            places={places}
            label={label}
            objectMissingSince={objectMissingSince}
            onOpen={setOpen}
          />
        )}
      {notice && (
        <Alert severity="info" onClose={() => setNotice(null)}>{notice}</Alert>
      )}
      {open && (
        <PointPreviewDialog
          open
          onClose={() => setOpen(null)}
          name={label(open)}
          latitude={open.latitude}
          longitude={open.longitude}
          correction={{
            place: {
              locationId: open.id,
              experienceId,
              objectName: experienceName,
              name: open.name,
              latitude: open.latitude,
              longitude: open.longitude,
              unseen: unseenReason(open, objectMissingSince),
              regionId,
            },
            onDone: setNotice,
          }}
        />
      )}
    </>
  );
}

/**
 * An object with no place readers can be sent to: its only place the source
 * withdrew, or a curator declared gone. Said as that, with where to answer for
 * it, rather than as "0 places" behind a disclosure that opens onto nothing.
 */
function NoPlaceField() {
  return (
    <TextField
      label="Location"
      size="small"
      fullWidth
      value="No place readers can be sent to"
      helperText="Its place was withdrawn by the source or declared gone. The review page is where that is answered; a place that comes back can be corrected here."
      slotProps={{ input: { readOnly: true, startAdornment: pinAdornment } }}
    />
  );
}

/** The one place of a museum or a monument, as a field: where it is, and the way in. */
function SinglePlaceField({ place, label, countryNames, objectMissingSince, onOpen }: {
  place: ExperienceLocation;
  label: string;
  countryNames?: string[] | null;
  /** The object's own withdrawal, which blocks the take-back under it — see `unseenReason`. */
  objectMissingSince?: string | null;
  onOpen: (place: ExperienceLocation) => void;
}) {
  const claim = claimLabel(place.curated_fields);
  const countries = countryNames && countryNames.length > 0 ? ` · ${countryNames.join(', ')}` : '';
  const unseen = unseenReason(place, objectMissingSince);
  return (
    <TextField
      label="Location"
      size="small"
      fullWidth
      value={`${coordinate(place)}${countries}`}
      helperText={`${WHO_SEES_IT[unseen ?? 'seen']} Open it to see the pin, or to move or rename it.`}
      slotProps={{
        input: {
          readOnly: true,
          startAdornment: pinAdornment,
          endAdornment: (
            <InputAdornment position="end">
              {unseen && (
                <Chip label={UNSEEN_CHIP[unseen]} size="small" variant="outlined" sx={{ mr: 0.5 }} />
              )}
              {claim && <Chip label={claim} size="small" color="primary" variant="outlined" sx={{ mr: 0.5 }} />}
              <Tooltip title="Move or rename">
                <IconButton size="small" aria-label={`Move or rename ${label}`} onClick={() => onOpen(place)}>
                  <EditLocationAltIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** A serial site's parts, folded behind a count and listed on request, capped and saying so. */
function PlacesListField({ places, label, objectMissingSince, onOpen }: {
  places: ExperienceLocation[];
  label: (place: ExperienceLocation) => string;
  /** The object's own withdrawal, which blocks the take-back under it — see `unseenReason`. */
  objectMissingSince?: string | null;
  onOpen: (place: ExperienceLocation) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? places : places.slice(0, PLACES_SHOWN);
  return (
    <>
      <TextField
        label="Places"
        size="small"
        fullWidth
        value={`${places.length} places · as the source lists them`}
        slotProps={{
          input: {
            readOnly: true,
            startAdornment: pinAdornment,
            endAdornment: (
              <InputAdornment position="end">
                <Button
                  size="small"
                  onClick={() => setListOpen(v => !v)}
                  endIcon={listOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                >
                  {listOpen ? 'Hide places' : 'Show places'}
                </Button>
              </InputAdornment>
            ),
          },
        }}
      />
      <Collapse in={listOpen} unmountOnExit>
        <Box sx={{ px: 1 }}>
          <ContentsList
            noun="place"
            total={places.length}
            shown={shown.length}
            items={shown.map(place => ({
              id: place.id,
              primary: label(place),
              secondary: [
                coordinate(place),
                UNSEEN_CHIP[unseenReason(place, objectMissingSince) ?? 'seen'] ?? null,
                claimLabel(place.curated_fields),
              ].filter(Boolean).join(' · '),
              onOpen: () => onOpen(place),
            }))}
          />
          {!showAll && places.length > PLACES_SHOWN && (
            <Button size="small" onClick={() => setShowAll(true)} sx={{ textTransform: 'none', mt: 0.5 }}>
              Show all {places.length} places
            </Button>
          )}
        </Box>
      </Collapse>
    </>
  );
}

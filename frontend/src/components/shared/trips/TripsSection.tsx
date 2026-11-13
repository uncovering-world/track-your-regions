import { useState } from 'react';
import { Alert, Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import { useVisitWritePending } from '../../../hooks/useVisitedExperiences';
import { formatApproximateDate } from '../../../utils/dateFormat';
import type { Trip, TripDateBody } from '../../../api/trips';
import { TripDateEditor } from './TripDateEditor';
import { useTrips } from './useTrips';

const NO_DATE: TripDateBody = { year: null, month: null, day: null };

/** The quick choices "Add a trip" opens, each a date as of today in the traveller's own calendar. */
function quickDates(now: Date): { label: string; date: TripDateBody | 'year' | 'pick' }[] {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const dayOf = (d: Date): TripDateBody => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
  return [
    { label: 'Today', date: dayOf(now) },
    { label: 'Yesterday', date: dayOf(yesterday) },
    { label: 'This month', date: { year: now.getFullYear(), month: now.getMonth() + 1, day: null } },
    { label: 'A year…', date: 'year' },
    { label: 'Pick a date', date: 'pick' },
    { label: "I don't remember", date: NO_DATE },
  ];
}

/** What a removed trip's line calls it: "The March 2022 trip", "A trip with no date". */
function removedTripLabel(trip: Trip): string {
  return trip.year === null ? 'A trip with no date is removed' : `The ${formatApproximateDate(trip)} trip is removed`;
}

/**
 * The trips of the traveller's own visit to a place, on its card (#2120,
 * ADR-0202): newest first, each with its approximate date, changed in its own
 * line; a trip added from quick choices; a trip removed with an Undo in its
 * place once the removal is written. A date's line or the choices close once
 * the write is done, and the Undo goes once the trip is back, so a write that
 * fails loses nothing typed or removed, and the section says it failed.
 * Removing the last one keeps the place visited, with no date. Shown only
 * while the place itself is visited, and only to its traveller; one section
 * holds one place of one traveller (`LazyTripsSection` keys it).
 */
export function TripsSection({ experienceId }: { experienceId: number }) {
  const { trips, add, change, remove, failed } = useTrips(experienceId);
  const pending = useVisitWritePending();
  const [editing, setEditing] = useState<number | 'adding' | 'year' | 'pick' | null>(null);
  // The last trip removed, offered back once its removal is written, and the
  // trip being changed, for as long as the visit they belong to lasts: an
  // untick ends that visit.
  const [removed, setRemoved] = useState<Trip | null>(null);
  if (!trips?.visited) {
    if (removed) setRemoved(null);
    if (editing !== null) setEditing(null);
    return null;
  }

  const close = () => setEditing(null);
  const thisYear = new Date().getFullYear();
  return (
    <Box component="section" aria-label="Your trips" sx={{ mb: 1.5 }} onClick={e => e.stopPropagation()}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Your trips</Typography>
      {failed && <Alert severity="error" sx={{ py: 0, mb: 0.5 }}>Your trips were not changed. Try again.</Alert>}
      {removed && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary">{removedTripLabel(removed)}</Typography>
          <Button size="small" disabled={pending} onClick={() => add(removed, { onSuccess: () => setRemoved(null) })}>Undo</Button>
        </Box>
      )}
      {trips.trips.map(trip => (editing === trip.id
        ? (
          <TripDateEditor
            key={trip.id} initial={trip} disabled={pending} onCancel={close}
            onSave={date => change({ tripId: trip.id, date }, { onSuccess: close })}
          />
        )
        : (
          <Box key={trip.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>{formatApproximateDate(trip)}</Typography>
            <Tooltip title="Change the date">
              <IconButton size="small" aria-label={`Change the date of ${formatApproximateDate(trip)}`}
                disabled={pending} onClick={() => setEditing(trip.id)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Remove this trip">
              <IconButton size="small" aria-label={`Remove the trip of ${formatApproximateDate(trip)}`}
                disabled={pending} onClick={() => remove(trip.id, { onSuccess: () => setRemoved(trip) })}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )))}
      {editing === 'year' || editing === 'pick'
        ? (
          <TripDateEditor
            initial={editing === 'year' ? { year: thisYear, month: null, day: null } : quickDates(new Date())[0].date as TripDateBody}
            disabled={pending} onCancel={close}
            onSave={date => add(date, { onSuccess: close })}
          />
        )
        : null}
      {editing === 'adding' && (
        <Box role="group" aria-label="When were you here?" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
          <Typography variant="body2">When were you here?</Typography>
          {quickDates(new Date()).map(({ label, date }) => (
            <Button key={label} size="small" variant="outlined" disabled={pending}
              onClick={() => { if (typeof date === 'string') setEditing(date); else add(date, { onSuccess: close }); }}>
              {label}
            </Button>
          ))}
        </Box>
      )}
      {editing === null && (
        <Button size="small" disabled={pending} onClick={() => setEditing('adding')}>Add a trip</Button>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Only you see these dates.</Typography>
    </Box>
  );
}

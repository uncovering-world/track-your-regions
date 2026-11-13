import { Alert, Box, Button, Typography } from '@mui/material';
import type { RemovedVisit } from '../../../api/trips';
import { useVisitWritePending } from '../../../hooks/useVisitedExperiences';
import { useRestoreVisits } from './useTrips';

/**
 * What an untick that removed trips says (#2120): "Visit removed, with its 2
 * trips", or for a batch "3 visits removed, with their 5 trips". The numbers
 * are written in numerals, a trip and a visit in the singular where there is
 * one (docs/tech/interface-writing.md).
 */
export function removedVisitsSentence(visits: RemovedVisit[]): string {
  const trips = visits.reduce((sum, visit) => sum + visit.trips.length, 0);
  const tripWords = trips === 1 ? 'trip' : `${trips} trips`;
  if (visits.length === 1) return `Visit removed, with its ${tripWords}`;
  return `${visits.length} visits removed, with their ${tripWords}`;
}

/**
 * The Undo of an untick that took trips with its visits, in one quiet line,
 * read out once. It stays until the next visit write or until the list it
 * stands in shows another region (`visitRemovals.ts`), and puts every visit
 * of the untick back with its trips in one request, held while that request
 * is on its way, and says so when it fails.
 */
export function VisitRemovedLine({ visits }: { visits: RemovedVisit[] }) {
  const pending = useVisitWritePending();
  const restore = useRestoreVisits();
  return (
    <>
      <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 0.5 }}>
        <Typography variant="body2" color="text.secondary">{removedVisitsSentence(visits)}</Typography>
        <Button size="small" disabled={pending} onClick={() => restore.mutate()}>Undo</Button>
      </Box>
      {restore.isError && <Alert severity="error" sx={{ py: 0, mx: 2 }}>Your visits were not put back. Try again.</Alert>}
    </>
  );
}

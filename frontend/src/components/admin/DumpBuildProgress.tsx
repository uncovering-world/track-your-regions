/**
 * What the Public Dumps page shows of a dump build wherever it shows one: the
 * admin's card for the copy built from a dump and the developers' tables
 * (`DumpsPanel.tsx`) read the same sizes, dates and running progress.
 */

import { Box, LinearProgress, Typography } from '@mui/material';
import type { DumpBuildProgress, DumpsDumpsItem } from '../../api/admin/dumps';
import { formatRelativeTime, formatTimeLeft } from '../../utils/dateFormat';

const GB = 1024 ** 3;
export const size = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);
export const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
/** A build queued for the dump worker or running in it (ADR-0106): the row follows it until it ends. */
export const inFlight = (progress: DumpBuildProgress | null) => progress !== null;

/** A dump's date as what it stands for: the day of the dump, or the month its counts cover. */
export function dumpDate(date: string, datedBy: DumpsDumpsItem['datedBy']): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return datedBy === 'month'
    ? value.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * How long the dump worker may go without beating before the row says it may have stopped: it
 * beats every five seconds whatever step it is in, so a minute of silence is not a slow step.
 */
const SILENT_FOR_MS = 60_000;

/** A running build as a person follows it: what it does, how far, and whether the worker still answers. */
export function BuildProgressDetails({ progress }: { progress: DumpBuildProgress }) {
  // What the step's bar is measured against: the dump's file in a pass, the terms spool while labelling, the sample's size while cutting one (#1519).
  const total = progress.total;
  const done = Math.max(progress.read, progress.downloaded);
  const measured = total !== null && total > 0;
  const silent = progress.heartbeatAt !== null && Date.now() - new Date(progress.heartbeatAt).getTime() > SILENT_FOR_MS;
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.5 }}>{progress.message}</Typography>
      <LinearProgress
        variant={measured ? 'determinate' : 'indeterminate'}
        value={measured ? Math.min(100, (done / total) * 100) : undefined}
      />
      {progress.heartbeatAt && (
        <Typography variant="caption" color={silent ? 'error' : 'text.secondary'} display="block">
          {silent
            ? `No word from the dump worker since ${formatRelativeTime(progress.heartbeatAt)}: it may have stopped`
            : <>
              {progress.stepStartedAt && `This step started ${formatRelativeTime(progress.stepStartedAt)} · `}
              {progress.etaSeconds !== null && `${formatTimeLeft(progress.etaSeconds)} left in it · `}
              Last seen alive {formatRelativeTime(progress.heartbeatAt)}
            </>}
        </Typography>
      )}
      {done > 0 && (
        <Typography variant="caption" color="text.secondary">
          {size(done)}{measured ? ` of ${size(total)}` : ''}{progress.lines > 0 ? ` · ${compact.format(progress.lines)} lines` : ''}
        </Typography>
      )}
    </Box>
  );
}

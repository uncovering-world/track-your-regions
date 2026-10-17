/**
 * What the Public Dumps page shows of a dump build wherever it shows one: the
 * admin's card for the copy built from a dump and the developers' tables
 * (`DumpsPanel.tsx`) read the same sizes, dates and running progress.
 */

import { Box, Typography } from '@mui/material';
import type { DumpBuildProgress, DumpsDumpsItem } from '../../api/admin/dumps';
import { formatRelativeTime, formatTimeLeft } from '../../utils/dateFormat';
import { OperationProgressView } from './OperationProgressView';

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
  const silent = progress.heartbeatAt !== null && Date.now() - new Date(progress.heartbeatAt).getTime() > SILENT_FOR_MS;
  return (
    <Box>
      {/* The step, its bar measured against the file, spool or sample it reads (#1519), and its times: the shared view (#1356). */}
      <OperationProgressView operation={progress.operation} starting={progress.message} formatCount={size} />
      {progress.lines > 0 && (
        <Typography variant="caption" color="text.secondary" display="block">{compact.format(progress.lines)} lines</Typography>
      )}
      {progress.heartbeatAt && (
        <Typography variant="caption" color={silent ? 'error' : 'text.secondary'} display="block">
          {silent
            ? `No word from the dump worker since ${formatRelativeTime(progress.heartbeatAt)}: it may have stopped`
            : <>
              {progress.etaSeconds !== null && `${formatTimeLeft(progress.etaSeconds)} left in this step · `}
              Last seen alive {formatRelativeTime(progress.heartbeatAt)}
            </>}
        </Typography>
      )}
    </Box>
  );
}

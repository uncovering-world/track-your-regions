/**
 * What a source's card shows of its run: the status chip, the run in flight
 * with its progress and counts, and how the last followed run ended.
 */

import { Box, Typography, LinearProgress, Chip, Alert } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import CheckIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CancelIcon from '@mui/icons-material/Cancel';
import type { ExperienceSource, SyncStatus } from '../../api/admin';
import { SourceLastRunNote } from './SourceLastRunNote';
import { RUN_WORDS } from './syncRunKinds';
import { OperationProgressView } from './OperationProgressView';
import type { SourceRun } from './useSourceRun';

/**
 * How a run that stopped is reported: a failure with the run's own last words,
 * a cancellation without them. A cancellation's message is the orchestrator's
 * `Sync cancelled`, which would make a repair's sentence say "sync", and "was
 * cancelled" already says all of it.
 */
function endedBadlySentence(
  kind: SyncStatus['kind'],
  ended: { status: string; message: string },
): string {
  const subject = RUN_WORDS[kind ?? 'sync'].subject;
  if (ended.status !== 'failed') return `${subject} was cancelled.`;
  return ended.message ? `${subject} failed: ${ended.message}` : `${subject} failed.`;
}

/** The source's chip: the run in flight, which kind and whether it writes, or how the last one ended. */
export function RunStatusChip({ source, run }: { source: ExperienceSource; run: SourceRun }) {
  if (run.isRunning) {
    return (
      <Chip
        icon={<SyncIcon />}
        label={RUN_WORDS[run.status?.kind ?? 'sync'].running(run.status?.dryRun === true)}
        color="primary"
        size="small"
      />
    );
  }
  // Every way a run can end (`ClosedSyncStatus`): the switch is exhaustive,
  // so a status the vocabulary gains without a chip here is a type error.
  switch (source.last_sync_status) {
    case 'success':
      return <Chip icon={<CheckIcon />} label="Success" color="success" size="small" />;
    case 'partial':
      return <Chip icon={<ErrorIcon />} label="Partial" color="warning" size="small" />;
    case 'failed':
      return <Chip icon={<ErrorIcon />} label="Failed" color="error" size="small" />;
    case 'cancelled':
      return <Chip icon={<CancelIcon />} label="Cancelled" color="default" size="small" />;
    case null:
      return source.last_sync_at
        ? <Chip icon={<ScheduleIcon />} label="Completed" color="default" size="small" />
        : <Chip label="Never synced" color="default" size="small" />;
    default: {
      const unhandled: never = source.last_sync_status;
      return <Chip label={String(unhandled)} size="small" />;
    }
  }
}

/** The run in flight, or how the last one this card followed ended. */
export function SourceRunView({ run }: { run: SourceRun }) {
  const { status } = run;
  const progress = status?.percent || 0;
  // Nothing knows how many museums there are until the source answers, so the
  // whole collection phase reports zero — and a bar parked at zero is read as a
  // hung run, which is what run 61 looked like while it was waiting out
  // Wikidata's gateway errors. An indeterminate bar says the true thing: this is
  // moving, and how much is left is not knowable yet.
  const measurable = progress > 0;

  return (
    <>
      {run.isRunning && status && (
        <Box sx={{ mb: 2 }}>
          {/* A run that reports through the shared shape (#1356) says its
              step and how far through it; the others still say a percent. */}
          {status.operation ? (
            <OperationProgressView operation={status.operation} starting={status.statusMessage ?? ''} />
          ) : (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">{status.statusMessage}</Typography>
                <Typography variant="body2">{measurable ? `${progress}%` : 'Collecting…'}</Typography>
              </Box>
              <LinearProgress
                variant={measurable ? 'determinate' : 'indeterminate'}
                value={measurable ? progress : undefined}
              />
            </>
          )}
          {status.currentItem && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {status.currentItem}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <Typography variant="caption">Created: {status.created || 0}</Typography>
            <Typography variant="caption">Updated: {status.updated || 0}</Typography>
            {/* Under a gate this is the number that moves while Updated
                stays at zero; without it a gated run looks idle from start
                to finish (#523). */}
            <Typography variant="caption">Held: {status.held || 0}</Typography>
            <Typography variant="caption">Errors: {status.errors || 0}</Typography>
          </Box>
        </Box>
      )}
      {run.endedBadly && (
        <Alert
          severity={run.endedBadly.status === 'failed' ? 'error' : 'warning'}
          sx={{ mb: 2 }}
          onClose={run.dismissEndedBadly}
        >
          {/* The run's own last words, kept after the run is gone: a repair
              that stopped because Wikidata did not answer changed nothing and
              says so, and that sentence is the whole of what an admin needs
              from it. */}
          {endedBadlySentence(status?.kind, run.endedBadly)}
        </Alert>
      )}
      {!run.isRunning && <SourceLastRunNote run={status?.lastRun} />}
      {run.lostTouch && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Lost touch with the server — reload to see how this run ended.
        </Alert>
      )}
      {run.justCompleted && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={run.dismissCompleted}>
          {/* A repair and a component search end with their own count, and
              that sentence is the whole of what an admin wants from them.
              Which kind ended is the server's word (`kind`), not a memory of
              which button was pressed, so a reload mid-run cannot make one
              end in a sync's sentence. */}
          {RUN_WORDS[status?.kind ?? 'sync'].finished(status?.statusMessage)}
        </Alert>
      )}
    </>
  );
}

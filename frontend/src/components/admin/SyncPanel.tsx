/**
 * Sync Panel
 *
 * Controls for syncing experience sources (UNESCO, etc.)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  LinearProgress,
  Chip,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Sync as SyncIcon,
  Stop as StopIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  DragIndicator as DragIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCategories,
  startSync,
  getSyncStatus,
  cancelSync,
  reorderCategories,
  type ExperienceCategory,
  type SyncStatus,
} from '../../api/admin';
import { formatDateTime } from '../../utils/dateFormat';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { CurationGateControls } from './CurationGateControls';
import { WikidataCacheSection } from './WikidataCacheSection';

export function SyncPanel() {
  const queryClient = useQueryClient();
  const { data: sources, isLoading } = useQuery({
    queryKey: ['admin', 'sources'],
    queryFn: getCategories,
  });

  // Drag-and-drop state
  const [orderedSources, setOrderedSources] = useState<ExperienceCategory[]>([]);
  const dragItemRef = useRef<number | null>(null);
  const dragOverItemRef = useRef<number | null>(null);

  // Sync ordered list when sources load
  useEffect(() => {
    if (sources) {
      setOrderedSources([...sources]);
    }
  }, [sources]);

  const reorderMutation = useMutation({
    mutationFn: (sourceIds: number[]) => reorderCategories(sourceIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
    },
  });

  const handleDragStart = (index: number) => {
    dragItemRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverItemRef.current = index;
  };

  const handleDrop = () => {
    if (dragItemRef.current === null || dragOverItemRef.current === null) return;
    if (dragItemRef.current === dragOverItemRef.current) return;

    const newOrder = [...orderedSources];
    const [draggedItem] = newOrder.splice(dragItemRef.current, 1);
    newOrder.splice(dragOverItemRef.current, 0, draggedItem);

    setOrderedSources(newOrder);
    reorderMutation.mutate(newOrder.map(s => s.id));

    dragItemRef.current = null;
    dragOverItemRef.current = null;
  };

  if (isLoading) {
    return <LoadingSpinner padding={4} />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Sync Experiences
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Drag to reorder how sources appear in the experience list.
      </Typography>

      <Box sx={{ display: 'grid', gap: 3 }}>
        {orderedSources.map((source, index) => (
          <Box
            key={source.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
          >
            <SourceCard source={source} />
          </Box>
        ))}
      </Box>

    </Box>
  );
}

interface SourceCardProps {
  source: ExperienceCategory;
}

/** What the Cancel button should say for the phase the run is in. */
function cancelLabel(status: SyncStatus | null): string {
  if (status?.status === 'assigning') return 'Assigning regions…';
  // Refused but still running: the item loop is over and the run is closing up.
  if (status?.cancellable === false) return 'Finishing…';
  return 'Cancel';
}

function SourceCard({ source }: SourceCardProps) {
  const queryClient = useQueryClient();
  const [isPolling, setIsPolling] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  // What the server said about the last Cancel, when it said no. A press the
  // server refuses — the run is already over, or the backend was restarted under
  // it — otherwise produces nothing at all on screen, which reads as a button
  // that does not work rather than as an answer.
  const [cancelRefused, setCancelRefused] = useState(false);

  /** A new run is starting: poll it, and drop what the last one was told. */
  const beginRun = () => {
    setIsPolling(true);
    setCancelRefused(false);
  };

  // Start sync mutation
  const startMutation = useMutation({
    mutationFn: () => startSync(source.id),
    onSuccess: beginRun,
  });

  // Preview mutation: same run, no writes to experiences
  const dryRunMutation = useMutation({
    mutationFn: () => startSync(source.id, { dryRun: true }),
    onSuccess: beginRun,
  });

  // The same run again, asking the source everything rather than reusing what it
  // already told us. Its own button rather than a checkbox beside Start: it is a
  // different decision with a different cost — the collection runs at full
  // length — and the ordinary click should stay one click.
  const refreshMutation = useMutation({
    mutationFn: () => startSync(source.id, { refreshCache: true }),
    onSuccess: beginRun,
  });

  // A preview is a run: while one is starting the panel must look busy, or the
  // gap between the click and the first poll reads as nothing having happened.
  const isStarting = startMutation.isPending || dryRunMutation.isPending
    || refreshMutation.isPending;

  // Track if sync just completed (to show hint)
  const [justCompleted, setJustCompleted] = useState(false);

  // Ref to track previous running state (avoids dependency cycle in pollStatus)
  const wasRunningRef = useRef(false);

  // Poll for status — no dependency on status to avoid double-fire on mount
  const pollStatus = useCallback(async () => {
    try {
      const newStatus = await getSyncStatus(source.id);
      setStatus(newStatus);

      if (!newStatus.running) {
        setIsPolling(false);
        // Only a real sync earns the hint: a dry run creates no experiences, so
        // telling the admin to go and assign them would be nonsense.
        if (wasRunningRef.current && newStatus.status === 'complete' && !newStatus.dryRun) {
          setJustCompleted(true);
        }
        // Refresh sources list to get updated last_sync info
        queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'syncLogs'] });
      }
      wasRunningRef.current = !!newStatus.running;
    } catch (error) {
      console.error('Error polling status:', error);
      setIsPolling(false);
    }
  }, [source.id, queryClient]);

  const cancelMutation = useMutation({
    mutationFn: () => cancelSync(source.id),
    onSuccess: (result) => {
      // Taken: the status will say so at the next poll. Refused: say so, and
      // poll at once, so the card stops showing a run that is no longer there.
      setCancelRefused(!result.cancelled);
      if (!result.cancelled) void pollStatus();
    },
  });

  // Check initial status on mount
  useEffect(() => {
    pollStatus();
  }, [pollStatus]);

  // Polling interval
  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(pollStatus, 1000);
    return () => clearInterval(interval);
  }, [isPolling, pollStatus]);

  // `isPolling` as well as the two above. Between `startSync` resolving and the
  // first poll answering, `isStarting` is already false and `status.running` is
  // still the previous run's — so the start controls came back for a moment, and
  // a second click in that gap is answered 409 by a server that has just started
  // the run the panel is not yet showing.
  const isRunning = status?.running || isStarting || isPolling;
  const progress = status?.percent || 0;
  // Nothing knows how many museums there are until the source answers, so the
  // whole collection phase reports zero — and a bar parked at zero is read as a
  // hung run, which is what run 61 looked like while it was waiting out
  // Wikidata's gateway errors. An indeterminate bar says the true thing: this is
  // moving, and how much is left is not knowable yet.
  const measurable = progress > 0;

  const getStatusChip = () => {
    if (isRunning) {
      return (
        <Chip
          icon={<SyncIcon />}
          label={status?.dryRun ? 'Previewing...' : 'Syncing...'}
          color="primary"
          size="small"
        />
      );
    }
    if (source.last_sync_status === 'success') {
      return <Chip icon={<CheckIcon />} label="Success" color="success" size="small" />;
    }
    if (source.last_sync_status === 'partial') {
      return <Chip icon={<ErrorIcon />} label="Partial" color="warning" size="small" />;
    }
    if (source.last_sync_status === 'failed') {
      return <Chip icon={<ErrorIcon />} label="Failed" color="error" size="small" />;
    }
    if (source.last_sync_at) {
      return <Chip icon={<ScheduleIcon />} label="Completed" color="default" size="small" />;
    }
    return <Chip label="Never synced" color="default" size="small" />;
  };


  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <DragIcon sx={{ color: 'text.disabled', cursor: 'grab', mt: 0.5 }} />
            <Box>
              <Typography variant="h6">{source.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {source.description}
              </Typography>
            </Box>
          </Box>
          {getStatusChip()}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Last synced: {formatDateTime(source.last_sync_at)}
        </Typography>

        {isRunning && status && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2">{status.statusMessage}</Typography>
              <Typography variant="body2">{measurable ? `${progress}%` : 'Collecting…'}</Typography>
            </Box>
            <LinearProgress
              variant={measurable ? 'determinate' : 'indeterminate'}
              value={measurable ? progress : undefined}
            />
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

        {startMutation.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to start sync: {(startMutation.error as Error)?.message}
          </Alert>
        )}
        {dryRunMutation.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to start dry run: {(dryRunMutation.error as Error)?.message}
          </Alert>
        )}
        {/* The third button's failure was the only silent one: it sets
            `isStarting`, so the card looks busy for a moment and then simply
            does not start, with nothing on screen saying why. */}
        {refreshMutation.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to start sync without cache: {(refreshMutation.error as Error)?.message}
          </Alert>
        )}
        {cancelRefused && (
          <Alert severity="info" sx={{ mb: 2 }} onClose={() => setCancelRefused(false)}>
            {/* The two ways a press lands on nothing, told apart by what the
                poll that followed it found. Either way the honest answer is
                that this run is over, not that the button failed. */}
            {isRunning
              ? 'This run is past the point a cancel can stop it — it is finishing what it started.'
              : 'There was nothing to cancel: this run had already ended.'}
          </Alert>
        )}

        {justCompleted && (
          <Alert
            severity="success"
            sx={{ mb: 2 }}
            onClose={() => setJustCompleted(false)}
          >
            {/* Says nothing about how region assignment turned out. The run
                only reports itself finished once placement has run, so by the
                time this shows, the source's status chip already carries the
                verdict — and a placement failure shows there as Partial. */}
            Sync completed. Region assignment runs as part of the run, so there is normally
            nothing further to do — check the status chip if it reports Partial.
          </Alert>
        )}
        <CurationGateControls source={source} />

        {/* Inside the source's own card, closed: what a run remembers is a
            property of that source, and it is a thing to open when a run
            surprises you rather than something to read on every visit. */}
        <WikidataCacheSection categoryId={source.id} />
      </CardContent>

      <CardActions sx={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {!isRunning ? (
            <>
              <Button
                startIcon={<SyncIcon />}
                onClick={() => startMutation.mutate()}
                // `isStarting`, not this button's own mutation: while a preview
                // or a no-cache run is being started, an ordinary Start would be
                // a second run launched before the first has said it exists.
                disabled={!source.is_active || isStarting}
                variant="outlined"
                color="primary"
              >
                Start Sync
              </Button>
              <Button
                variant="outlined"
                onClick={() => dryRunMutation.mutate()}
                disabled={!source.is_active || isStarting}
              >
                Dry run
              </Button>
              {/* Only where there is a cache to ignore. Two of the three
                  sources keep nothing between runs, and offering to bypass
                  their cache would be the same pretence the panel below
                  refuses when it says "This source caches nothing". */}
              {source.caches && (
              <>
              {/* "Leaves it untouched", not "replaces it": a run with the cache
                  off neither reads nor writes it, so what is kept survives with
                  its original age and the next ordinary run uses it again. The
                  button that actually replaces an answer is Clear, in the cache
                  panel below — which is what its own text says. */}
              <Tooltip title="An ordinary sync that ignores what we kept from the source and asks it everything again. Leaves the cache untouched — nothing is deleted and nothing is replaced, so the next ordinary sync uses the kept answers again. To replace them, clear them below. Takes the full collection time, about a quarter of an hour for museums.">
                <span>
                  <Button
                    variant="outlined"
                    onClick={() => refreshMutation.mutate()}
                    disabled={!source.is_active || isStarting}
                  >
                    Sync without cache
                  </Button>
                </span>
              </Tooltip>
              </>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                A sync preserves curator edits, visit history, manual region assignments and
                rejections. A point the source stops offering is marked, not deleted.
              </Typography>
            </>
          ) : (
            <Button
              startIcon={<StopIcon />}
              onClick={() => cancelMutation.mutate()}
              // Disabled through the assigning phase: the server refuses a
              // cancel there, because placement is already past the point the
              // flag is read. Left enabled, the press would be a silent no-op —
              // the run finishes as it was always going to.
              // The server's own answer, not a copy of its rule: past the last
              // item a press is refused and `onSuccess` would discard the
              // refusal under "status will update via polling", which is
              // exactly what does not happen for a cancel that never took.
              disabled={cancelMutation.isPending || status?.cancellable === false}
              color="warning"
            >
              {cancelLabel(status)}
            </Button>
          )}
        </Box>
      </CardActions>
    </Card>
  );
}

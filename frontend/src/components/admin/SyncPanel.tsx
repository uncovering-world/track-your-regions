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

  // Start sync mutation
  const startMutation = useMutation({
    mutationFn: () => startSync(source.id),
    onSuccess: () => setIsPolling(true),
  });

  // Preview mutation: same run, no writes to experiences
  const dryRunMutation = useMutation({
    mutationFn: () => startSync(source.id, { dryRun: true }),
    onSuccess: () => setIsPolling(true),
  });

  // A preview is a run: while one is starting the panel must look busy, or the
  // gap between the click and the first poll reads as nothing having happened.
  const isStarting = startMutation.isPending || dryRunMutation.isPending;

  // Cancel sync mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelSync(source.id),
    onSuccess: () => {
      // Status will update via polling
    },
  });

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

  const isRunning = status?.running || isStarting;
  const progress = status?.percent || 0;

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
              <Typography variant="body2">{progress}%</Typography>
            </Box>
            <LinearProgress variant="determinate" value={progress} />
            {status.currentItem && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {status.currentItem}
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <Typography variant="caption">Created: {status.created || 0}</Typography>
              <Typography variant="caption">Updated: {status.updated || 0}</Typography>
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
      </CardContent>

      <CardActions sx={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {!isRunning ? (
            <>
              <Button
                startIcon={<SyncIcon />}
                onClick={() => startMutation.mutate()}
                disabled={!source.is_active || startMutation.isPending}
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

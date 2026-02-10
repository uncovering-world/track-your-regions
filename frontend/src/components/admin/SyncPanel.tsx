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
  CircularProgress,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  Sync as SyncIcon,
  Stop as StopIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
  DragIndicator as DragIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSources,
  startSync,
  getSyncStatus,
  cancelSync,
  reorderSources,
  type ExperienceSource,
  type SyncStatus,
} from '../../api/admin';

export function SyncPanel() {
  const queryClient = useQueryClient();
  const { data: sources, isLoading } = useQuery({
    queryKey: ['admin', 'sources'],
    queryFn: getSources,
  });

  // Drag-and-drop state
  const [orderedSources, setOrderedSources] = useState<ExperienceSource[]>([]);
  const dragItemRef = useRef<number | null>(null);
  const dragOverItemRef = useRef<number | null>(null);

  // Sync ordered list when sources load
  useEffect(() => {
    if (sources) {
      setOrderedSources([...sources]);
    }
  }, [sources]);

  const reorderMutation = useMutation({
    mutationFn: (sourceIds: number[]) => reorderSources(sourceIds),
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
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Check if any source needs region assignment
  const needsAssignment = orderedSources.some(s => s.assignment_needed);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Sync Experiences
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Drag to reorder how sources appear in the experience list.
      </Typography>

      {needsAssignment && (
        <Alert
          severity="warning"
          icon={<WarningIcon />}
          sx={{ mb: 3 }}
          action={
            <Button
              color="warning"
              size="small"
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('navigate-admin', { detail: 'assignment' }));
              }}
            >
              Run Assignment
            </Button>
          }
        >
          <strong>Region assignment needed.</strong> New experiences were synced since the last region assignment.
          Run region assignment to properly assign experiences to regions.
        </Alert>
      )}

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
  source: ExperienceSource;
}

function SourceCard({ source }: SourceCardProps) {
  const queryClient = useQueryClient();
  const [isPolling, setIsPolling] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [forceSync, setForceSync] = useState(false);

  // Start sync mutation
  const startMutation = useMutation({
    mutationFn: () => startSync(source.id, forceSync),
    onSuccess: () => {
      setIsPolling(true);
      setForceSync(false); // Reset force checkbox after starting
    },
  });

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
        // If sync just completed successfully, show hint
        if (wasRunningRef.current && newStatus.status === 'complete') {
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

  const isRunning = status?.running || startMutation.isPending;
  const progress = status?.percent || 0;

  const getStatusChip = () => {
    if (isRunning) {
      return <Chip icon={<SyncIcon />} label="Syncing..." color="primary" size="small" />;
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
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
          Last synced: {formatDate(source.last_sync_at)}
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

        {justCompleted && (
          <Alert
            severity="success"
            sx={{ mb: 2 }}
            onClose={() => setJustCompleted(false)}
          >
            Sync completed! <strong>Remember to run Region Assignment</strong> to assign new experiences to regions.
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
                variant={forceSync ? 'contained' : 'outlined'}
                color={forceSync ? 'error' : 'primary'}
              >
                {forceSync ? 'Force Sync' : 'Start Sync'}
              </Button>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={forceSync}
                    onChange={(e) => setForceSync(e.target.checked)}
                    size="small"
                    color="error"
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary">
                    Force (delete all data first)
                  </Typography>
                }
              />
              {!forceSync && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  Normal sync preserves: curator edits, visit history, manual region assignments, and rejections
                </Typography>
              )}
            </>
          ) : (
            <Button
              startIcon={<StopIcon />}
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              color="warning"
            >
              Cancel
            </Button>
          )}
        </Box>
        {forceSync && !isRunning && (
          <Alert severity="warning" sx={{ py: 0, width: '100%' }}>
            Force sync will delete all existing experiences, visited records, and region assignments for this source.
          </Alert>
        )}
      </CardActions>
    </Card>
  );
}

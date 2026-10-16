/**
 * Computing a world view's region geometries from the admin's import screens: the
 * existing background job (`POST /world-views/:id/compute-geometries`), its status
 * polled while it runs, and one alert that says how far it got, how many regions
 * failed, and why it could not start.
 *
 * Out of the match review, which offers it beside Close Review, so another
 * import screen can offer the same job and say the same thing about it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material';
import {
  cancelWorldViewGeometryComputation,
  fetchWorldViewComputationStatus,
  startWorldViewGeometryComputation,
  type ComputationStatus,
} from '../../api/geometry';

// What the alert shows is the computation's status as the server answers it, with
// the counts it draws made definite; `computed` is the status's `progress`, the
// regions processed so far.
type GeomStatus = Required<Pick<ComputationStatus, 'percent' | 'total' | 'errors'>>
  & Pick<ComputationStatus, 'currentRegion' | 'status'>
  & { computed: number };

export interface WorldViewGeometryCompute {
  computing: boolean;
  status: GeomStatus | null;
  /** Why the job could not be started, in the server's words. */
  startError: string | null;
  start: () => void;
  cancel: () => void;
}

export function useWorldViewGeometryCompute(worldViewId: number | null): WorldViewGeometryCompute {
  const [computing, setComputing] = useState(false);
  const [status, setStatus] = useState<GeomStatus | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback((id: number) => {
    stopPolling();
    setComputing(true);
    pollRef.current = setInterval(async () => {
      try {
        const s = await fetchWorldViewComputationStatus(id);
        setStatus({
          percent: s.percent ?? 0,
          computed: s.progress ?? 0,
          total: s.total ?? 0,
          errors: s.errors ?? 0,
          currentRegion: s.currentRegion,
          status: s.status,
        });
        if (!s.running) {
          stopPolling();
          setComputing(false);
        }
      } catch {
        stopPolling();
        setComputing(false);
      }
    }, 1500);
  }, [stopPolling]);

  const start = useCallback(async () => {
    if (worldViewId === null) return;
    setStartError(null);
    try {
      const result = await startWorldViewGeometryComputation(worldViewId, false, true);
      if (result.started) {
        setStatus({ percent: 0, computed: 0, total: result.total ?? 0, errors: 0, status: 'Starting...' });
        startPolling(worldViewId);
      } else {
        setStatus({ percent: 100, computed: result.alreadyComputed ?? 0, total: result.total ?? 0, errors: 0, status: result.message });
      }
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Geometry computation could not be started');
    }
  }, [worldViewId, startPolling]);

  const cancel = useCallback(async () => {
    if (worldViewId === null) return;
    try {
      await cancelWorldViewGeometryComputation(worldViewId);
    } catch { /* poll will detect stopped state */ }
  }, [worldViewId]);

  return {
    computing,
    status,
    startError,
    start: () => { void start(); },
    cancel: () => { void cancel(); },
  };
}

/** How far the computation got and what failed, or why it did not start; nothing before it is asked for. */
export function GeomComputationAlert({ compute }: { compute: WorldViewGeometryCompute }) {
  const { computing, status, startError, cancel } = compute;
  if (startError) return <Alert severity="error" sx={{ mb: 2 }}>{startError}</Alert>;
  if (!status) return null;

  let severity: 'info' | 'warning' | 'success';
  if (computing) severity = 'info';
  else if (status.errors > 0) severity = 'warning';
  else severity = 'success';

  const currentRegionSuffix = status.currentRegion ? ` — ${status.currentRegion}` : '';
  const errorsSuffix = status.errors > 0 ? `, ${status.errors} errors` : '';
  const statusLabel = status.status ?? 'Complete';
  const progressText = computing
    ? `Computing geometries... ${status.computed}/${status.total}${currentRegionSuffix}`
    : `${statusLabel} — ${status.computed} computed${errorsSuffix}`;

  return (
    <Alert
      severity={severity}
      sx={{ mb: 2 }}
      action={computing ? (
        <Button color="inherit" size="small" onClick={cancel}>Cancel</Button>
      ) : undefined}
    >
      <Box sx={{ width: '100%' }}>
        <Typography variant="body2">{progressText}</Typography>
        {computing && (
          <LinearProgress variant="determinate" value={status.percent} sx={{ mt: 0.5 }} />
        )}
      </Box>
    </Alert>
  );
}


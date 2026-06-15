/**
 * Import workflow dashboard (Plan 2/4 of the import-review redesign).
 * Route: /admin/import/:worldViewId
 * Tabs: Countries (sign-off progress) · Skeleton · Global gaps.
 * Assignment editing stays in the legacy Match Review until Plan 4.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Container, Dialog, DialogActions, DialogContent,
  DialogTitle, LinearProgress, Paper, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { getWorkflowDashboard } from '../../../api/admin/wvImportWorkflow';
import { finalizeReview } from '../../../api/admin/wvImportCoverage';
import { startRematch, getRematchStatus } from '../../../api/admin/worldViewImport';
import {
  startWorldViewGeometryComputation,
  fetchWorldViewComputationStatus,
  cancelWorldViewGeometryComputation,
} from '../../../api/geometry';
import { CountriesTab } from './CountriesTab';
import { SkeletonTab } from './SkeletonTab';
import { GlobalGapsTab } from './GlobalGapsTab';

// ── Local geometry-progress alert ────────────────────────────────────────────

interface GeomStatus {
  percent: number;
  computed: number;
  total: number;
  errors: number;
  currentRegion?: string;
  status?: string;
}

function GeomComputationAlert({
  geomStatus, geomComputing, onCancel,
}: {
  geomStatus: GeomStatus;
  geomComputing: boolean;
  onCancel: () => void;
}) {
  let severity: 'info' | 'warning' | 'success';
  if (geomComputing) severity = 'info';
  else if (geomStatus.errors > 0) severity = 'warning';
  else severity = 'success';

  const currentRegionSuffix = geomStatus.currentRegion ? ` — ${geomStatus.currentRegion}` : '';
  const errorsSuffix = geomStatus.errors > 0 ? `, ${geomStatus.errors} errors` : '';
  const statusLabel = geomStatus.status ?? 'Complete';
  const progressText = geomComputing
    ? `Computing geometries... ${geomStatus.computed}/${geomStatus.total}${currentRegionSuffix}`
    : `${statusLabel} — ${geomStatus.computed} computed${errorsSuffix}`;

  return (
    <Alert
      severity={severity}
      sx={{ mb: 2 }}
      action={geomComputing ? (
        <Button color="inherit" size="small" onClick={onCancel}>Cancel</Button>
      ) : undefined}
    >
      <Box sx={{ width: '100%' }}>
        <Typography variant="body2">{progressText}</Typography>
        {geomComputing && (
          <LinearProgress variant="determinate" value={geomStatus.percent} sx={{ mt: 0.5 }} />
        )}
      </Box>
    </Alert>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ImportDashboardPage() {
  const { worldViewId: wvParam } = useParams();
  const worldViewId = parseInt(wvParam ?? '');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [tab, setTab] = useState<'countries' | 'skeleton' | 'gaps'>('countries');
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Re-match state
  const [rematchDialogOpen, setRematchDialogOpen] = useState(false);

  // Geometry computation state
  const [geomComputing, setGeomComputing] = useState(false);
  const [geomStatus, setGeomStatus] = useState<GeomStatus | null>(null);
  const geomPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId],
    queryFn: () => getWorkflowDashboard(worldViewId),
    enabled: Number.isInteger(worldViewId),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeReview(worldViewId),
    onSuccess: () => {
      setFinalizeError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport'] }).catch(() => {});
    },
    onError: (err: unknown) => {
      setFinalizeError(err instanceof Error ? err.message : 'Finalize failed');
    },
  });

  // ── Re-match All ───────────────────────────────────────────────────────────

  const rematchMutation = useMutation({
    mutationFn: () => startRematch(worldViewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'rematchStatus'] }).catch(() => {});
    },
  });

  const { data: rematchStatus } = useQuery({
    queryKey: ['admin', 'wvImport', 'rematchStatus', worldViewId],
    queryFn: () => getRematchStatus(worldViewId),
    refetchInterval: (query) => {
      const st = query.state.data;
      if (st?.status === 'matching') return 1000;
      if (st?.status === 'complete') {
        // Invalidate dashboard + tree + coverage but NOT rematchStatus itself —
        // otherwise the invalidation triggers a refetch, which sees 'complete'
        // again, calls these invalidations again → infinite loop that freezes
        // the page.
        queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'coverage', worldViewId] }).catch(() => {});
      }
      return false;
    },
  });

  const rematchRunning = rematchStatus?.status === 'matching';

  // ── Geometry computation ───────────────────────────────────────────────────

  const stopGeomPolling = useCallback(() => {
    if (geomPollRef.current) { clearInterval(geomPollRef.current); geomPollRef.current = null; }
  }, []);

  // Cleanup interval on unmount
  useEffect(() => stopGeomPolling, [stopGeomPolling]);

  const startGeomPolling = useCallback(() => {
    stopGeomPolling();
    setGeomComputing(true);
    geomPollRef.current = setInterval(async () => {
      try {
        const s = await fetchWorldViewComputationStatus(worldViewId);
        setGeomStatus({
          percent: s.percent ?? 0,
          computed: s.progress ?? 0,
          total: s.total ?? 0,
          errors: s.errors ?? 0,
          currentRegion: s.currentRegion,
          status: s.status,
        });
        if (!s.running) {
          stopGeomPolling();
          setGeomComputing(false);
        }
      } catch {
        stopGeomPolling();
        setGeomComputing(false);
      }
    }, 1500);
  }, [worldViewId, stopGeomPolling]);

  const handleComputeGeometries = useCallback(async () => {
    try {
      const result = await startWorldViewGeometryComputation(worldViewId, false, true);
      if (result.started) {
        setGeomStatus({ percent: 0, computed: 0, total: result.total ?? 0, errors: 0, status: 'Starting...' });
        startGeomPolling();
      } else {
        setGeomStatus({ percent: 100, computed: result.alreadyComputed ?? 0, total: result.total ?? 0, errors: 0, status: result.message });
      }
    } catch (err) {
      console.error('Failed to start geometry computation:', err);
    }
  }, [worldViewId, startGeomPolling]);

  const handleCancelGeomComputation = useCallback(async () => {
    try {
      await cancelWorldViewGeometryComputation(worldViewId);
    } catch { /* poll will detect stopped state */ }
  }, [worldViewId]);

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />;
  if (!Number.isInteger(worldViewId)) return <Navigate to="/admin" replace />;

  const units = data?.units ?? [];
  const signedOff = units.filter(u => u.signoffStatus === 'signed_off').length;
  const allSignedOff = units.length > 0 && signedOff === units.length;
  const finalizeBlocked = !data?.skeletonConfirmed || !allSignedOff;
  const finalizeTooltip = finalizeBlocked
    ? [
        !data?.skeletonConfirmed ? 'skeleton not confirmed' : null,
        !allSignedOff ? `${units.length - signedOff} units not signed off` : null,
      ].filter(Boolean).join(', ')
    : '';

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {/* Main header row */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/admin?section=wvImport')}>
          Admin
        </Button>
        <Typography variant="h4" sx={{ flex: 1 }}>Import Dashboard</Typography>
        <Button
          variant="outlined"
          onClick={handleComputeGeometries}
          disabled={geomComputing || rematchRunning}
        >
          {geomComputing ? 'Computing...' : 'Compute Geometries'}
        </Button>
        <Button
          variant="outlined"
          onClick={() => navigate(`/admin?section=wvImport&wvReview=${worldViewId}`)}
        >
          Legacy match tree
        </Button>
        <Tooltip title={finalizeTooltip}>
          <Box component="span">
            <Button
              variant="outlined"
              color="success"
              disabled={finalizeBlocked || finalizeMutation.isPending}
              onClick={() => finalizeMutation.mutate()}
            >
              Finalize
            </Button>
          </Box>
        </Tooltip>
      </Stack>

      {units.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <LinearProgress
            variant="determinate"
            value={(signedOff / units.length) * 100}
            sx={{ flex: 1, height: 8, borderRadius: 1 }}
          />
          <Chip label={`${signedOff}/${units.length} signed off`} size="small" />
          <Chip
            label={data?.skeletonConfirmed ? 'Skeleton ✓' : 'Skeleton unconfirmed'}
            color={data?.skeletonConfirmed ? 'success' : 'default'}
            size="small"
          />
        </Stack>
      )}

      {/* Danger zone — destructive world-view-level operations */}
      <Paper
        variant="outlined"
        sx={{ p: 1.5, mb: 2, borderColor: 'warning.main', bgcolor: 'warning.50' }}
      >
        <Stack direction="row" alignItems="center" spacing={2}>
          <Typography variant="caption" color="warning.dark" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Danger zone
          </Typography>
          <Button
            variant="outlined"
            color="warning"
            size="small"
            onClick={() => setRematchDialogOpen(true)}
            disabled={rematchRunning || rematchMutation.isPending}
          >
            {rematchRunning ? 'Re-matching...' : 'Re-match All'}
          </Button>
        </Stack>
      </Paper>

      {finalizeError && (
        <Alert severity="error" onClose={() => setFinalizeError(null)} sx={{ mb: 2 }}>
          {finalizeError}
        </Alert>
      )}

      {/* Geometry computation progress */}
      {geomStatus && (
        <GeomComputationAlert
          geomStatus={geomStatus}
          geomComputing={geomComputing}
          onCancel={handleCancelGeomComputation}
        />
      )}

      {/* Re-match progress */}
      {rematchRunning && rematchStatus && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {rematchStatus.statusMessage}
        </Alert>
      )}
      {rematchStatus?.status === 'complete' && rematchStatus.statusMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {rematchStatus.statusMessage}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v: 'countries' | 'skeleton' | 'gaps') => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="countries" label={`Countries (${units.length})`} />
        <Tab value="skeleton" label="Skeleton" />
        <Tab value="gaps" label="Global gaps" />
      </Tabs>

      {isLoading && <LinearProgress />}
      {tab === 'countries' && <CountriesTab worldViewId={worldViewId} units={units} />}
      {tab === 'skeleton' && (
        <SkeletonTab worldViewId={worldViewId} skeletonConfirmed={data?.skeletonConfirmed ?? false} units={units} />
      )}
      {tab === 'gaps' && <GlobalGapsTab worldViewId={worldViewId} />}

      {/* Re-match confirmation dialog */}
      <Dialog
        open={rematchDialogOpen}
        onClose={() => setRematchDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Re-match All Regions?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will clear all match assignments and suggestions, then re-run
            automatic matching from scratch. Manual matches and rejections will
            be lost.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRematchDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              setRematchDialogOpen(false);
              rematchMutation.mutate();
            }}
          >
            Re-match All
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

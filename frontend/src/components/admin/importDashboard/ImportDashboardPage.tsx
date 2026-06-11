/**
 * Import workflow dashboard (Plan 2/4 of the import-review redesign).
 * Route: /admin/import/:worldViewId
 * Tabs: Countries (sign-off progress) · Skeleton · Global gaps.
 * Assignment editing stays in the legacy Match Review until Plan 4.
 */
import { useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Container, LinearProgress, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { getWorkflowDashboard } from '../../../api/admin/wvImportWorkflow';
import { finalizeReview } from '../../../api/admin/wvImportCoverage';
import { CountriesTab } from './CountriesTab';
import { SkeletonTab } from './SkeletonTab';
import { GlobalGapsTab } from './GlobalGapsTab';

export function ImportDashboardPage() {
  const { worldViewId: wvParam } = useParams();
  const worldViewId = parseInt(wvParam ?? '');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [tab, setTab] = useState<'countries' | 'skeleton' | 'gaps'>('countries');
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

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
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/admin?section=wvImport')}>
          Admin
        </Button>
        <Typography variant="h4" sx={{ flex: 1 }}>Import Dashboard</Typography>
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

      {finalizeError && (
        <Alert severity="error" onClose={() => setFinalizeError(null)} sx={{ mb: 2 }}>
          {finalizeError}
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
    </Container>
  );
}

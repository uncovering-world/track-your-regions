/**
 * WorldView Import Review
 *
 * Interface for reviewing and accepting/rejecting GADM division matches
 * for imported regions. Uses the hierarchical tree view.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { fetchDivisionGeometry } from '../../api/divisions';
import {
  startWorldViewGeometryComputation,
  fetchWorldViewComputationStatus,
  cancelWorldViewGeometryComputation,
} from '../../api/geometry';
import { DivisionPreviewDialog } from '../WorldViewEditor/components/dialogs/DivisionPreviewDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMatchStats,
  getCoverageWithProgress,
  approveCoverageSuggestion,
  finalizeReview,
  startRematch,
  getRematchStatus,
  acceptMatch,
  acceptBatchMatches,
  rejectSuggestion,
  rejectRemaining,
  getUnionGeometry,
  splitDivisionsDeeper,
  visionMatchDivisions,
} from '../../api/adminWorldViewImport';
import type { CoverageResult } from '../../api/adminWorldViewImport';

import { WorldViewImportTree } from './WorldViewImportTree';
import { CoverageResolveDialog } from './CoverageResolveDialog';
import { type ShadowInsertion } from './treeNodeShared';

export type { ShadowInsertion };

interface WorldViewImportReviewProps {
  worldViewId: number;
  onFinalize?: () => void;
}

export function WorldViewImportReview({ worldViewId, onFinalize }: WorldViewImportReviewProps) {
  const queryClient = useQueryClient();
  const [rematchDialogOpen, setRematchDialogOpen] = useState(false);
  const [previewDivision, setPreviewDivision] = useState<{
    name: string; path?: string; regionMapUrl?: string; wikidataId?: string;
    divisionId?: number; regionId?: number; isAssigned?: boolean; regionMapLabel?: string; regionName?: string;
    divisionIds?: number[];
  } | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | GeoJSON.FeatureCollection | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handlePreviewDivision = useCallback(async (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean, regionMapLabel?: string, regionName?: string) => {
    setPreviewDivision({ name, path, regionMapUrl, wikidataId, divisionId, regionId, isAssigned, regionMapLabel, regionName });
    setPreviewGeometry(null);
    setPreviewLoading(true);
    try {
      const feature = await fetchDivisionGeometry(divisionId, 1, { detail: 'medium' });
      setPreviewGeometry((feature?.geometry as GeoJSON.Geometry) ?? null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewDivision(null);
    setPreviewGeometry(null);
  }, []);

  const handlePreviewUnion = useCallback(async (regionId: number, divisionIds: number[], context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string }) => {
    setPreviewDivision({
      name: `${divisionIds.length} divisions (union)`,
      regionId,
      isAssigned: false,
      divisionIds,
      wikidataId: context.wikidataId,
      regionMapUrl: context.regionMapUrl,
      regionMapLabel: context.regionMapLabel,
      regionName: context.regionName,
    });
    setPreviewGeometry(null);
    setPreviewLoading(true);
    try {
      const result = await getUnionGeometry(worldViewId, divisionIds, regionId);
      setPreviewGeometry(result.geometry);
    } finally {
      setPreviewLoading(false);
    }
  }, [worldViewId]);

  const handleViewMap = useCallback(async (regionId: number, context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string; divisionIds: number[] }) => {
    const hasDivisions = context.divisionIds.length > 0;
    setPreviewDivision({
      name: hasDivisions ? `${context.regionName} — ${context.divisionIds.length} division${context.divisionIds.length > 1 ? 's' : ''}` : context.regionName,
      wikidataId: context.wikidataId,
      regionMapUrl: context.regionMapUrl,
      regionMapLabel: context.regionMapLabel,
      regionName: context.regionName,
      regionId,
    });
    setPreviewGeometry(null);
    if (hasDivisions) {
      setPreviewLoading(true);
      try {
        const result = await getUnionGeometry(worldViewId, context.divisionIds);
        setPreviewGeometry(result.geometry);
      } finally {
        setPreviewLoading(false);
      }
    }
  }, [worldViewId]);

  const handleSplitDeeper = useCallback(async () => {
    if (!previewDivision?.divisionIds?.length || !previewDivision.wikidataId || !previewDivision.regionId) return;
    setPreviewLoading(true);
    try {
      const result = await splitDivisionsDeeper(worldViewId, previewDivision.divisionIds, previewDivision.wikidataId, previewDivision.regionId);
      const newIds = result.divisions.map(d => d.divisionId);
      setPreviewDivision(prev => prev ? {
        ...prev,
        name: `${newIds.length} divisions (refined)`,
        divisionIds: newIds,
      } : prev);
      setPreviewGeometry(result.geometry);
    } finally {
      setPreviewLoading(false);
    }
  }, [worldViewId, previewDivision?.divisionIds, previewDivision?.wikidataId, previewDivision?.regionId]);

  const handleVisionMatch = useCallback(async (): Promise<{ ids: number[]; rejectedIds?: number[]; unclearIds?: number[]; reasoning?: string; debugImages?: { regionMap: string; divisionsMap: string } }> => {
    if (!previewDivision?.divisionIds?.length || !previewDivision.regionId || !previewDivision.regionMapUrl) return { ids: [] };
    const result = await visionMatchDivisions(worldViewId, previewDivision.divisionIds, previewDivision.regionId, previewDivision.regionMapUrl);
    return { ids: result.suggestedIds, rejectedIds: result.rejectedIds, unclearIds: result.unclearIds, reasoning: result.reasoning, debugImages: result.debugImages };
  }, [worldViewId, previewDivision?.divisionIds, previewDivision?.regionId, previewDivision?.regionMapUrl]);

  const [shadowInsertions, setShadowInsertions] = useState<ShadowInsertion[]>([]);

  // Coverage check (SSE streaming, cached in React Query)
  const [coverageDialogOpen, setCoverageDialogOpen] = useState(false);
  const [coverageStale, setCoverageStale] = useState(false);
  const [coverageProgress, setCoverageProgress] = useState<{
    running: boolean;
    step?: string;
    elapsed?: number;
  }>({ running: false });

  // Coverage data persists in React Query cache across dialog open/close and match operations
  const { data: coverageDataRaw } = useQuery({
    queryKey: ['admin', 'wvImport', 'coverage', worldViewId],
    queryFn: () => null as CoverageResult | null,
    enabled: false,
    gcTime: Infinity,
    staleTime: Infinity,
  });
  const coverageData = coverageDataRaw ?? null;

  const runCoverageCheck = useCallback(() => {
    setCoverageProgress({ running: true });
    setCoverageStale(false);
    getCoverageWithProgress(worldViewId, (event) => {
      if (event.type === 'progress') {
        setCoverageProgress({ running: true, step: event.step, elapsed: event.elapsed });
      }
    }).then((result) => {
      queryClient.setQueryData(['admin', 'wvImport', 'coverage', worldViewId], result);
      setCoverageProgress({ running: false });
    }).catch((err) => {
      console.error('Coverage check failed:', err);
      setCoverageProgress({ running: false });
    });
  }, [worldViewId, queryClient]);

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchStats', worldViewId],
    queryFn: () => getMatchStats(worldViewId),
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'rematchStatus', worldViewId] });
    setCoverageStale(true);
  }, [queryClient, worldViewId]);

  // Preview accept/reject
  const previewAcceptMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptMatch(worldViewId, regionId, divisionId),
    onSuccess: () => {
      invalidateAll();
      handleClosePreview();
    },
  });

  const previewRejectMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      rejectSuggestion(worldViewId, regionId, divisionId),
    onSuccess: () => {
      invalidateAll();
      handleClosePreview();
    },
  });

  const previewAcceptAndRejectRestMutation = useMutation({
    mutationFn: async ({ regionId, divisionId }: { regionId: number; divisionId: number }) => {
      await acceptMatch(worldViewId, regionId, divisionId);
      await rejectRemaining(worldViewId, regionId);
    },
    onSuccess: () => {
      invalidateAll();
      handleClosePreview();
    },
  });

  const previewAcceptSelectedMutation = useMutation({
    mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
      acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d }))),
    onSuccess: () => { invalidateAll(); handleClosePreview(); },
  });

  const previewAcceptSelectedRejectRestMutation = useMutation({
    mutationFn: async ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) => {
      await acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d })));
      await rejectRemaining(worldViewId, regionId);
    },
    onSuccess: () => { invalidateAll(); handleClosePreview(); },
  });

  const previewRejectSelectedMutation = useMutation({
    mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
      Promise.all(divisionIds.map(d => rejectSuggestion(worldViewId, regionId, d))).then(() => {}),
    onSuccess: () => { invalidateAll(); handleClosePreview(); },
  });

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeReview(worldViewId),
    onSuccess: () => {
      invalidateAll();
      onFinalize?.();
    },
  });

  // Re-matching
  const rematchMutation = useMutation({
    mutationFn: () => startRematch(worldViewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'rematchStatus'] });
    },
  });

  const { data: rematchStatus } = useQuery({
    queryKey: ['admin', 'wvImport', 'rematchStatus', worldViewId],
    queryFn: () => getRematchStatus(worldViewId),
    refetchInterval: (query) => {
      const st = query.state.data;
      if (st?.status === 'matching') return 1000;
      if (st?.status === 'complete') {
        // Invalidate tree + stats but NOT rematch status itself — otherwise
        // the invalidation triggers a refetch, which sees 'complete' again,
        // calls invalidateAll again → infinite loop that freezes the page.
        queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
        setCoverageStale(true);
      }
      return false;
    },
  });

  const rematchRunning = rematchStatus?.status === 'matching';

  // ── Geometry computation (polling-based) ──────────────────────────────────
  const [geomComputing, setGeomComputing] = useState(false);
  const [geomStatus, setGeomStatus] = useState<{
    percent: number; computed: number; total: number; errors: number;
    currentRegion?: string; status?: string;
  } | null>(null);
  const geomPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopGeomPolling = useCallback(() => {
    if (geomPollRef.current) { clearInterval(geomPollRef.current); geomPollRef.current = null; }
  }, []);

  // Cleanup on unmount
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

  const matchingDone = stats
    && parseInt(stats.needs_review_blocking) === 0
    && parseInt(stats.no_candidates_blocking) === 0;
  const coveragePassed = coverageData != null && !coverageStale && coverageData.gaps.length === 0;

  const coverageBlockerTooltip = useMemo(() => {
    if (!stats || matchingDone) return '';
    const parts: string[] = [];
    const needsReview = parseInt(stats.needs_review_blocking);
    const noCandidates = parseInt(stats.no_candidates_blocking);
    if (needsReview > 0) parts.push(`${needsReview} need review`);
    if (noCandidates > 0) parts.push(`${noCandidates} have no candidates`);
    return `Resolve first: ${parts.join(', ')}`;
  }, [stats, matchingDone]);

  const handleApplyToTree = useCallback((insertions: ShadowInsertion[]) => {
    setShadowInsertions(prev => {
      // Deduplicate by gapDivisionId — newer insertions take priority
      const existing = new Map(prev.map(s => [s.gapDivisionId, s]));
      for (const ins of insertions) existing.set(ins.gapDivisionId, ins);
      return Array.from(existing.values());
    });
  }, []);

  const approveShadowMutation = useMutation({
    mutationFn: (insertion: ShadowInsertion) =>
      approveCoverageSuggestion(
        worldViewId,
        insertion.gapDivisionId,
        insertion.targetRegionId,
        insertion.action,
        insertion.gapDivisionName,
      ),
    onSuccess: (_data, approvedInsertion) => {
      // Remove ALL shadows with the same gapDivisionId (auto-reject others)
      setShadowInsertions(prev => prev.filter(s => s.gapDivisionId !== approvedInsertion.gapDivisionId));

      // Update coverage data — remove the approved gap (backend auto-dismisses it)
      const currentCoverage = queryClient.getQueryData<CoverageResult>(['admin', 'wvImport', 'coverage', worldViewId]);
      if (currentCoverage) {
        const approvedGap = currentCoverage.gaps.find(g => g.id === approvedInsertion.gapDivisionId);
        queryClient.setQueryData<CoverageResult>(['admin', 'wvImport', 'coverage', worldViewId], {
          ...currentCoverage,
          gaps: currentCoverage.gaps.filter(g => g.id !== approvedInsertion.gapDivisionId),
          dismissedCount: currentCoverage.dismissedCount + (approvedGap ? 1 : 0),
          dismissedGaps: approvedGap
            ? [...currentCoverage.dismissedGaps, { id: approvedGap.id, name: approvedGap.name, parentName: approvedGap.parentName }]
            : currentCoverage.dismissedGaps,
        });
      }

      invalidateAll();
    },
  });

  const handleRejectShadow = useCallback((insertion: ShadowInsertion) => {
    setShadowInsertions(prev => prev.filter(s => s !== insertion));
  }, []);

  const closeReviewTooltip = useMemo(() => {
    if (!stats) return '';
    const blockers: string[] = [];
    if (parseInt(stats.needs_review_blocking) > 0) blockers.push(`${stats.needs_review_blocking} need review`);
    if (parseInt(stats.no_candidates_blocking) > 0) blockers.push(`${stats.no_candidates_blocking} have no candidates`);
    if (blockers.length > 0) return blockers.join(', ');
    if (!coverageData) return 'Run coverage check first';
    if (coverageStale) return 'Coverage may be outdated — re-check';
    if (coverageData.gaps.length > 0) return `${coverageData.gaps.length} active GADM divisions not covered`;
    return '';
  }, [stats, coverageData, coverageStale]);

  const handleCheckCoverage = useCallback(() => {
    setCoverageDialogOpen(true);
    if (!coverageData || coverageStale) {
      runCoverageCheck();
    }
  }, [coverageData, coverageStale, runCoverageCheck]);

  const coverageChecking = coverageProgress.running;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <Typography variant="h4">
          Match Review
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={coverageBlockerTooltip}>
          <span>
            <Button
              variant="outlined"
              onClick={handleCheckCoverage}
              disabled={!matchingDone || coverageChecking}
            >
              {coverageChecking
                ? 'Checking...'
                : coverageData && !coverageStale
                  ? coverageData.gaps.length === 0
                    ? 'Coverage OK'
                    : `Coverage (${coverageData.gaps.length} gaps)`
                  : 'Check Coverage'}
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="outlined"
          onClick={handleComputeGeometries}
          disabled={geomComputing || rematchRunning}
        >
          {geomComputing ? 'Computing...' : 'Compute Geometries'}
        </Button>
        <Tooltip title={closeReviewTooltip}>
          <span>
            <Button
              variant="outlined"
              color="success"
              onClick={() => finalizeMutation.mutate()}
              disabled={finalizeMutation.isPending || !matchingDone || !coveragePassed}
            >
              Close Review
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* Stats bar */}
      {stats && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <Chip label={`${stats.auto_matched} auto-matched`} color="success" />
              <Chip label={`${stats.needs_review_blocking} needs review`} color="warning" />
              <Chip label={`${stats.no_candidates_blocking} no candidates`} />
              <Chip label={`${stats.manual_matched} manually matched`} color="info" />
              {parseInt(stats.suggested) > 0 && (
                <Chip label={`${stats.suggested} suggested`} color="secondary" />
              )}

              <Box sx={{ flex: 1 }} />

              <Button
                variant="outlined"
                size="small"
                color="warning"
                onClick={() => setRematchDialogOpen(true)}
                disabled={rematchRunning || rematchMutation.isPending}
              >
                {rematchRunning ? 'Re-matching...' : 'Re-match All'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Geometry computation progress */}
      {geomStatus && (
        <Alert
          severity={geomComputing ? 'info' : geomStatus.errors > 0 ? 'warning' : 'success'}
          sx={{ mb: 2 }}
          action={geomComputing ? (
            <Button color="inherit" size="small" onClick={handleCancelGeomComputation}>Cancel</Button>
          ) : undefined}
        >
          <Box sx={{ width: '100%' }}>
            <Typography variant="body2">
              {geomComputing
                ? `Computing geometries... ${geomStatus.computed}/${geomStatus.total}${geomStatus.currentRegion ? ` — ${geomStatus.currentRegion}` : ''}`
                : `${geomStatus.status ?? 'Complete'} — ${geomStatus.computed} computed${geomStatus.errors > 0 ? `, ${geomStatus.errors} errors` : ''}`}
            </Typography>
            {geomComputing && (
              <LinearProgress variant="determinate" value={geomStatus.percent} sx={{ mt: 0.5 }} />
            )}
          </Box>
        </Alert>
      )}

      {/* Hierarchy warnings banner */}
      {stats && parseInt(stats.hierarchy_warnings_count) > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {stats.hierarchy_warnings_count} region{parseInt(stats.hierarchy_warnings_count) !== 1 ? 's have' : ' has'} parsing ambiguities — some sub-regions may have been dropped during extraction.
          Use the <strong>Hierarchy Warnings</strong> button in the tree toolbar to review.
        </Alert>
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

      <WorldViewImportTree
        worldViewId={worldViewId}
        onPreview={handlePreviewDivision}
        onPreviewUnion={handlePreviewUnion}
        onViewMap={handleViewMap}
        shadowInsertions={shadowInsertions}
        onApproveShadow={(insertion) => approveShadowMutation.mutate(insertion)}
        onRejectShadow={handleRejectShadow}
      />

      <DivisionPreviewDialog
        division={previewDivision}
        geometry={previewGeometry}
        loading={previewLoading}
        onClose={handleClosePreview}
        regionMapUrl={previewDivision?.regionMapUrl}
        regionMapLabel={previewDivision?.regionMapLabel}
        regionName={previewDivision?.regionName}
        wikidataId={previewDivision?.wikidataId}
        worldViewId={worldViewId}
        regionId={previewDivision?.regionId}
        onAccept={
          previewDivision?.divisionIds && previewDivision.regionId != null
            ? () => previewAcceptSelectedMutation.mutate({ regionId: previewDivision.regionId!, divisionIds: previewDivision.divisionIds! })
            : previewDivision?.regionId != null && previewDivision?.divisionId != null && !previewDivision.isAssigned
              ? () => previewAcceptMutation.mutate({ regionId: previewDivision.regionId!, divisionId: previewDivision.divisionId! })
              : undefined
        }
        onAcceptAndRejectRest={
          previewDivision?.divisionIds && previewDivision.regionId != null
            ? () => previewAcceptSelectedRejectRestMutation.mutate({ regionId: previewDivision.regionId!, divisionIds: previewDivision.divisionIds! })
            : previewDivision?.regionId != null && previewDivision?.divisionId != null && !previewDivision.isAssigned
              ? () => previewAcceptAndRejectRestMutation.mutate({ regionId: previewDivision.regionId!, divisionId: previewDivision.divisionId! })
              : undefined
        }
        onReject={
          previewDivision?.divisionIds && previewDivision.regionId != null
            ? () => previewRejectSelectedMutation.mutate({ regionId: previewDivision.regionId!, divisionIds: previewDivision.divisionIds! })
            : previewDivision?.regionId != null && previewDivision?.divisionId != null
              ? () => previewRejectMutation.mutate({ regionId: previewDivision.regionId!, divisionId: previewDivision.divisionId! })
              : undefined
        }
        onSplitDeeper={previewDivision?.divisionIds?.length && previewDivision.wikidataId ? handleSplitDeeper : undefined}
        onVisionMatch={previewDivision?.divisionIds?.length && previewDivision.regionId && previewDivision.regionMapUrl ? handleVisionMatch : undefined}
        actionPending={previewAcceptMutation.isPending || previewRejectMutation.isPending || previewAcceptAndRejectRestMutation.isPending || previewAcceptSelectedMutation.isPending || previewAcceptSelectedRejectRestMutation.isPending || previewRejectSelectedMutation.isPending || previewLoading}
      />

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

      <CoverageResolveDialog
        open={coverageDialogOpen}
        onClose={() => setCoverageDialogOpen(false)}
        worldViewId={worldViewId}
        coverageData={coverageData}
        coverageProgress={coverageProgress}
        shadowInsertions={shadowInsertions}
        onCoverageChange={(data) => queryClient.setQueryData(['admin', 'wvImport', 'coverage', worldViewId], data)}
        onApplyToTree={handleApplyToTree}
        onRecheck={runCoverageCheck}
      />
    </Box>
  );
}

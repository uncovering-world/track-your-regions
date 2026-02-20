/**
 * WorldView Import Review
 *
 * Interface for reviewing and accepting/rejecting GADM division matches
 * for imported regions. Uses the hierarchical tree view.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Alert,
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { fetchDivisionGeometry } from '../../api/divisions';
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
  rejectSuggestion,
  rejectRemaining,
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
    divisionId?: number; regionId?: number; isAssigned?: boolean;
  } | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handlePreviewDivision = useCallback(async (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean) => {
    setPreviewDivision({ name, path, regionMapUrl, wikidataId, divisionId, regionId, isAssigned });
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
        invalidateAll();
      }
      return false;
    },
  });

  const rematchRunning = rematchStatus?.status === 'matching';

  const matchingDone = stats
    && parseInt(stats.needs_review) === 0
    && parseInt(stats.no_candidates_blocking) === 0;
  const coveragePassed = coverageData != null && !coverageStale && coverageData.gaps.length === 0;

  const coverageBlockerTooltip = useMemo(() => {
    if (!stats || matchingDone) return '';
    const parts: string[] = [];
    const needsReview = parseInt(stats.needs_review);
    const noCandidates = parseInt(stats.no_candidates_blocking);
    if (needsReview > 0) parts.push(`${needsReview} need review`);
    if (noCandidates > 0) parts.push(`${noCandidates} have no candidates (unblocked)`);
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
    if (parseInt(stats.needs_review) > 0) blockers.push(`${stats.needs_review} need review`);
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
              <Chip label={`${stats.needs_review} needs review`} color="warning" />
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
        wikidataId={previewDivision?.wikidataId}
        onAccept={previewDivision?.regionId != null && previewDivision?.divisionId != null && !previewDivision.isAssigned
          ? () => previewAcceptMutation.mutate({ regionId: previewDivision.regionId!, divisionId: previewDivision.divisionId! })
          : undefined}
        onAcceptAndRejectRest={previewDivision?.regionId != null && previewDivision?.divisionId != null && !previewDivision.isAssigned
          ? () => previewAcceptAndRejectRestMutation.mutate({ regionId: previewDivision.regionId!, divisionId: previewDivision.divisionId! })
          : undefined}
        onReject={previewDivision?.regionId != null && previewDivision?.divisionId != null
          ? () => previewRejectMutation.mutate({ regionId: previewDivision.regionId!, divisionId: previewDivision.divisionId! })
          : undefined}
        actionPending={previewAcceptMutation.isPending || previewRejectMutation.isPending || previewAcceptAndRejectRestMutation.isPending}
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

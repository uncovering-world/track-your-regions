/**
 * CoverageGapsPanel — Inline gap resolution panel for the workspace.
 *
 * Reuses the SAME react-query key as WorkspaceMap for analyzeCoverageGaps
 * (keyed on ['admin','wvImport','gapAnalysis', wv, unitId, verifiedAt])
 * so panel and map share one fetch — no double request.
 *
 * Each gap row shows:
 *  - Division name + path (muted) + area in km²
 *  - Focus button → sets focusedGapDivisionId (map flies + brightens)
 *  - Assign-to Autocomplete defaulting to suggestedTarget, options = subtree regions
 *  - Confirm → addDivisionsToRegion → invalidates gapAnalysis (exact key), causing
 *    both panel + map to refetch; the resolved gap drops out immediately.
 *
 * When all gaps resolved: success state + auto-collapse after 1.5 s.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon,
  MyLocation as FocusIcon,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { analyzeCoverageGaps, geoSuggestGap } from '../../../api/admin/wvImportCoverage';
import { addDivisionsToRegion } from '../../../api/regions';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { VerifyResult } from '../../../api/admin/wvImportWorkflow';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegionOption {
  id: number;
  name: string;
  depth: number;
}

interface GapRowProps {
  divisionId: number;
  name: string;
  path: string;
  areaKm2: number;
  suggestedTargetId: number | null;
  worldViewId: number;
  unitId: number;
  subtreeOptions: RegionOption[];
  isFocused: boolean;
  onFocus: () => void;
  onAssigned: () => void;
}

// ─── Subtree walker ───────────────────────────────────────────────────────────

function collectRegionOptions(node: MatchTreeNode, depth = 0, acc: RegionOption[] = []): RegionOption[] {
  acc.push({ id: node.id, name: node.name, depth });
  for (const child of node.children) {
    collectRegionOptions(child, depth + 1, acc);
  }
  return acc;
}

// ─── GapRow ──────────────────────────────────────────────────────────────────

function GapRow({
  divisionId,
  name,
  path,
  areaKm2,
  suggestedTargetId,
  worldViewId,
  unitId,
  subtreeOptions,
  isFocused,
  onFocus,
  onAssigned,
}: GapRowProps) {
  const queryClient = useQueryClient();
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(suggestedTargetId);
  const [geoLoading, setGeoLoading] = useState(false);
  const hasFetchedGeoRef = useRef(false);

  // If no suggestedTarget from the analysis result, lazily fetch geoSuggestGap
  useEffect(() => {
    if (suggestedTargetId != null || hasFetchedGeoRef.current) return;
    hasFetchedGeoRef.current = true;
    setGeoLoading(true);
    geoSuggestGap(worldViewId, divisionId)
      .then(result => {
        if (result.suggestion?.targetRegionId != null) {
          setSelectedRegionId(result.suggestion.targetRegionId);
        }
      })
      .catch(() => {})
      .finally(() => setGeoLoading(false));
  }, [suggestedTargetId, worldViewId, divisionId]);

  const selectedOption = useMemo(
    () => subtreeOptions.find(o => o.id === selectedRegionId) ?? null,
    [subtreeOptions, selectedRegionId],
  );

  const assignMutation = useMutation({
    mutationFn: () => {
      if (selectedRegionId == null) throw new Error('No target region selected');
      return addDivisionsToRegion(selectedRegionId, [divisionId]);
    },
    onSuccess: () => {
      // Invalidate the exact gapAnalysis key — both panel and map observe it,
      // so both refetch immediately and the resolved gap drops from the list + map.
      queryClient.invalidateQueries({
        queryKey: ['admin', 'wvImport', 'gapAnalysis', worldViewId, unitId],
        exact: false,
      }).catch(() => {});
      queryClient.invalidateQueries({
        queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
      }).catch(() => {});
      queryClient.invalidateQueries({
        queryKey: ['admin', 'wvImport', 'childrenGeometry', worldViewId],
      }).catch(() => {});
      queryClient.invalidateQueries({
        queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId],
      }).catch(() => {});
      queryClient.invalidateQueries({
        queryKey: ['admin', 'wvImport', 'verify', worldViewId],
      }).catch(() => {});
      onAssigned();
    },
  });

  const areaDisplay = `${Math.round(areaKm2).toLocaleString()} km²`;

  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        bgcolor: isFocused ? (theme) => alpha(theme.palette.error.main, 0.08) : 'transparent',
        borderLeft: isFocused ? '3px solid' : '3px solid transparent',
        borderColor: isFocused ? 'error.main' : 'transparent',
        transition: 'background-color 0.15s',
      }}
    >
      {/* Line 1: name + area chip + focus icon button */}
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="body2" fontWeight={600} noWrap title={name} sx={{ flex: 1, minWidth: 0 }}>
          {name}
        </Typography>
        <Chip label={areaDisplay} size="small" sx={{ fontSize: '0.68rem', height: 18, flexShrink: 0 }} />
        <Tooltip title="Focus on map">
          <IconButton
            size="small"
            color={isFocused ? 'error' : 'default'}
            onClick={onFocus}
            sx={{ p: 0.25, flexShrink: 0 }}
          >
            <FocusIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Line 2: GADM path as muted caption */}
      <Typography
        variant="caption"
        color="text.secondary"
        title={path}
        sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mt: 0.25 }}
      >
        {path}
      </Typography>

      {/* Line 3: Autocomplete + Assign */}
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.75 }}>
        {geoLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1 }}>
            <CircularProgress size={12} />
            <Typography variant="caption" color="text.secondary">Fetching suggestion…</Typography>
          </Box>
        ) : (
          <Autocomplete
            size="small"
            options={subtreeOptions}
            value={selectedOption}
            onChange={(_e, val) => setSelectedRegionId(val?.id ?? null)}
            getOptionLabel={o => o.name}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Typography
                  variant="body2"
                  sx={{ pl: option.depth * 1.5, fontSize: '0.78rem' }}
                >
                  {option.name}
                </Typography>
              </li>
            )}
            renderInput={params => (
              <TextField
                {...params}
                placeholder="Assign to region…"
              />
            )}
            sx={{ flex: 1 }}
            disableClearable={false}
            noOptionsText="No regions"
          />
        )}
        <Button
          size="small"
          variant="contained"
          color="error"
          onClick={() => assignMutation.mutate()}
          disabled={selectedRegionId == null || assignMutation.isPending}
          sx={{ flexShrink: 0, minWidth: 60 }}
        >
          {assignMutation.isPending ? <CircularProgress size={14} color="inherit" /> : 'Assign'}
        </Button>
      </Stack>

      {assignMutation.isError && (
        <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
          Failed to assign — try again.
        </Typography>
      )}
    </Box>
  );
}

// ─── CoverageGapsPanel ────────────────────────────────────────────────────────

interface CoverageGapsPanelProps {
  worldViewId: number;
  unitId: number;
  subtreeRoot: MatchTreeNode;
  verify: VerifyResult;
  focusedGapDivisionId: number | null;
  onFocusGap: (divisionId: number | null) => void;
  onCollapse: () => void;
  onMatchChange?: () => void;
}

export function CoverageGapsPanel({
  worldViewId,
  unitId,
  subtreeRoot,
  verify,
  focusedGapDivisionId,
  onFocusGap,
  onCollapse,
  onMatchChange,
}: CoverageGapsPanelProps) {
  const [allResolved, setAllResolved] = useState(false);
  const resolvedCountRef = useRef(0);

  // Shared query key — identical to WorkspaceMap's gapAnalysis query.
  // Both components observe this key; invalidating it causes both to refetch.
  const verifiedAt = verify.verifiedAt ?? '';
  const { data: gapData, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'gapAnalysis', worldViewId, unitId, verifiedAt],
    queryFn: () => analyzeCoverageGaps(worldViewId, unitId),
    enabled: verify.coverageGaps.length > 0,
  });

  const subtreeOptions = useMemo(
    () => collectRegionOptions(subtreeRoot),
    [subtreeRoot],
  );

  const gapDivisions = gapData?.gapDivisions ?? [];
  const total = gapDivisions.length;

  // Track resolved count; when all resolved → show success + auto-collapse.
  // Also notify the page so ChecksBar marks checks stale (same as map gap-click path).
  const handleAssigned = useCallback(() => {
    resolvedCountRef.current += 1;
    onMatchChange?.();
  }, [onMatchChange]);

  // When gapAnalysis refetches after an assign, gapDivisions shrinks.
  // If it reaches 0 and we had some gaps, show success line and collapse.
  useEffect(() => {
    if (!isLoading && gapData && total === 0 && resolvedCountRef.current > 0) {
      setAllResolved(true);
      const timer = setTimeout(() => {
        onCollapse();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, gapData, total, onCollapse]);

  // The gap count to display in the header comes from verify (always available before fetch)
  const displayCount = gapDivisions.length > 0 ? gapDivisions.length : verify.coverageGaps.length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Panel header: title with count + close button */}
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          display: 'flex',
          alignItems: 'center',
          bgcolor: (theme) => alpha(theme.palette.error.main, 0.08),
          borderBottom: '1px solid',
          borderColor: 'error.light',
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle2" color="error.dark" fontWeight={700} sx={{ flex: 1 }}>
          Coverage gaps ({displayCount})
        </Typography>
        <Tooltip title="Close gaps panel">
          <IconButton size="small" onClick={onCollapse} sx={{ p: 0.5 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Explanatory note */}
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          bgcolor: (theme) => alpha(theme.palette.error.main, 0.04),
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Assign each uncovered division to its region. Coverage must reach 100% to sign off.
        </Typography>
      </Box>

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {isLoading && (
          <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption">Loading gaps…</Typography>
          </Box>
        )}

        {!isLoading && allResolved && (
          <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleIcon color="success" sx={{ fontSize: 16 }} />
            <Typography variant="caption" color="success.main" fontWeight={600}>
              All gaps resolved! Re-run checks to confirm.
            </Typography>
          </Box>
        )}

        {!isLoading && !allResolved && gapDivisions.length === 0 && gapData != null && (
          <Box sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              No gaps found — re-run checks to confirm.
            </Typography>
          </Box>
        )}

        {!isLoading && !allResolved && gapDivisions.length > 0 && (
          <Box>
            {gapDivisions.map((gap, idx) => (
              <Box key={gap.divisionId}>
                {idx > 0 && <Divider />}
                <GapRow
                  divisionId={gap.divisionId}
                  name={gap.name}
                  path={gap.path}
                  areaKm2={gap.areaKm2}
                  suggestedTargetId={gap.suggestedTarget?.regionId ?? null}
                  worldViewId={worldViewId}
                  unitId={unitId}
                  subtreeOptions={subtreeOptions}
                  isFocused={focusedGapDivisionId === gap.divisionId}
                  onFocus={() => onFocusGap(gap.divisionId)}
                  onAssigned={handleAssigned}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

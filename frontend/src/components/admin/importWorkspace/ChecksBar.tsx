/**
 * ChecksBar — Run verification checks and display blocker chips.
 *
 * - "Run checks" button triggers getWorkUnitVerification for this unit.
 * - Shows stale chip when lastMutationAt advances past lastRunAt.
 * - Renders blocker chips (labels from VerifyDialog's BLOCKER_LABEL map).
 * - Counts: N unassigned, N gaps, N overlaps.
 * - Lifts verify result to parent so ChecksBar can gate sign-off.
 */

import { useCallback, useRef } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Warning as StaleIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import {
  getWorkUnitVerification,
  type SignOffBlocker,
  type VerifyResult,
} from '../../../api/admin/wvImportWorkflow';

// For the onFocusBlocker prop
type FocusBlockerKind = 'unassigned' | 'gaps' | 'overlaps';

// Labels reused from VerifyDialog (duplicated here; extracted to shared module in Plan 4)
export const BLOCKER_LABEL: Record<SignOffBlocker, string> = {
  hierarchy_not_confirmed: 'Hierarchy not confirmed',
  no_reference_territory: 'No reference territory',
  unassigned_leaves: 'Unassigned leaves',
  coverage_gaps: 'Coverage gaps',
  overlaps: 'Overlapping assignments',
};

interface ChecksBarProps {
  worldViewId: number;
  unitId: number;
  /** Bumped on every mutation to trigger "stale" chip */
  lastMutationAt: number;
  /** Lifted verify result — parent reads this to gate sign-off */
  onVerifyChange: (verify: VerifyResult | null) => void;
  verify: VerifyResult | null;
  /**
   * Called when a count chip is clicked; parent focuses the first affected region
   * (Plan 6 — for now selects the first affected item or unit root).
   */
  onFocusBlocker?: (kind: FocusBlockerKind) => void;
  /** Unit's own children-coverage percentage (0–1) — shown next to gap count */
  coveragePct?: number;
}

function coveragePctColor(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 0.9) return 'success';
  if (pct >= 0.5) return 'warning';
  return 'error';
}

export function ChecksBar({
  worldViewId,
  unitId,
  lastMutationAt,
  onVerifyChange,
  verify,
  onFocusBlocker,
  coveragePct,
}: ChecksBarProps) {
  const lastRunAtRef = useRef<number>(0);

  const { isFetching, refetch } = useQuery({
    queryKey: ['admin', 'wvImport', 'verify', worldViewId, unitId],
    queryFn: () => getWorkUnitVerification(worldViewId, unitId),
    enabled: false,
    staleTime: Infinity,
  });

  const handleRun = useCallback(() => {
    refetch().then(result => {
      if (result.data) {
        onVerifyChange(result.data);
        lastRunAtRef.current = Date.now();
      }
    }).catch(() => {});
  }, [refetch, onVerifyChange]);

  const isStale = lastMutationAt > lastRunAtRef.current && verify !== null;

  // hierarchy_not_confirmed is derived client-side from the unit prop in VerifyDialog;
  // here we only show server-side blockers from verify result.
  const blockers: SignOffBlocker[] = verify?.blockers ?? [];

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      flexWrap: 'wrap',
      px: 1,
      py: 0.5,
      bgcolor: 'background.paper',
      borderBottom: '1px solid',
      borderColor: 'divider',
    }}>
      <Button
        size="small"
        variant="outlined"
        startIcon={isFetching ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
        onClick={handleRun}
        disabled={isFetching}
        sx={{ flexShrink: 0, fontSize: '0.72rem' }}
      >
        {isFetching ? 'Running…' : 'Run checks'}
      </Button>

      {isStale && (
        <Chip
          icon={<StaleIcon sx={{ fontSize: 14 }} />}
          label="stale — re-run"
          size="small"
          color="warning"
          variant="outlined"
        />
      )}

      {verify === null && !isFetching && (
        <Typography variant="caption" color="text.secondary">
          Checks not run yet.
        </Typography>
      )}

      {verify !== null && blockers.length === 0 && (
        <Chip label="All checks green" size="small" color="success" />
      )}

      {blockers.map(b => (
        <Chip key={b} label={BLOCKER_LABEL[b]} size="small" color="warning" variant="outlined" />
      ))}

      {/* Unit coverage % — shown next to gap count */}
      {coveragePct != null && (
        <Chip
          label={`cover ${(coveragePct * 100).toFixed(1)}%`}
          size="small"
          color={coveragePctColor(coveragePct)}
          variant="outlined"
        />
      )}

      {/* Count summaries — clicking focuses the map on the first affected region (I8) */}
      {verify !== null && (
        <Stack direction="row" spacing={0.5}>
          {verify.unassignedLeaves.length > 0 && (
            <Tooltip title={`Unassigned: ${verify.unassignedLeaves.map(l => l.name).slice(0, 5).join(', ')}${verify.unassignedLeaves.length > 5 ? '…' : ''}`}>
              <Chip
                label={`${verify.unassignedLeaves.length} unassigned`}
                size="small"
                color="warning"
                variant="outlined"
                onClick={onFocusBlocker ? () => onFocusBlocker('unassigned') : undefined}
                clickable={!!onFocusBlocker}
              />
            </Tooltip>
          )}
          {verify.coverageGaps.length > 0 && (
            <Chip
              label={`${verify.coverageGaps.length} gaps`}
              size="small"
              color="error"
              variant="outlined"
              onClick={onFocusBlocker ? () => onFocusBlocker('gaps') : undefined}
              clickable={!!onFocusBlocker}
            />
          )}
          {verify.overlaps.length > 0 && (
            <Chip
              label={`${verify.overlaps.length} overlaps`}
              size="small"
              color="error"
              variant="outlined"
              onClick={onFocusBlocker ? () => onFocusBlocker('overlaps') : undefined}
              clickable={!!onFocusBlocker}
            />
          )}
        </Stack>
      )}
    </Box>
  );
}

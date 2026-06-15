import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress,
  IconButton, LinearProgress, List, ListItem, ListItemText, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  ExpandMore as ExpandIcon,
  MyLocation as GeoSuggestIcon,
  VisibilityOff as DismissIcon,
  Undo as UndismissIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCoverageWithProgress, dismissCoverageGap, undismissCoverageGap,
  approveCoverageSuggestion, geoSuggestGap,
  type CoverageResult, type CoverageGap, type GeoSuggestResult,
} from '../../../api/admin/wvImportCoverage';
import { searchRegions, type RegionSearchResult } from '../../../api/regions';

// ---------------------------------------------------------------------------
// Per-row state (geo-suggest result + manual search) — lifted into a small
// record keyed by division id to avoid a Map with a useState on each render.
// ---------------------------------------------------------------------------

interface RowState {
  geoResult?: GeoSuggestResult;
  geoLoading?: boolean;
  searchOpen?: boolean;
  searchQuery?: string;
  searchSelected?: RegionSearchResult | null;
}

// ---------------------------------------------------------------------------
// GapRow sub-component (keeps cognitive complexity bounded)
// ---------------------------------------------------------------------------

function GapRow({
  gap,
  worldViewId,
  rowState,
  onRowState,
  onApprove,
  onDismiss,
  approving,
  dismissing,
}: {
  gap: CoverageGap;
  worldViewId: number;
  rowState: RowState;
  onRowState: (patch: Partial<RowState>) => void;
  onApprove: (divisionId: number, regionId: number, action: 'add_member' | 'create_region', gapName: string) => void;
  onDismiss: (divisionId: number) => void;
  approving: boolean;
  dismissing: boolean;
}) {
  const anyPending = approving || rowState.geoLoading === true;
  const searchQuery = rowState.searchQuery ?? '';

  // Region search for "Choose region…" (enabled only while searchOpen)
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['admin', 'gapRowSearch', worldViewId, gap.id, searchQuery],
    queryFn: () => searchRegions(worldViewId, searchQuery),
    enabled: (rowState.searchOpen === true) && searchQuery.length >= 2,
  });

  const handleGeoSuggest = async () => {
    onRowState({ geoLoading: true, geoResult: undefined });
    try {
      const result = await geoSuggestGap(worldViewId, gap.id);
      onRowState({ geoLoading: false, geoResult: result });
    } catch {
      onRowState({ geoLoading: false });
    }
  };

  const geoSugg = rowState.geoResult?.suggestion;

  return (
    <ListItem
      alignItems="flex-start"
      sx={{ flexDirection: 'column', gap: 0.5, py: 1 }}
    >
      {/* Row header: name + parent + existing suggestion label */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 1 }}>
        <ListItemText
          sx={{ my: 0, flex: 1 }}
          primary={gap.name}
          secondary={gap.parentName ?? undefined}
        />
      </Box>

      {/* Action strip */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, pl: 0 }}>

        {/* --- Pre-computed suggestion --- */}
        {gap.suggestion && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              → {gap.suggestion.targetRegionName}
            </Typography>
            <Chip
              size="small"
              label={gap.suggestion.action === 'add_member' ? 'add to region' : 'create region'}
              variant="outlined"
            />
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={anyPending}
              onClick={() =>
                onApprove(gap.id, gap.suggestion!.targetRegionId, gap.suggestion!.action, gap.name)
              }
              sx={{ minWidth: 0, py: 0.25, px: 1, fontSize: '0.7rem' }}
            >
              Approve
            </Button>
          </Box>
        )}

        {/* --- Geo-suggest --- */}
        <Tooltip title="Geo-suggest nearest region">
          <span>
            <IconButton
              size="small"
              onClick={handleGeoSuggest}
              disabled={anyPending}
            >
              {rowState.geoLoading
                ? <CircularProgress size={14} />
                : <GeoSuggestIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>

        {geoSugg && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              ~ {geoSugg.targetRegionName}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="success"
              disabled={anyPending}
              onClick={() =>
                onApprove(gap.id, geoSugg.targetRegionId, 'add_member', gap.name)
              }
              sx={{ minWidth: 0, py: 0.25, px: 1, fontSize: '0.7rem' }}
            >
              Approve
            </Button>
          </Box>
        )}

        {/* --- Manual region picker --- */}
        {rowState.searchOpen ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
              size="small"
              placeholder="Search region…"
              value={searchQuery}
              onChange={e => onRowState({ searchQuery: e.target.value, searchSelected: null })}
              sx={{ minWidth: 130, '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.5 } }}
            />
            {searchQuery.length >= 2 && searchResults && searchResults.length > 0 && (
              <TextField
                select
                size="small"
                value={rowState.searchSelected?.id ?? ''}
                onChange={e => {
                  const hit = searchResults.find(r => r.id === Number(e.target.value)) ?? null;
                  onRowState({ searchSelected: hit });
                }}
                slotProps={{ select: { native: true } }}
                sx={{ minWidth: 150, '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.5 } }}
              >
                <option value="">
                  {isSearching ? 'Searching…' : 'Pick region…'}
                </option>
                {searchResults.map(r => (
                  <option key={r.id} value={r.id} title={r.path}>
                    {r.name} ({r.path})
                  </option>
                ))}
              </TextField>
            )}
            <Button
              size="small"
              variant="outlined"
              color="success"
              disabled={anyPending || !rowState.searchSelected}
              onClick={() => {
                if (rowState.searchSelected) {
                  onApprove(gap.id, rowState.searchSelected.id, 'add_member', gap.name);
                }
              }}
              sx={{ minWidth: 0, py: 0.25, px: 1, fontSize: '0.7rem' }}
            >
              Approve
            </Button>
            <Button
              size="small"
              onClick={() => onRowState({ searchOpen: false, searchQuery: '', searchSelected: null })}
              sx={{ minWidth: 0, py: 0.25, px: 0.5, fontSize: '0.7rem' }}
            >
              Cancel
            </Button>
          </Box>
        ) : (
          <Button
            size="small"
            variant="text"
            disabled={anyPending}
            onClick={() => onRowState({ searchOpen: true })}
            sx={{ minWidth: 0, py: 0.25, px: 0.5, fontSize: '0.7rem' }}
          >
            Choose region…
          </Button>
        )}

        {/* --- Dismiss --- */}
        <Tooltip title="Dismiss from coverage checks">
          <span>
            <IconButton
              edge="end"
              size="small"
              disabled={anyPending || dismissing}
              onClick={() => onDismiss(gap.id)}
            >
              <DismissIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Success line shown briefly after a geo-suggest with no suggestion */}
      {rowState.geoResult && !geoSugg && (
        <Typography variant="caption" color="text.secondary">No nearby region found by geo-suggest.</Typography>
      )}
    </ListItem>
  );
}

// ---------------------------------------------------------------------------
// GlobalGapsTab
// ---------------------------------------------------------------------------

export function GlobalGapsTab({ worldViewId }: { worldViewId: number }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ running: boolean; step?: string }>({ running: false });

  // Per-row state keyed by division id
  const [rowStates, setRowStates] = useState<Map<number, RowState>>(new Map());
  // Per-row approve success message
  const [approvedNames, setApprovedNames] = useState<Map<number, string>>(new Map());

  const { data: coverage } = useQuery({
    queryKey: ['admin', 'wvImport', 'coverage', worldViewId],
    queryFn: () => null as CoverageResult | null,
    enabled: false,
    gcTime: Infinity,
    staleTime: Infinity,
  });

  const runCheck = () => {
    setProgress({ running: true });
    getCoverageWithProgress(worldViewId, e => {
      if (e.type === 'progress') setProgress({ running: true, step: e.step });
    })
      .then(result => {
        queryClient.setQueryData(['admin', 'wvImport', 'coverage', worldViewId], result);
        setProgress({ running: false });
      })
      .catch(() => setProgress({ running: false }));
  };

  const patchCoverage = (fn: (c: CoverageResult) => CoverageResult) => {
    const cur = queryClient.getQueryData<CoverageResult>(['admin', 'wvImport', 'coverage', worldViewId]);
    if (cur) queryClient.setQueryData(['admin', 'wvImport', 'coverage', worldViewId], fn(cur));
  };

  const patchRowState = (divisionId: number, patch: Partial<RowState>) => {
    setRowStates(prev => {
      const next = new Map(prev);
      next.set(divisionId, { ...prev.get(divisionId), ...patch });
      return next;
    });
  };

  const dismissMutation = useMutation({
    mutationFn: (divisionId: number) => dismissCoverageGap(worldViewId, divisionId),
    onSuccess: (_d, divisionId) =>
      patchCoverage(c => {
        const gap = c.gaps.find(g => g.id === divisionId);
        return {
          ...c,
          gaps: c.gaps.filter(g => g.id !== divisionId),
          dismissedCount: c.dismissedCount + 1,
          dismissedGaps: gap ? [...c.dismissedGaps, { id: gap.id, name: gap.name, parentName: gap.parentName }] : c.dismissedGaps,
        };
      }),
  });

  const undismissMutation = useMutation({
    mutationFn: (divisionId: number) => undismissCoverageGap(worldViewId, divisionId),
    onSuccess: () => runCheck(),
  });

  const approveMutation = useMutation({
    mutationFn: ({ divisionId, regionId, action, gapName }: {
      divisionId: number;
      regionId: number;
      action: 'add_member' | 'create_region';
      gapName: string;
    }) => approveCoverageSuggestion(worldViewId, divisionId, regionId, action, gapName),
    onSuccess: (_d, { divisionId, gapName }) => {
      // Drop the resolved gap from the coverage cache (mirror dismiss, but no dismissed entry)
      patchCoverage(c => ({
        ...c,
        gaps: c.gaps.filter(g => g.id !== divisionId),
      }));
      // Bump the dashboard so the Finalize gate re-evaluates
      queryClient.invalidateQueries({
        queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId],
      }).catch(() => undefined);
      // Brief success line
      setApprovedNames(prev => new Map(prev).set(divisionId, gapName));
      // Clean up row state
      setRowStates(prev => {
        const next = new Map(prev);
        next.delete(divisionId);
        return next;
      });
    },
  });

  let runButtonLabel = coverage ? 'Re-check coverage' : 'Check coverage';
  if (progress.running) runButtonLabel = 'Checking…';

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
        <Button variant="outlined" onClick={runCheck} disabled={progress.running}>
          {runButtonLabel}
        </Button>
        {progress.running && (
          <Typography variant="body2" color="text.secondary">{progress.step ?? 'Working…'}</Typography>
        )}
      </Box>
      {progress.running && <LinearProgress sx={{ mb: 2 }} />}

      {/* Brief success toasts for recently resolved gaps */}
      {approvedNames.size > 0 && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={() => setApprovedNames(new Map())}>
          Resolved: {[...approvedNames.values()].join(', ')}
        </Alert>
      )}

      {coverage && coverage.gaps.length === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>No active coverage gaps.</Alert>
      )}

      {coverage && coverage.gaps.length > 0 && (
        <>
          <Typography variant="h6" gutterBottom>Active gaps ({coverage.gaps.length})</Typography>
          <List dense>
            {coverage.gaps.map(g => (
              <GapRow
                key={g.id}
                gap={g}
                worldViewId={worldViewId}
                rowState={rowStates.get(g.id) ?? {}}
                onRowState={patch => patchRowState(g.id, patch)}
                onApprove={(divisionId, regionId, action, gapName) =>
                  approveMutation.mutate({ divisionId, regionId, action, gapName })
                }
                onDismiss={id => dismissMutation.mutate(id)}
                approving={approveMutation.isPending && approveMutation.variables?.divisionId === g.id}
                dismissing={dismissMutation.isPending && dismissMutation.variables === g.id}
              />
            ))}
          </List>
        </>
      )}

      {coverage && coverage.dismissedGaps.length > 0 && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandIcon />}>
            <Typography>{coverage.dismissedGaps.length} dismissed</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <List dense>
              {coverage.dismissedGaps.map(g => (
                <ListItem key={g.id}
                  secondaryAction={
                    <IconButton edge="end" size="small" disabled={undismissMutation.isPending}
                      onClick={() => undismissMutation.mutate(g.id)}>
                      <UndismissIcon fontSize="small" />
                    </IconButton>
                  }>
                  <ListItemText primary={g.name} secondary={g.parentName ?? undefined} />
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}

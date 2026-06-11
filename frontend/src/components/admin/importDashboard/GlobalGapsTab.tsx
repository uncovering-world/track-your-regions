import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, IconButton,
  LinearProgress, List, ListItem, ListItemText, Tooltip, Typography,
} from '@mui/material';
import { ExpandMore as ExpandIcon, VisibilityOff as DismissIcon, Undo as UndismissIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCoverageWithProgress, dismissCoverageGap, undismissCoverageGap, type CoverageResult,
} from '../../../api/admin/wvImportCoverage';

export function GlobalGapsTab({ worldViewId }: { worldViewId: number }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ running: boolean; step?: string }>({ running: false });

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

      {coverage && coverage.gaps.length === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>No active coverage gaps.</Alert>
      )}

      {coverage && coverage.gaps.length > 0 && (
        <>
          <Typography variant="h6" gutterBottom>Active gaps ({coverage.gaps.length})</Typography>
          <List dense>
            {coverage.gaps.map(g => (
              <ListItem key={g.id}
                secondaryAction={
                  <Tooltip title="Dismiss from coverage checks">
                    <IconButton edge="end" size="small" disabled={dismissMutation.isPending}
                      onClick={() => dismissMutation.mutate(g.id)}>
                      <DismissIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }>
                <ListItemText
                  primary={g.name}
                  secondary={[g.parentName, g.suggestion ? `suggested: ${g.suggestion.targetRegionName}` : null]
                    .filter(Boolean).join(' · ') || undefined}
                />
              </ListItem>
            ))}
          </List>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Assign gaps via the legacy match tree's coverage dialog until Plan 4 moves resolution here.
          </Typography>
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

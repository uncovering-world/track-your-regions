import { useState } from 'react';
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  LinearProgress, List, ListItem, ListItemText, Stack, Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  getWorkUnitVerification, signOffWorkUnit,
  type DashboardUnit, type SignOffBlocker, type VerifyResult,
} from '../../../api/admin/wvImportWorkflow';

const BLOCKER_LABEL: Record<SignOffBlocker, string> = {
  hierarchy_not_confirmed: 'Hierarchy not confirmed',
  no_reference_territory: 'No reference territory',
  unassigned_leaves: 'Unassigned leaves',
  coverage_gaps: 'Coverage gaps',
  overlaps: 'Overlapping assignments',
};

const MAX_LIST = 20;

function PlusMore({ total, shown }: { total: number; shown: number }) {
  if (total <= shown) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ pl: 2, display: 'block' }}>
      +{total - shown} more
    </Typography>
  );
}

export function VerifyDialog({
  worldViewId, unit, onClose,
}: { worldViewId: number; unit: DashboardUnit; onClose: () => void }) {
  const [signOffError, setSignOffError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Overrides from a 409 response — fresher than a refetch
  const [verifyOverride, setVerifyOverride] = useState<VerifyResult | null>(null);
  const [serverBlockers, setServerBlockers] = useState<SignOffBlocker[] | null>(null);

  const { data: fetchedVerify, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'wvImport', 'verify', worldViewId, unit.regionId],
    queryFn: () => getWorkUnitVerification(worldViewId, unit.regionId),
    staleTime: 0,
  });

  // Use override if present (from 409 response), otherwise the fetched data
  const verify = verifyOverride ?? fetchedVerify;

  const derivedBlockers: SignOffBlocker[] = [
    ...(!unit.hierarchyConfirmed ? (['hierarchy_not_confirmed'] as const) : []),
    ...(verify?.blockers ?? []),
  ];
  // serverBlockers from a 409 response are fresher than the stale unit prop
  const blockers = serverBlockers ?? derivedBlockers;

  const handleSignOff = async () => {
    setPending(true);
    setSignOffError(null);
    try {
      const result = await signOffWorkUnit(worldViewId, unit.regionId);
      if (result.ok) {
        onClose();
      } else {
        // 409 — store both verify and blockers from response (fresher than refetch)
        setVerifyOverride(result.verify);
        setServerBlockers(result.blockers);
        setSignOffError('Sign-off blocked');
      }
    } catch (err) {
      setSignOffError(err instanceof Error ? err.message : 'Sign-off failed');
    } finally {
      setPending(false);
    }
  };

  const handleRerunChecks = () => {
    setVerifyOverride(null);
    setServerBlockers(null);
    setSignOffError(null);
    void refetch();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{unit.name} — checks</DialogTitle>
      <DialogContent>
        {isFetching && <LinearProgress sx={{ mb: 2 }} />}
        {signOffError && (
          <Alert severity="warning" onClose={() => setSignOffError(null)} sx={{ mb: 2 }}>
            {signOffError}
          </Alert>
        )}
        {verify && blockers.length === 0 && (
          <Alert severity="success" sx={{ mb: 2 }}>All checks green — ready to sign off.</Alert>
        )}
        {blockers.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            {blockers.map(b => <Chip key={b} label={BLOCKER_LABEL[b]} color="warning" size="small" />)}
          </Stack>
        )}
        {verify && verify.unassignedLeaves.length > 0 && (
          <>
            <Typography variant="subtitle2">Unassigned leaves ({verify.unassignedLeaves.length})</Typography>
            <List dense>
              {verify.unassignedLeaves.slice(0, MAX_LIST).map(l => (
                <ListItem key={l.regionId}><ListItemText primary={l.name} /></ListItem>
              ))}
            </List>
            <PlusMore total={verify.unassignedLeaves.length} shown={MAX_LIST} />
          </>
        )}
        {verify && verify.coverageGaps.length > 0 && (
          <>
            <Typography variant="subtitle2">Coverage gaps ({verify.coverageGaps.length})</Typography>
            <List dense>
              {verify.coverageGaps.slice(0, MAX_LIST).map(g => (
                <ListItem key={g.divisionId}>
                  <ListItemText primary={g.name} secondary={g.parentName ?? undefined} />
                </ListItem>
              ))}
            </List>
            <PlusMore total={verify.coverageGaps.length} shown={MAX_LIST} />
          </>
        )}
        {verify && verify.overlaps.length > 0 && (
          <>
            <Typography variant="subtitle2">Overlaps ({verify.overlaps.length})</Typography>
            <List dense>
              {verify.overlaps.slice(0, MAX_LIST).map(o => (
                <ListItem key={o.divisionId}>
                  <ListItemText primary={o.name} secondary={`claimed by regions ${o.regionIds.join(', ')}`} />
                </ListItem>
              ))}
            </List>
            <PlusMore total={verify.overlaps.length} shown={MAX_LIST} />
          </>
        )}
        <Typography variant="caption" color="text.secondary">
          Resolve assignments in this country&apos;s workspace (tree, panel, and map) — or the legacy match tree for tools not yet migrated.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleRerunChecks} disabled={isFetching || pending}>Re-run checks</Button>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          color="success"
          disabled={isFetching || blockers.length > 0 || pending}
          onClick={() => { void handleSignOff(); }}
        >
          Sign off
        </Button>
      </DialogActions>
    </Dialog>
  );
}

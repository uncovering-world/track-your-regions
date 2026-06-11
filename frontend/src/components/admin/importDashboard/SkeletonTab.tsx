import { Alert, Box, Button, Chip, List, ListItem, ListItemText, Switch, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMatchTree } from '../../../api/admin/worldViewImport';
import {
  confirmSkeleton, setWorkUnitFlag, type DashboardUnit,
} from '../../../api/admin/wvImportWorkflow';
import { collectSkeletonCandidates } from './dashboardUtils';

export function SkeletonTab({
  worldViewId, skeletonConfirmed, units,
}: { worldViewId: number; skeletonConfirmed: boolean; units: DashboardUnit[] }) {
  const queryClient = useQueryClient();
  const { data: tree, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
  });
  const candidates = tree ? collectSkeletonCandidates(tree) : [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
  };
  const toggleMutation = useMutation({
    mutationFn: ({ regionId, isWorkUnit }: { regionId: number; isWorkUnit: boolean }) =>
      setWorkUnitFlag(worldViewId, regionId, isWorkUnit),
    onSuccess: invalidate,
  });
  const confirmMutation = useMutation({
    mutationFn: (confirmed: boolean) => confirmSkeleton(worldViewId, confirmed),
    onSuccess: invalidate,
  });

  return (
    <Box>
      <Alert severity={skeletonConfirmed ? 'success' : 'info'} sx={{ mb: 2 }}
        action={
          <Button color="inherit" size="small" disabled={confirmMutation.isPending}
            onClick={() => confirmMutation.mutate(!skeletonConfirmed)}>
            {skeletonConfirmed ? 'Unconfirm' : 'Confirm skeleton'}
          </Button>
        }>
        {skeletonConfirmed
          ? 'Skeleton confirmed — continents and the work-unit list are settled.'
          : 'Review the work-unit list and resolve unidentified countries, then confirm.'}
      </Alert>

      <Typography variant="h6" gutterBottom>Unidentified countries ({candidates.length})</Typography>
      {isLoading && <Typography color="text.secondary">Loading tree…</Typography>}
      {!isLoading && candidates.length === 0 && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>None — every unresolved node sits inside a work unit.</Typography>
      )}
      <List dense>
        {candidates.map(c => (
          <ListItem key={c.id}
            secondaryAction={
              <Tooltip title="Promote to work unit">
                <Switch size="small" checked={false} disabled={toggleMutation.isPending}
                  onChange={() => toggleMutation.mutate({ regionId: c.id, isWorkUnit: true })} />
              </Tooltip>
            }>
            <ListItemText primary={c.name} secondary={c.matchStatus ?? undefined} />
          </ListItem>
        ))}
      </List>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 3 }}>
        Resolve matches for these in the legacy match tree; promote ones that should be countries.
      </Typography>

      <Typography variant="h6" gutterBottom>Work units ({units.length})</Typography>
      <List dense>
        {units.map(u => (
          <ListItem key={u.regionId}
            secondaryAction={
              <Tooltip title="Demote (resets sign-off lifecycle)">
                <Switch size="small" checked disabled={toggleMutation.isPending}
                  onChange={() => toggleMutation.mutate({ regionId: u.regionId, isWorkUnit: false })} />
              </Tooltip>
            }>
            <ListItemText primary={u.name}
              secondary={u.continent ?? undefined} />
            {!u.hasReference && <Chip label="no reference" size="small" color="error" variant="outlined" />}
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

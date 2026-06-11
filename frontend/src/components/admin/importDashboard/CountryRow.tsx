import { useState } from 'react';
import {
  Chip, CircularProgress, IconButton, ListItem, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography,
} from '@mui/material';
import { MoreVert as MenuIcon } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  confirmHierarchy, reopenWorkUnit, type DashboardUnit,
} from '../../../api/admin/wvImportWorkflow';
import { deriveUnitStatus, type UnitStatus } from './dashboardUtils';
import { VerifyDialog } from './VerifyDialog';

export const STATUS_DOT: Record<UnitStatus, { glyph: string; color: string; label: string }> = {
  not_started: { glyph: '○', color: 'text.disabled', label: 'not started' },
  in_progress: { glyph: '◐', color: 'info.main', label: 'in progress' },
  signed_off: { glyph: '⬤', color: 'success.main', label: 'signed off' },
  stale: { glyph: '⚠', color: 'warning.main', label: 'modified after sign-off' },
};

export function CountryRow({
  worldViewId, unit, isDuplicate,
}: { worldViewId: number; unit: DashboardUnit; isDuplicate: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const status = deriveUnitStatus(unit);
  const dot = STATUS_DOT[status];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] });

  const confirmMutation = useMutation({
    mutationFn: () => confirmHierarchy(worldViewId, unit.regionId, !unit.hierarchyConfirmed),
    onSuccess: invalidate,
  });
  const reopenMutation = useMutation({
    mutationFn: () => reopenWorkUnit(worldViewId, unit.regionId),
    onSuccess: invalidate,
  });
  const busy = confirmMutation.isPending || reopenMutation.isPending;

  const workspacePath = `/admin/import/${worldViewId}/region/${unit.regionId}`;

  return (
    <ListItem
      dense
      onClick={() => navigate(workspacePath)}
      sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      secondaryAction={
        <IconButton
          edge="end"
          size="small"
          aria-label={`actions for ${unit.name}`}
          onClick={e => { e.stopPropagation(); setMenuAnchor(e.currentTarget); }}
        >
          {busy ? <CircularProgress size={16} /> : <MenuIcon fontSize="small" />}
        </IconButton>
      }
    >
      <Tooltip title={dot.label}>
        <Typography sx={{ width: 28, color: dot.color }}>{dot.glyph}</Typography>
      </Tooltip>
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center">
            <span>{unit.name}</span>
            {isDuplicate && <Chip label="×2" size="small" variant="outlined" />}
            {!unit.hasReference && <Chip label="no reference" size="small" color="error" variant="outlined" />}
            {unit.warningCount > 0 && (
              <Chip label={`${unit.warningCount} ⚠`} size="small" color="warning" variant="outlined" />
            )}
          </Stack>
        }
        secondary={`Hierarchy ${unit.hierarchyConfirmed ? '✓' : '✗'} · ${unit.leafResolved}/${unit.leafTotal} leaves`}
      />
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { setMenuAnchor(null); navigate(workspacePath); }}>
          Open workspace
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); setVerifyOpen(true); }}>
          Checks & sign-off…
        </MenuItem>
        <MenuItem disabled={busy} onClick={() => { setMenuAnchor(null); confirmMutation.mutate(); }}>
          {unit.hierarchyConfirmed ? 'Unconfirm hierarchy' : 'Confirm hierarchy'}
        </MenuItem>
        {(status === 'signed_off' || status === 'stale') && (
          <MenuItem disabled={busy} onClick={() => { setMenuAnchor(null); reopenMutation.mutate(); }}>
            Reopen
          </MenuItem>
        )}
      </Menu>
      {verifyOpen && (
        <VerifyDialog
          worldViewId={worldViewId}
          unit={unit}
          onClose={() => { setVerifyOpen(false); invalidate(); }}
        />
      )}
    </ListItem>
  );
}

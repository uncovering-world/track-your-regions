/**
 * SkeletonTab — skeleton curation for the import workflow dashboard.
 *
 * Confirms the work-unit list (skeleton), curates container groupings
 * (add / rename / reparent / remove / promote / demote), and surfaces
 * unresolved non-unit nodes (worklist) for promotion or assignment.
 *
 * Wiring pattern mirrors CountryWorkspacePage: useTreeMutations +
 * useImportTreeDialogs with the minimal-deps subset needed here
 * (no preview, no map picker — not needed for the skeleton pass).
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  Alert, Box, Button, Chip, List, ListItem, ListItemText,
  Switch, Tooltip, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMatchTree } from '../../../api/admin/worldViewImport';
import {
  confirmSkeleton, setWorkUnitFlag, type DashboardUnit,
} from '../../../api/admin/wvImportWorkflow';
import { buildSkeletonForest, collectForestCandidates } from './dashboardUtils';
import { SkeletonTree } from './SkeletonTree';
import { useTreeMutations, type MapPickerState } from '../useTreeMutations';
import { useImportTreeDialogs } from '../useImportTreeDialogs';
import {
  RemoveRegionDialog,
  RenameRegionDialog,
  ReparentRegionDialog,
  AddChildDialog,
} from '../ImportTreeDialogs';

export function SkeletonTab({
  worldViewId, skeletonConfirmed, units,
}: { worldViewId: number; skeletonConfirmed: boolean; units: DashboardUnit[] }) {
  const queryClient = useQueryClient();

  // ── Match tree ────────────────────────────────────────────────────────────
  const { data: tree, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
  });

  // ── Invalidation helper ───────────────────────────────────────────────────
  const invalidateBoth = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
  }, [queryClient, worldViewId]);

  // ── Remove dialog state ───────────────────────────────────────────────────
  const [removeDialogState, setRemoveDialogState] = useState<{
    regionId: number; regionName: string; hasChildren: boolean; hasDivisions: boolean;
  } | null>(null);

  // ── No-op map picker (not needed in skeleton tab) ─────────────────────────
  const [mapPickerState] = useState<MapPickerState | null>(null);
  const mapPickerStateRef = useRef<MapPickerState | null>(null);
  mapPickerStateRef.current = mapPickerState;

  // ── useTreeMutations — minimal deps (no preview, no real map picker) ─────
  const mutations = useTreeMutations(worldViewId, {
    onPreview: () => {},
    mapPickerStateRef,
    setMapPickerState: () => {},
    setRemoveDialogState,
    onMatchChange: invalidateBoth,
  });

  // ── useImportTreeDialogs — minimal deps ────────────────────────────────────
  const dialogs = useImportTreeDialogs(worldViewId, tree, {
    renameMutation: mutations.renameMutation,
    reparentMutation: mutations.reparentMutation,
    setRemoveDialogState,
    setUndoSnackbar: mutations.setUndoSnackbar,
    invalidateTree: mutations.invalidateTree,
  });

  // ── Skeleton confirm mutation ─────────────────────────────────────────────
  const confirmMutation = useMutation({
    mutationFn: (confirmed: boolean) => confirmSkeleton(worldViewId, confirmed),
    onSuccess: invalidateBoth,
  });

  // ── Work-unit toggle (promote/demote) ─────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: ({ regionId, isWorkUnit }: { regionId: number; isWorkUnit: boolean }) =>
      setWorkUnitFlag(worldViewId, regionId, isWorkUnit),
    onSuccess: invalidateBoth,
  });

  // ── Derived data ──────────────────────────────────────────────────────────
  const forest = useMemo(() => tree ? buildSkeletonForest(tree) : [], [tree]);
  const candidates = collectForestCandidates(forest);
  const isPending = mutations.isMutating || toggleMutation.isPending || confirmMutation.isPending;

  // ── SkeletonTree callbacks ─────────────────────────────────────────────────
  const handleDemote = useCallback((regionId: number) => {
    toggleMutation.mutate({ regionId, isWorkUnit: false });
  }, [toggleMutation]);

  const handlePromote = useCallback((regionId: number) => {
    toggleMutation.mutate({ regionId, isWorkUnit: true });
  }, [toggleMutation]);

  const handleAddChild = useCallback((regionId: number) => {
    dialogs.setAddChildDialogRegionId(regionId);
  }, [dialogs]);

  const handleRename = useCallback((state: Parameters<typeof dialogs.setRenameDialog>[0]) => {
    dialogs.setRenameDialog(state);
  }, [dialogs]);

  const handleReparent = useCallback((state: Parameters<typeof dialogs.setReparentDialog>[0]) => {
    dialogs.setReparentDialog(state);
  }, [dialogs]);

  const handleRemove = useCallback((regionId: number, regionName: string) => {
    const node = forest.flat().find(n => n.id === regionId)
      ?? (function findInForest(nodes: typeof forest): typeof forest[number] | undefined {
        for (const n of nodes) {
          if (n.id === regionId) return n;
          const found = findInForest(n.children);
          if (found) return found;
        }
        return undefined;
      })(forest);
    setRemoveDialogState({
      regionId, regionName,
      hasChildren: node?.hasChildren ?? false,
      hasDivisions: (node?.memberCount ?? 0) > 0,
    });
  }, [forest]);

  const treeCallbacks = {
    onDemote: handleDemote,
    onPromote: handlePromote,
    onAddChild: handleAddChild,
    onRename: handleRename,
    onReparent: handleReparent,
    onRemove: handleRemove,
    isPending,
  };

  return (
    <Box>
      {/* Confirm banner */}
      <Alert
        severity={skeletonConfirmed ? 'success' : 'info'}
        sx={{ mb: 2 }}
        action={
          <Button
            color="inherit"
            size="small"
            disabled={confirmMutation.isPending}
            onClick={() => confirmMutation.mutate(!skeletonConfirmed)}
          >
            {skeletonConfirmed ? 'Unconfirm' : 'Confirm skeleton'}
          </Button>
        }
      >
        {skeletonConfirmed
          ? 'Skeleton confirmed — continents and the work-unit list are settled.'
          : 'Review the work-unit list and resolve unidentified countries, then confirm.'}
      </Alert>

      {/* Skeleton container tree */}
      <Typography variant="h6" gutterBottom>
        Skeleton tree ({units.length} {units.length === 1 ? 'work unit' : 'work units'})
      </Typography>
      {isLoading && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>Loading tree…</Typography>
      )}
      {!isLoading && forest.length === 0 && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>No regions in tree.</Typography>
      )}
      {!isLoading && forest.length > 0 && (
        <Box sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          <SkeletonTree
            nodes={forest}
            units={units}
            callbacks={treeCallbacks}
          />
        </Box>
      )}

      {/* Unidentified worklist */}
      <Typography variant="h6" gutterBottom>
        Unidentified countries ({candidates.length})
      </Typography>
      {!isLoading && candidates.length === 0 && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          None — every unresolved node sits inside a work unit.
        </Typography>
      )}
      <List dense>
        {candidates.map(c => (
          <ListItem
            key={c.id}
            secondaryAction={
              <Tooltip title="Promote to work unit">
                <Switch
                  size="small"
                  checked={false}
                  disabled={isPending}
                  onChange={() => toggleMutation.mutate({ regionId: c.id, isWorkUnit: true })}
                />
              </Tooltip>
            }
          >
            <ListItemText primary={c.name} secondary={c.matchStatus ?? undefined} />
          </ListItem>
        ))}
      </List>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 3 }}>
        Resolve matches for these in the legacy match tree; promote ones that should be countries.
      </Typography>

      {/* Work units list (demote) */}
      <Typography variant="h6" gutterBottom>Work units ({units.length})</Typography>
      <List dense>
        {units.map(u => (
          <ListItem
            key={u.regionId}
            secondaryAction={
              <Tooltip title="Demote (resets sign-off lifecycle)">
                <Switch
                  size="small"
                  checked
                  disabled={isPending}
                  onChange={() => handleDemote(u.regionId)}
                />
              </Tooltip>
            }
          >
            <ListItemText primary={u.name} secondary={u.continent ?? undefined} />
            {!u.hasReference && (
              <Chip label="no reference" size="small" color="error" variant="outlined" />
            )}
          </ListItem>
        ))}
      </List>

      {/* ── Dialog layer ──────────────────────────────────────────────── */}
      <RemoveRegionDialog
        state={removeDialogState}
        onClose={() => setRemoveDialogState(null)}
        onConfirm={(rid, reparentChildren, reparentDivisions) =>
          mutations.removeMutation.mutate({ regionId: rid, reparentChildren, reparentDivisions })
        }
        isPending={mutations.removeMutation.isPending}
      />
      <RenameRegionDialog
        state={dialogs.renameDialog}
        onClose={() => dialogs.setRenameDialog(null)}
        onSubmit={dialogs.handleRenameSubmit}
        onNameChange={(name) => dialogs.setRenameDialog(prev => prev ? { ...prev, newName: name } : prev)}
      />
      <ReparentRegionDialog
        state={dialogs.reparentDialog}
        onClose={() => dialogs.setReparentDialog(null)}
        onSubmit={dialogs.handleReparentSubmit}
        onParentChange={(id) => dialogs.setReparentDialog(prev => prev ? { ...prev, selectedParentId: id } : prev)}
        flatRegionList={dialogs.flatRegionList}
      />
      <AddChildDialog
        parentRegionId={dialogs.addChildDialogRegionId}
        name={dialogs.addChildName}
        onNameChange={dialogs.setAddChildName}
        onClose={() => { dialogs.setAddChildDialogRegionId(null); dialogs.setAddChildName(''); }}
        onSubmit={() => {
          if (dialogs.addChildDialogRegionId && dialogs.addChildName.trim()) {
            mutations.addChildMutation.mutate({
              parentRegionId: dialogs.addChildDialogRegionId,
              name: dialogs.addChildName.trim(),
            });
            dialogs.setAddChildDialogRegionId(null);
            dialogs.setAddChildName('');
          }
        }}
        isPending={mutations.addChildMutation.isPending}
      />
    </Box>
  );
}

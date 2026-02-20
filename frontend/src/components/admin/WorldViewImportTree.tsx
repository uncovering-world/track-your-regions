/**
 * WorldView Import Tree View
 *
 * Clean hierarchical tree showing match results at the country level.
 * Containers (continents, sub-regions) show summary counts.
 * Countries show their match status and GADM assignment.
 * Children of drilled-down regions appear as regular country nodes.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
} from '@mui/material';

import {
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon,
  ErrorOutline as UnresolvedIcon,
  Layers as GapsIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMatchTree,
  acceptMatch,
  acceptBatchMatches,
  rejectSuggestion,
  dbSearchOneRegion,
  aiMatchOneRegion,
  dismissChildren,
  undoLastOperation,
  syncInstances,
  handleAsGrouping,
  geocodeMatchRegion,
  resetMatchRegion,
  rejectRemaining,
  acceptAndRejectRest as acceptAndRejectRestApi,
  selectMapImage,
  markManualFix,
  type MatchTreeNode,
} from '../../api/adminWorldViewImport';
import { MapImagePickerDialog } from './MapImagePickerDialog';
import { type ShadowInsertion } from './treeNodeShared';
import { TreeNodeRow } from './TreeNodeRow';
import { collectAncestorsOfUnresolved, collectAncestorsOfIds } from './importTreeUtils';

/** Extracted to avoid re-rendering the entire tree on every keystroke */
function ManualFixDialog({ state, onClose, onSubmit, isPending }: {
  state: { regionId: number; regionName: string } | null;
  onClose: () => void;
  onSubmit: (regionId: number, fixNote: string | undefined) => void;
  isPending: boolean;
}) {
  const [fixNote, setFixNote] = useState('');

  // Reset note when dialog opens with a new region
  const prevRegionId = state?.regionId;
  const [lastRegionId, setLastRegionId] = useState<number | undefined>();
  if (prevRegionId !== lastRegionId) {
    setLastRegionId(prevRegionId);
    if (prevRegionId != null) setFixNote('');
  }

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Mark as Needing Manual Fix</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {state?.regionName}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          label="What needs to be fixed?"
          placeholder="e.g., Borders don't match GADM, need to split into sub-regions..."
          value={fixNote}
          onChange={(e) => setFixNote(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => {
            if (state) {
              onSubmit(state.regionId, fixNote || undefined);
              onClose();
            }
          }}
          disabled={isPending}
        >
          Mark for Fix
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface WorldViewImportTreeProps {
  worldViewId: number;
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean) => void;
  shadowInsertions?: ShadowInsertion[];
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
}

export function WorldViewImportTree({ worldViewId, onPreview, shadowInsertions, onApproveShadow, onRejectShadow }: WorldViewImportTreeProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const skipAnimationRef = useRef(false);
  const [geocodeProgress, setGeocodeProgress] = useState<{ regionId: number; message: string } | null>(null);
  const [fixDialogState, setFixDialogState] = useState<{ regionId: number; regionName: string } | null>(null);
  const [mapPickerState, setMapPickerState] = useState<{
    regionId: number;
    regionName: string;
    candidates: string[];
    currentSelection: string | null;
    wikidataId: string | null;
    pendingPreview?: {
      divisionId: number;
      name: string;
      path?: string;
      isAssigned: boolean;
    };
  } | null>(null);

  const [undoSnackbar, setUndoSnackbar] = useState<{
    open: boolean;
    message: string;
    worldViewId: number;
  } | null>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
  });

  const invalidateTree = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
  };

  const acceptMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptMatch(worldViewId, regionId, divisionId),
    onSuccess: invalidateTree,
  });

  const rejectMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      rejectSuggestion(worldViewId, regionId, divisionId),
    onSuccess: invalidateTree,
  });

  const dbSearchOneMutation = useMutation({
    mutationFn: (regionId: number) => dbSearchOneRegion(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const aiMatchOneMutation = useMutation({
    mutationFn: (regionId: number) => aiMatchOneRegion(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const dismissMutation = useMutation({
    mutationFn: (regionId: number) => dismissChildren(worldViewId, regionId),
    onSuccess: (data) => {
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Dismissed ${data.dismissed} descendant(s)`,
          worldViewId,
        });
      }
    },
  });

  const syncMutation = useMutation({
    mutationFn: (regionId: number) => syncInstances(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const groupingMutation = useMutation({
    mutationFn: (regionId: number) => handleAsGrouping(worldViewId, regionId),
    onSuccess: (data) => {
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Matched ${data.matched}/${data.total} children`,
          worldViewId,
        });
      }
    },
  });

  const undoMutation = useMutation({
    mutationFn: () => undoLastOperation(worldViewId),
    onSuccess: () => {
      setUndoSnackbar(null);
      invalidateTree();
    },
  });

  const geocodeMatchMutation = useMutation({
    mutationFn: (regionId: number) => geocodeMatchRegion(worldViewId, regionId),
    onMutate: (regionId) => {
      setGeocodeProgress({ regionId, message: 'Geocoding via Nominatim...' });
    },
    onSuccess: (data, regionId) => {
      if (data.geocodedName) {
        const radiusMsg = data.searchRadiusKm
          ? ` within ${data.searchRadiusKm}km`
          : ' (exact)';
        setGeocodeProgress({
          regionId,
          message: data.found > 0
            ? `Found ${data.found} division(s)${radiusMsg}`
            : `No divisions found — ${data.geocodedName}`,
        });
      } else {
        setGeocodeProgress({ regionId, message: 'Not found in Nominatim' });
      }
      invalidateTree();
      setTimeout(() => setGeocodeProgress(null), 4000);
    },
    onError: () => {
      setGeocodeProgress(null);
    },
  });

  const resetMatchMutation = useMutation({
    mutationFn: (regionId: number) => resetMatchRegion(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const rejectRemainingMutation = useMutation({
    mutationFn: (regionId: number) => rejectRemaining(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const acceptAndRejectRestMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptAndRejectRestApi(worldViewId, regionId, divisionId),
    onSuccess: invalidateTree,
  });

  const acceptAllMutation = useMutation({
    mutationFn: (assignments: Array<{ regionId: number; divisionId: number }>) =>
      acceptBatchMatches(worldViewId, assignments),
    onSuccess: invalidateTree,
  });

  const selectMapMutation = useMutation({
    mutationFn: ({ regionId, imageUrl }: { regionId: number; imageUrl: string | null }) =>
      selectMapImage(worldViewId, regionId, imageUrl),
    onSuccess: (_data, variables) => {
      const pending = mapPickerState?.pendingPreview;
      const wikidataId = mapPickerState?.wikidataId;
      const pickerRegionId = mapPickerState?.regionId;
      setMapPickerState(null);
      invalidateTree();
      // If preview was intercepted, proceed to the regular preview now
      if (pending) {
        onPreview(
          pending.divisionId,
          pending.name,
          pending.path,
          variables.imageUrl ?? undefined,
          wikidataId ?? undefined,
          pickerRegionId,
          pending.isAssigned,
        );
      }
    },
  });

  const manualFixMutation = useMutation({
    mutationFn: ({ regionId, needsManualFix, fixNote }: { regionId: number; needsManualFix: boolean; fixNote?: string }) =>
      markManualFix(worldViewId, regionId, needsManualFix, fixNote),
    onSuccess: invalidateTree,
  });

  const handleOpenMapPicker = useCallback((node: MatchTreeNode, pendingPreview?: { divisionId: number; name: string; path?: string; isAssigned: boolean }) => {
    setMapPickerState({
      regionId: node.id,
      regionName: node.name,
      candidates: node.mapImageCandidates,
      currentSelection: node.regionMapUrl,
      wikidataId: node.wikidataId,
      pendingPreview,
    });
  }, []);

  // Compute which sourceUrls appear on multiple nodes (duplicates)
  // and which are already synced (same matchStatus and same division set)
  const { duplicateUrls, syncedUrls } = useMemo(() => {
    if (!tree) return { duplicateUrls: new Set<string>(), syncedUrls: new Set<string>() };
    const urlNodes = new Map<string, MatchTreeNode[]>();
    function walk(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.sourceUrl) {
          const existing = urlNodes.get(node.sourceUrl);
          if (existing) existing.push(node);
          else urlNodes.set(node.sourceUrl, [node]);
        }
        walk(node.children);
      }
    }
    walk(tree);
    const dups = new Set<string>();
    const synced = new Set<string>();
    for (const [url, nodes] of urlNodes) {
      if (nodes.length > 1) {
        dups.add(url);
        // Check if all instances have the same matchStatus and same set of divisionIds
        const refStatus = nodes[0].matchStatus;
        const refDivs = nodes[0].assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',');
        const allSame = nodes.every(n =>
          n.matchStatus === refStatus &&
          n.assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',') === refDivs,
        );
        if (allSame) synced.add(url);
      }
    }
    return { duplicateUrls: dups, syncedUrls: synced };
  }, [tree]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allBranchIds = useMemo(() => {
    if (!tree) return new Set<number>();
    const ids = new Set<number>();
    function walk(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.add(node.id);
          walk(node.children);
        }
      }
    }
    walk(tree);
    return ids;
  }, [tree]);

  const expandAll = useCallback(() => {
    skipAnimationRef.current = true;
    setExpanded(new Set(allBranchIds));
    requestAnimationFrame(() => { skipAnimationRef.current = false; });
  }, [allBranchIds]);

  const collapseAll = useCallback(() => {
    skipAnimationRef.current = true;
    setExpanded(new Set());
    requestAnimationFrame(() => { skipAnimationRef.current = false; });
  }, []);

  const expandToUnresolved = useCallback(() => {
    if (!tree) return;
    skipAnimationRef.current = true;
    setExpanded(collectAncestorsOfUnresolved(tree));
    requestAnimationFrame(() => { skipAnimationRef.current = false; });
  }, [tree]);

  const expandToShadows = useCallback(() => {
    if (!tree || !shadowInsertions?.length) return;
    skipAnimationRef.current = true;
    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    setExpanded(new Set([...ancestorIds, ...targetIds]));
    // Scroll to first target
    requestAnimationFrame(() => {
      skipAnimationRef.current = false;
      setTimeout(() => {
        const firstId = shadowInsertions[0].targetRegionId;
        document.querySelector(`[data-region-id="${firstId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });
  }, [tree, shadowInsertions]);

  // Compute per-region shadow map
  const shadowsByRegionId = useMemo(() => {
    const map = new Map<number, ShadowInsertion[]>();
    for (const s of shadowInsertions ?? []) {
      const arr = map.get(s.targetRegionId) ?? [];
      arr.push(s);
      map.set(s.targetRegionId, arr);
    }
    return map;
  }, [shadowInsertions]);

  // Auto-expand tree ancestors when shadow insertions appear
  const prevShadowCount = useRef(0);
  useEffect(() => {
    if (!tree || !shadowInsertions?.length) {
      prevShadowCount.current = 0;
      return;
    }
    if (prevShadowCount.current === shadowInsertions.length) return;
    prevShadowCount.current = shadowInsertions.length;

    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    // Also expand the target nodes themselves (for create_region, shadows appear as children)
    setExpanded(prev => new Set([...prev, ...ancestorIds, ...targetIds]));

    // Scroll to first target
    requestAnimationFrame(() => {
      setTimeout(() => {
        const firstId = shadowInsertions[0].targetRegionId;
        document.querySelector(`[data-region-id="${firstId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });
  }, [tree, shadowInsertions]);

  const isMutating = acceptMutation.isPending || rejectMutation.isPending || acceptAndRejectRestMutation.isPending || dismissMutation.isPending || syncMutation.isPending || groupingMutation.isPending || geocodeMatchMutation.isPending || resetMatchMutation.isPending || rejectRemainingMutation.isPending || acceptAllMutation.isPending || selectMapMutation.isPending || manualFixMutation.isPending;

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!tree || tree.length === 0) {
    return <Typography color="text.secondary">No regions found.</Typography>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ExpandAllIcon />} onClick={expandAll}>
          Expand All
        </Button>
        <Button size="small" startIcon={<CollapseAllIcon />} onClick={collapseAll}>
          Collapse All
        </Button>
        <Button size="small" startIcon={<UnresolvedIcon />} onClick={expandToUnresolved} color="warning">
          Show Unresolved
        </Button>
        {shadowInsertions && shadowInsertions.length > 0 && (
          <Button size="small" startIcon={<GapsIcon />} onClick={expandToShadows} color="info">
            Show {shadowInsertions.length} Gap{shadowInsertions.length !== 1 ? 's' : ''} to Review
          </Button>
        )}
      </Box>
      {tree.map(node => (
        <TreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          ancestorIsMatched={false}
          onToggle={toggleExpand}
          onAccept={(regionId, divisionId) => acceptMutation.mutate({ regionId, divisionId })}
          onAcceptAndRejectRest={(regionId, divisionId) => acceptAndRejectRestMutation.mutate({ regionId, divisionId })}
          onReject={(regionId, divisionId) => rejectMutation.mutate({ regionId, divisionId })}
          onDBSearch={(regionId) => dbSearchOneMutation.mutate(regionId)}
          onAIMatch={(regionId) => aiMatchOneMutation.mutate(regionId)}
          onDismissChildren={(regionId) => dismissMutation.mutate(regionId)}
          onSync={(regionId) => syncMutation.mutate(regionId)}
          onHandleAsGrouping={(regionId) => groupingMutation.mutate(regionId)}
          onGeocodeMatch={(regionId) => geocodeMatchMutation.mutate(regionId)}
          onResetMatch={(regionId) => resetMatchMutation.mutate(regionId)}
          onRejectRemaining={(regionId) => rejectRemainingMutation.mutate(regionId)}
          onAcceptAll={(assignments) => acceptAllMutation.mutate(assignments)}
          onPreview={onPreview}
          onOpenMapPicker={handleOpenMapPicker}
          onManualFix={(regionId, needsManualFix) => {
            if (needsManualFix) {
              // Find the node name for the dialog title
              const findName = (nodes: MatchTreeNode[]): string => {
                for (const n of nodes) {
                  if (n.id === regionId) return n.name;
                  const found = findName(n.children);
                  if (found) return found;
                }
                return '';
              };
              setFixDialogState({ regionId, regionName: findName(tree!) });
            } else {
              manualFixMutation.mutate({ regionId, needsManualFix: false });
            }
          }}
          isMutating={isMutating}
          dbSearchingRegionId={dbSearchOneMutation.isPending ? (dbSearchOneMutation.variables ?? null) : null}
          aiMatchingRegionId={aiMatchOneMutation.isPending ? (aiMatchOneMutation.variables ?? null) : null}
          dismissingRegionId={dismissMutation.isPending ? (dismissMutation.variables ?? null) : null}
          syncingRegionId={syncMutation.isPending ? (syncMutation.variables ?? null) : null}
          groupingRegionId={groupingMutation.isPending ? (groupingMutation.variables ?? null) : null}
          geocodeMatchingRegionId={geocodeMatchMutation.isPending ? (geocodeMatchMutation.variables ?? null) : null}
          geocodeProgress={geocodeProgress}
          duplicateUrls={duplicateUrls}
          syncedUrls={syncedUrls}
          shadowsByRegionId={shadowsByRegionId}
          onApproveShadow={onApproveShadow}
          onRejectShadow={onRejectShadow}
          skipAnimationRef={skipAnimationRef}
        />
      ))}
      {mapPickerState && (
        <MapImagePickerDialog
          open
          regionName={mapPickerState.regionName}
          candidates={mapPickerState.candidates}
          currentSelection={mapPickerState.currentSelection}
          onSelect={(imageUrl) => selectMapMutation.mutate({ regionId: mapPickerState.regionId, imageUrl })}
          onClose={() => setMapPickerState(null)}
          loading={selectMapMutation.isPending}
        />
      )}
      <Snackbar
        open={!!undoSnackbar?.open}
        autoHideDuration={15000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setUndoSnackbar(null);
        }}
        message={undoSnackbar?.message}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => undoMutation.mutate()}
            disabled={undoMutation.isPending}
          >
            Undo
          </Button>
        }
      />
      <ManualFixDialog
        state={fixDialogState}
        onClose={() => setFixDialogState(null)}
        onSubmit={(regionId, note) => manualFixMutation.mutate({ regionId, needsManualFix: true, fixNote: note })}
        isPending={manualFixMutation.isPending}
      />
    </Box>
  );
}

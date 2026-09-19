/**
 * The dialog that shows what a region's children do not cover: the gaps, the
 * map they sit on, and the two answers each one has — take it into a child, or
 * make a child of it — with the scrollable list split out of the dialog for the
 * nesting it would otherwise carry.
 *
 * Its own file beside `ImportTreeDialogs.tsx`, which had reached the length the
 * lint draws the line at (#933); the region-edit dialogs stay there.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress,
} from '@mui/material';
import type { GapAnalysisState } from './useImportTreeDialogs';
import { GapDivisionTree, GapContextMap } from './GapAnalysis';
import { findNodeById } from './importTreeUtils';
import { mergeGeometries, mergeGeomsIntoSibling } from './CvMatchMap';
import { type MatchTreeNode } from '../../api/admin/worldViewImport';
import { toThumbnailUrl } from '../../utils/imageUrl';

/** Scrollable gap list content — inline helper split out of GapAnalysisDialog for complexity/nesting compliance */
function GapDialogContent({ effectiveState, gapMapSelectedRegionId, subtreeRegions, worldViewId, highlightedGapId, setHighlightedGapId, isMutating, setLastMutatedRegionId, acceptAllMutation, addChildMutation, localModified, setLocalState }: {
  effectiveState: GapAnalysisState;
  gapMapSelectedRegionId: number | null;
  subtreeRegions: Array<{ id: number; name: string; depth: number }>;
  worldViewId: number;
  highlightedGapId: number | null;
  setHighlightedGapId: React.Dispatch<React.SetStateAction<number | null>>;
  isMutating: boolean;
  setLastMutatedRegionId: (id: number) => void;
  acceptAllMutation: { mutate: (assignments: Array<{ regionId: number; divisionId: number }>) => void };
  addChildMutation: { mutate: (args: { parentRegionId: number; name: string }, opts?: { onSuccess?: (result: { regionId: number } | undefined) => void }) => void; isPending: boolean };
  localModified: React.MutableRefObject<boolean>;
  setLocalState: React.Dispatch<React.SetStateAction<GapAnalysisState | null>>;
}) {
  // Remove resolved gaps from local state and optionally fold their geometry into a sibling region
  const removeGapsFromLocalState = useCallback((
    gap: { divisionId: number; name: string; geometry?: GeoJSON.Geometry | null },
    descendantIds: number[],
    apply: (prev: GapAnalysisState, removeIds: Set<number>, removedGeoms: GeoJSON.Geometry[]) => GapAnalysisState,
  ) => {
    const removeIds = new Set([gap.divisionId, ...descendantIds]);
    const removedGeoms = effectiveState.gapDivisions
      .filter(d => removeIds.has(d.divisionId) && d.geometry)
      .map(d => d.geometry!);
    setLocalState(prev => prev ? apply(prev, removeIds, removedGeoms) : prev);
  }, [effectiveState, setLocalState]);

  const handleAssign = useCallback((
    gap: { divisionId: number; name: string; geometry?: GeoJSON.Geometry | null },
    descendantIds: number[],
    targetRegionId: number,
  ) => {
    setLastMutatedRegionId(targetRegionId);
    acceptAllMutation.mutate([{ regionId: targetRegionId, divisionId: gap.divisionId }]);
    localModified.current = true;
    removeGapsFromLocalState(gap, descendantIds, (prev, removeIds, removedGeoms) => ({
      ...prev,
      gapDivisions: prev.gapDivisions.filter(d => !removeIds.has(d.divisionId)),
      siblingRegions: mergeGeomsIntoSibling(prev.siblingRegions, targetRegionId, removedGeoms),
    }));
  }, [acceptAllMutation, localModified, removeGapsFromLocalState, setLastMutatedRegionId]);

  const handleNewRegionSuccess = useCallback((
    gap: { divisionId: number; name: string; geometry?: GeoJSON.Geometry | null },
    descendantIds: number[],
    newRegion: { regionId: number } | undefined,
  ) => {
    if (newRegion?.regionId) {
      setLastMutatedRegionId(newRegion.regionId);
      acceptAllMutation.mutate([{ regionId: newRegion.regionId, divisionId: gap.divisionId }]);
    }
    removeGapsFromLocalState(gap, descendantIds, (prev, removeIds, removedGeoms) => {
      const mergedGeom = mergeGeometries(removedGeoms);
      const newSiblings = mergedGeom && newRegion?.regionId
        ? [...prev.siblingRegions, { regionId: newRegion.regionId, name: gap.name, geometry: mergedGeom }]
        : prev.siblingRegions;
      return {
        ...prev,
        gapDivisions: prev.gapDivisions.filter(d => !removeIds.has(d.divisionId)),
        siblingRegions: newSiblings,
      };
    });
  }, [acceptAllMutation, removeGapsFromLocalState, setLastMutatedRegionId]);

  const handleNewRegion = useCallback((
    gap: { divisionId: number; name: string; geometry?: GeoJSON.Geometry | null },
    descendantIds: number[],
  ) => {
    addChildMutation.mutate(
      { parentRegionId: effectiveState.regionId, name: gap.name },
      { onSuccess: (newRegion) => handleNewRegionSuccess(gap, descendantIds, newRegion) },
    );
  }, [addChildMutation, effectiveState.regionId, handleNewRegionSuccess]);

  if (effectiveState.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (effectiveState.gapDivisions.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No gap divisions found.
      </Typography>
    );
  }
  return (
    <GapDivisionTree
      gapDivisions={effectiveState.gapDivisions}
      parentRegionId={effectiveState.regionId}
      parentRegionName={effectiveState.regionName}
      mapSelectedRegionId={gapMapSelectedRegionId}
      subtreeRegions={subtreeRegions}
      worldViewId={worldViewId}
      highlightedGapId={highlightedGapId}
      onHighlight={setHighlightedGapId}
      isMutating={isMutating}
      onAssign={handleAssign}
      onNewRegion={handleNewRegion}
    />
  );
}

/** Full-screen dialog for coverage gap analysis with map and division tree */
export function GapAnalysisDialog({ state, tree, worldViewId, highlightedGapId, setHighlightedGapId, gapMapSelectedRegionId, setGapMapSelectedRegionId, onClose, setLastMutatedRegionId, acceptAllMutation, addChildMutation, isMutating }: {
  state: GapAnalysisState | null;
  tree: MatchTreeNode[] | undefined;
  worldViewId: number;
  highlightedGapId: number | null;
  setHighlightedGapId: React.Dispatch<React.SetStateAction<number | null>>;
  gapMapSelectedRegionId: number | null;
  setGapMapSelectedRegionId: React.Dispatch<React.SetStateAction<number | null>>;
  onClose: () => void;
  setLastMutatedRegionId: (id: number) => void;
  acceptAllMutation: { mutate: (assignments: Array<{ regionId: number; divisionId: number }>) => void };
  addChildMutation: { mutate: (args: { parentRegionId: number; name: string }, opts?: { onSuccess?: (result: { regionId: number } | undefined) => void }) => void; isPending: boolean };
  isMutating: boolean;
}) {
  // Local state setter used from callbacks to remove gaps after assignment.
  // Syncs from external state on open and when loading completes, but preserves
  // local modifications (e.g. removed gaps) while not loading.
  const [localState, setLocalState] = useState<GapAnalysisState | null>(null);
  const localModified = useRef(false);

  // Sync external state → local state when region changes or loading status changes
  useEffect(() => {
    if (!state) { setLocalState(null); localModified.current = false; return; }
    // Always sync loading state and fresh results; only skip if user made local edits
    if (state.loading || !localModified.current) {
      setLocalState(state);
    }
  }, [state?.regionId, state?.loading]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally exclude `state` itself; we only want to resync on region change or loading transitions, not on every state mutation

  const effectiveState = localState?.regionId === state?.regionId ? localState : state;

  if (!effectiveState) return null;

  // The stored map is wiki content: drawn only as toThumbnailUrl allows (#694).
  const mapSrc = effectiveState.regionMapUrl ? toThumbnailUrl(effectiveState.regionMapUrl, 800) : '';

  const subtreeRegions = (() => {
    if (!tree) return [];
    const parent = findNodeById(tree, effectiveState.regionId);
    if (!parent) return [];
    const result: Array<{ id: number; name: string; depth: number }> = [];
    const walk = (nodes: MatchTreeNode[], depth: number) => {
      for (const n of nodes) {
        result.push({ id: n.id, name: n.name, depth });
        walk(n.children, depth + 1);
      }
    };
    walk(parent.children, 0);
    return result;
  })();

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { height: '90vh', display: 'flex', flexDirection: 'column' } } }}
    >
      <DialogTitle sx={{ pb: 1, flexShrink: 0 }}>Coverage Gap Analysis: {effectiveState.regionName}</DialogTitle>
      {/* Top: source image + context map side by side (sticky) */}
      <Box sx={{ display: 'flex', gap: 1, px: 3, pb: 1, flexShrink: 0, minHeight: 0 }}>
        {mapSrc && (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              component="img"
              src={mapSrc}
              alt={`${effectiveState.regionName} region map`}
              sx={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 1, border: 1, borderColor: 'divider' }}
            />
          </Box>
        )}
        {!effectiveState.loading && effectiveState.gapDivisions.length > 0 && (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <GapContextMap
              gapDivisions={effectiveState.gapDivisions}
              siblingRegions={effectiveState.siblingRegions}
              worldViewId={worldViewId}
              highlightedGapId={highlightedGapId}
              onHighlight={setHighlightedGapId}
              selectedRegionId={gapMapSelectedRegionId}
              onRegionSelect={(regionId) => setGapMapSelectedRegionId(regionId)}
            />
          </Box>
        )}
      </Box>
      {/* Bottom: scrollable gap list */}
      <DialogContent sx={{ flex: 1, overflow: 'auto', pt: 1 }}>
        <GapDialogContent
          effectiveState={effectiveState}
          gapMapSelectedRegionId={gapMapSelectedRegionId}
          subtreeRegions={subtreeRegions}
          worldViewId={worldViewId}
          highlightedGapId={highlightedGapId}
          setHighlightedGapId={setHighlightedGapId}
          isMutating={isMutating}
          setLastMutatedRegionId={setLastMutatedRegionId}
          acceptAllMutation={acceptAllMutation}
          addChildMutation={addChildMutation}
          localModified={localModified}
          setLocalState={setLocalState}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

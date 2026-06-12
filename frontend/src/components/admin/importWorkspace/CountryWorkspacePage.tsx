/**
 * CountryWorkspacePage — Per-country import workspace.
 * Route: /admin/import/:worldViewId/region/:regionId
 *
 * Layout:
 *   Header row (back, name, status dot, stage chips, sign-off, next-country)
 *   ChecksBar
 *   [40% tree + action panel | 60% WorkspaceMap] (full viewport height minus header)
 *
 * Wiring:
 *   - useTreeMutations + useImportTreeDialogs + ImportTreeDialogs (full dialog layer)
 *   - useWorkspacePreview (preview/comparison suite, ported from legacy WVIR)
 *   - DivisionPreviewDialog for all preview modes (single, union, transfer, view-map)
 *   - VerifyDialog from Plan 2 for sign-off
 *   - MapImagePickerDialog excluded (non-trivial to plumb here; map-image-picker
 *     action in ActionPanel is still available via legacy tree link)
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  ArrowForward as NextIcon,
} from '@mui/icons-material';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import {
  getWorkflowDashboard,
  confirmHierarchy,
  type DashboardUnit,
  type VerifyResult,
} from '../../../api/admin/wvImportWorkflow';
import {
  getMatchTree,
  type MatchTreeNode,
} from '../../../api/admin/worldViewImport';
import { getChildrenCoverage } from '../../../api/admin/wvImportCoverage';
import { DivisionPreviewDialog } from '../../WorldViewEditor/components/dialogs/DivisionPreviewDialog';
import { useWorkspacePreview } from './useWorkspacePreview';
import {
  ManualFixDialog,
  RemoveRegionDialog,
  RenameRegionDialog,
  ReparentRegionDialog,
  AddChildDialog,
  AISuggestChildrenDialog,
  DivisionSearchDialog,
} from '../ImportTreeDialogs';
import { SmartFlattenPreviewDialog } from '../SmartFlattenPreviewDialog';
import { SmartSimplifyDialog } from '../SmartSimplifyDialog';
import { VerifyDialog } from '../importDashboard/VerifyDialog';
import { deriveUnitStatus, groupUnitsByContinent } from '../importDashboard/dashboardUtils';
import { findSubtree, deriveStage } from './workspaceUtils';
import { useTreeMutations, type MapPickerState } from '../useTreeMutations';
import { useImportTreeDialogs } from '../useImportTreeDialogs';
import { useCvMatchPipeline } from '../useCvMatchPipeline';
import { CvMatchDialog } from '../CvMatchDialog';
import { WorkspaceTree } from './WorkspaceTree';
import { SuggestionList } from './SuggestionList';
import { ActionPanel } from './ActionPanel';
import { WorkspaceMap } from './WorkspaceMap';
import { ChecksBar } from './ChecksBar';

// ─── STATUS_DOT (local copy — avoiding circular import with CountryRow) ───────

const STATUS_DOT: Record<string, { glyph: string; color: string; label: string }> = {
  not_started: { glyph: '○', color: 'text.disabled', label: 'not started' },
  in_progress:  { glyph: '◐', color: 'info.main',    label: 'in progress' },
  signed_off:   { glyph: '⬤', color: 'success.main', label: 'signed off'  },
  stale:        { glyph: '⚠', color: 'warning.main', label: 'modified after sign-off' },
};

// ─── WorkspaceHeader ─────────────────────────────────────────────────────────

type ChipColor = 'success' | 'default' | 'warning' | 'info' | 'error' | 'primary' | 'secondary';

function stageColor(s: string): ChipColor {
  if (s === 'done') return 'success';
  if (s === 'hierarchy' || s === 'assignment') return 'warning';
  return 'info';
}

interface WorkspaceHeaderProps {
  worldViewId: number;
  subtreeRoot: MatchTreeNode;
  unit: DashboardUnit | undefined;
  verify: VerifyResult | null;
  stage: string | null;
  nextUnit: DashboardUnit | null;
  onSignOff: () => void;
  onNavigate: (path: string) => void;
}

function WorkspaceHeader({
  worldViewId,
  subtreeRoot,
  unit,
  verify,
  stage,
  nextUnit,
  onSignOff,
  onNavigate,
}: WorkspaceHeaderProps) {
  const queryClient = useQueryClient();
  const unitStatus = unit ? deriveUnitStatus(unit) : 'not_started';
  const dot = STATUS_DOT[unitStatus] ?? STATUS_DOT.not_started;
  const signOffEnabled = unit?.hierarchyConfirmed && verify !== null && verify.blockers.length === 0;

  const hierarchyMutation = useMutation({
    mutationFn: (confirmed: boolean) =>
      confirmHierarchy(worldViewId, unit!.regionId, confirmed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
    },
  });

  function buildHierarchyTooltip(): string {
    if (!unit) return '';
    if (unit.hierarchyConfirmed) return 'Hierarchy confirmed — click to toggle';
    return 'Hierarchy not confirmed — click to toggle';
  }
  const hierarchyTooltip = buildHierarchyTooltip();

  const plainChips: Array<{ label: string; color: ChipColor }> = unit ? [
    {
      label: `Leaves ${unit.leafResolved}/${unit.leafTotal}`,
      color: unit.leafTotal > 0 && unit.leafResolved === unit.leafTotal ? 'success' : 'default',
    },
    ...(stage ? [{ label: `Stage: ${stage}`, color: stageColor(stage) }] : []),
  ] : [];

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1,
      px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
      flexShrink: 0, flexWrap: 'wrap', bgcolor: 'background.paper',
    }}>
      <Button size="small" startIcon={<BackIcon />} onClick={() => onNavigate(`/admin/import/${worldViewId}`)}>
        Dashboard
      </Button>
      <Divider orientation="vertical" flexItem />
      <Tooltip title={dot.label}>
        <Typography sx={{ color: dot.color, fontWeight: 700 }}>{dot.glyph}</Typography>
      </Tooltip>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>{subtreeRoot.name}</Typography>
      {/* Hierarchy chip — clickable toggle with tooltip */}
      {unit && (
        <Tooltip title={hierarchyTooltip}>
          <Chip
            label={`Hierarchy ${unit.hierarchyConfirmed ? '✓' : '✗'}`}
            size="small"
            color={unit.hierarchyConfirmed ? 'success' : 'default'}
            clickable
            onClick={() => hierarchyMutation.mutate(!unit.hierarchyConfirmed)}
            disabled={hierarchyMutation.isPending}
          />
        </Tooltip>
      )}
      {plainChips.map(c => (
        <Chip key={c.label} label={c.label} size="small" color={c.color} />
      ))}
      {unit && !unit.hasReference && (
        <Chip label="no reference" size="small" color="error" variant="outlined" />
      )}
      {unit?.hasReference && (
        <Tooltip title={`Division IDs: ${unit.referenceDivisionIds.join(', ')}`}>
          <Chip
            label={`Reference: ${unit.referenceDivisionIds.length} division(s)`}
            size="small" variant="outlined" color="info"
          />
        </Tooltip>
      )}
      <Box sx={{ flex: 1 }} />
      <Tooltip title={!signOffEnabled ? 'Run checks and confirm hierarchy first' : ''}>
        <span>
          <Button variant="contained" color="success" size="small" disabled={!signOffEnabled} onClick={onSignOff}>
            Sign off
          </Button>
        </span>
      </Tooltip>
      {nextUnit && (
        <Tooltip title={nextUnit.name}>
          <Button
            size="small" endIcon={<NextIcon />}
            onClick={() => onNavigate(`/admin/import/${worldViewId}/region/${nextUnit.regionId}`)}
          >
            Next country
          </Button>
        </Tooltip>
      )}
    </Box>
  );
}

// ─── WorkspaceInner ───────────────────────────────────────────────────────────
// Contains all hooks and rendering; extracted to keep CountryWorkspacePage
// under the cognitive-complexity cap.

interface WorkspaceInnerProps {
  worldViewId: number;
  regionId: number;
  subtreeRoot: MatchTreeNode;
  unit: DashboardUnit | undefined;
  tree: MatchTreeNode[] | undefined;
  nextUnit: DashboardUnit | null;
}

function WorkspaceInner({
  worldViewId,
  regionId,
  subtreeRoot,
  unit,
  tree,
  nextUnit,
}: WorkspaceInnerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Verify state ──────────────────────────────────────────────────────────
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [lastMutationAt, setLastMutationAt] = useState<number>(0);

  const handleMatchChange = useCallback(() => {
    setLastMutationAt(Date.now());
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'verify', worldViewId, regionId] }).catch(() => {});
  }, [queryClient, worldViewId, regionId]);

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedRegionId, setSelectedRegionId] = useState<number>(regionId);
  const [hoveredRegionId, setHoveredRegionId] = useState<number | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);

  // ── Preview suite (all modes: single, union, transfer, view-map) ──────────
  const onPreviewDone = useCallback(() => {
    handleMatchChange();
  }, [handleMatchChange]);

  const preview = useWorkspacePreview(worldViewId, onPreviewDone);

  // Parent-map fallback: for each node in the subtree, store the direct parent's
  // own regionMapUrl/name so the node can fall back to it when it lacks its own.
  // Each node inherits only from its direct parent's own map — inherited maps do
  // not propagate further. Adapted from WorldViewImportTree.tsx:484-498.
  const { parentRegionMapUrlById, parentRegionMapNameById } = useMemo(() => {
    const urlMap = new Map<number, string>();
    const nameMap = new Map<number, string>();
    function walk(nodes: MatchTreeNode[], parentMapUrl: string | null, parentMapName: string | null) {
      for (const node of nodes) {
        if (parentMapUrl) urlMap.set(node.id, parentMapUrl);
        if (parentMapName) nameMap.set(node.id, parentMapName);
        // Only pass THIS node's own map to children — do not propagate inherited maps
        walk(node.children, node.regionMapUrl ?? null, node.regionMapUrl ? node.name : null);
      }
    }
    walk([subtreeRoot], null, null);
    return { parentRegionMapUrlById: urlMap, parentRegionMapNameById: nameMap };
  }, [subtreeRoot]);

  // Wraps handlePreviewDivision: injects parent-map fallback when the node
  // lacks its own regionMapUrl, mirroring the legacy WorldViewImportTree behaviour.
  const handlePreviewDivision = useCallback((
    divisionId: number, name: string, path?: string,
    regionMapUrl?: string, wikidataId?: string,
    regId?: number, isAssigned?: boolean,
    regionMapLabel?: string, regionName?: string,
    markerPoints?: Array<{ name: string; lat: number; lon: number }>,
  ) => {
    const effectiveMapUrl = regionMapUrl ?? (regId != null ? parentRegionMapUrlById.get(regId) : undefined);
    let effectiveMapLabel: string | undefined;
    if (regionMapUrl) {
      effectiveMapLabel = regionMapLabel;
    } else if (regId != null && parentRegionMapUrlById.has(regId)) {
      effectiveMapLabel = `${parentRegionMapNameById.get(regId) ?? 'Parent'} map`;
    } else {
      effectiveMapLabel = regionMapLabel;
    }
    return preview.handlePreviewDivision(
      divisionId, name, path,
      effectiveMapUrl, wikidataId,
      regId, isAssigned,
      effectiveMapLabel, regionName,
      markerPoints,
    );
  }, [preview, parentRegionMapUrlById, parentRegionMapNameById]);

  // ── Remove dialog state ───────────────────────────────────────────────────
  const [removeDialogState, setRemoveDialogState] = useState<{
    regionId: number; regionName: string; hasChildren: boolean; hasDivisions: boolean;
  } | null>(null);

  // ── mapPickerState (no-op — map image picker excluded) ────────────────────
  const [mapPickerState] = useState<MapPickerState | null>(null);
  const mapPickerStateRef = useRef<MapPickerState | null>(null);
  mapPickerStateRef.current = mapPickerState;

  // ── Mutations + dialogs hooks ─────────────────────────────────────────────
  const mutations = useTreeMutations(worldViewId, {
    onPreview: handlePreviewDivision,
    mapPickerStateRef,
    setMapPickerState: () => {},
    setRemoveDialogState,
    onMatchChange: handleMatchChange,
  });

  const dialogs = useImportTreeDialogs(worldViewId, tree, {
    renameMutation: mutations.renameMutation,
    reparentMutation: mutations.reparentMutation,
    setRemoveDialogState,
    setUndoSnackbar: mutations.setUndoSnackbar,
    invalidateTree: mutations.invalidateTree,
  });

  // CV color match / mapshape match pipeline.
  // onComplete invalidates the match tree + dashboard and signals the checks bar,
  // but does NOT auto-open smart-simplify: the workspace lacks a full sibling-
  // geometry view to make that dialog useful in context. Users can invoke
  // smart-simplify explicitly from the Cleanup group if needed.
  const cvPipeline = useCvMatchPipeline(worldViewId, tree, (completedRegionId) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
    handleMatchChange();
    // Keep selectedRegionId on the completed node so the user sees updated suggestions
    setSelectedRegionId(completedRegionId);
  });

  // ── Derived values ────────────────────────────────────────────────────────
  const selectedNode = useMemo(
    () => findSubtree([subtreeRoot], selectedRegionId),
    [subtreeRoot, selectedRegionId],
  );

  // M7: if the selected node was removed (e.g. after a flatten/remove operation),
  // fall back to the unit root so the panel shows something useful.
  useEffect(() => {
    if (!selectedNode) setSelectedRegionId(regionId);
  }, [selectedNode, regionId]);

  const stage = useMemo(
    () => unit ? deriveStage(subtreeRoot, verify) : null,
    [subtreeRoot, unit, verify],
  );

  const hasDuplicateSourceUrl = useMemo(() => {
    if (!selectedNode?.sourceUrl || !tree) return false;
    let count = 0;
    const walk = (nodes: typeof tree): void => {
      for (const n of nodes) {
        if (n.sourceUrl === selectedNode.sourceUrl) count++;
        walk(n.children);
      }
    };
    walk(tree);
    return count > 1;
  }, [selectedNode, tree]);

  // Children coverage query — same cache key + staleTime=Infinity as legacy
  // (WorldViewImportTree.tsx:99-103). The workspace only needs reading; the
  // legacy tree's refreshCoverage mutation maintains the cache on writes.
  const { data: coverageData, isLoading: coverageLoading, isError: coverageError } = useQuery({
    queryKey: ['admin', 'wvImport', 'childrenCoverage', worldViewId],
    queryFn: () => getChildrenCoverage(worldViewId),
    staleTime: Infinity,
  });

  // syncedUrls: port of WorldViewImportTree.tsx:451-481 — computed over the
  // FULL tree (not just the subtree) so cross-country sync detection works.
  const syncedUrls = useMemo<Set<string>>(() => {
    if (!tree) return new Set<string>();
    const urlNodes = new Map<string, MatchTreeNode[]>();
    function walkTree(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.sourceUrl) {
          const existing = urlNodes.get(node.sourceUrl);
          if (existing) existing.push(node);
          else urlNodes.set(node.sourceUrl, [node]);
        }
        walkTree(node.children);
      }
    }
    walkTree(tree);
    const synced = new Set<string>();
    for (const [url, nodes] of urlNodes) {
      if (nodes.length > 1) {
        const refStatus = nodes[0].matchStatus;
        const refDivs = nodes[0].assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',');
        const allSame = nodes.every(n =>
          n.matchStatus === refStatus &&
          n.assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',') === refDivs,
        );
        if (allSame) synced.add(url);
      }
    }
    return synced;
  }, [tree]);

  // Unit's own coverage % for ChecksBar (the unit root is a container node)
  const unitCoveragePct: number | undefined = coverageData?.coverage[String(regionId)];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <WorkspaceHeader
        worldViewId={worldViewId}
        subtreeRoot={subtreeRoot}
        unit={unit}
        verify={verify}
        stage={stage}
        nextUnit={nextUnit}
        onSignOff={() => setVerifyOpen(true)}
        onNavigate={navigate}
      />

      <ChecksBar
        worldViewId={worldViewId}
        unitId={regionId}
        lastMutationAt={lastMutationAt}
        verify={verify}
        onVerifyChange={setVerify}
        coveragePct={unitCoveragePct}
        onFocusBlocker={(kind) => {
          // I8: focus the first affected region for unassigned; select unit root for gaps/overlaps
          if (kind === 'unassigned' && verify?.unassignedLeaves[0]) {
            setSelectedRegionId(verify.unassignedLeaves[0].regionId);
          } else {
            // For gaps/overlaps, fall back to the unit root (map highlighting does the rest)
            setSelectedRegionId(regionId);
          }
        }}
      />

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left column */}
        <Box sx={{
          width: '40%', display: 'flex', flexDirection: 'column',
          borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden',
        }}>
          <Box sx={{ flex: '0 0 40%', overflow: 'hidden', borderBottom: '1px solid', borderColor: 'divider' }}>
            <WorkspaceTree
              root={subtreeRoot}
              selectedId={selectedRegionId}
              hoveredId={hoveredRegionId}
              onSelect={setSelectedRegionId}
              onHover={setHoveredRegionId}
              coverageData={coverageData}
              coverageLoading={coverageLoading}
              coverageError={coverageError}
              onDismissWarnings={(id) => mutations.dismissWarningsMutation.mutate(id)}
            />
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            {selectedNode && (
              <>
                <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    {selectedNode.name}
                  </Typography>
                </Box>
                <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
                  <SuggestionList
                    node={selectedNode}
                    mutations={mutations}
                    onPreview={handlePreviewDivision}
                    onPreviewTransfer={preview.handlePreviewTransfer}
                    onPreviewUnion={preview.handlePreviewUnion}
                    parentMapUrlById={parentRegionMapUrlById}
                    parentMapNameById={parentRegionMapNameById}
                  />
                </Box>
                <ActionPanel
                  worldViewId={worldViewId}
                  node={selectedNode}
                  mutations={mutations}
                  dialogs={dialogs}
                  hasDuplicateSourceUrl={hasDuplicateSourceUrl}
                  syncedUrls={syncedUrls}
                  onMatchChange={handleMatchChange}
                  cvPipeline={cvPipeline}
                  onViewMap={preview.handleViewMap}
                  parentMapUrlById={parentRegionMapUrlById}
                  parentMapNameById={parentRegionMapNameById}
                />
              </>
            )}
          </Box>
        </Box>

        {/* Right column: map */}
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          {unit && (
            <WorkspaceMap
              worldViewId={worldViewId}
              unit={{ regionId, referenceDivisionIds: unit.referenceDivisionIds }}
              root={subtreeRoot}
              selectedId={selectedRegionId}
              hoveredId={hoveredRegionId}
              onSelectRegion={setSelectedRegionId}
              onHover={setHoveredRegionId}
              verify={verify}
              onMatchChange={handleMatchChange}
            />
          )}
        </Box>
      </Box>

      {/* ── Dialog layer ─────────────────────────────────────────────────── */}
      {preview.previewState && (
        <DivisionPreviewDialog
          division={{ name: preview.previewState.name, path: preview.previewState.path }}
          geometry={preview.previewGeometry}
          loading={preview.previewLoading}
          onClose={preview.handleClosePreview}
          regionMapUrl={preview.previewState.regionMapUrl}
          regionMapLabel={preview.previewState.regionMapLabel}
          regionName={preview.previewState.regionName}
          wikidataId={preview.previewState.wikidataId}
          markerPoints={preview.previewState.markerPoints}
          worldViewId={worldViewId}
          regionId={preview.previewState.regionId}
          actionPending={preview.actionPending}
          onAccept={preview.dialogHandlers.onAccept}
          onAcceptAndRejectRest={preview.dialogHandlers.onAcceptAndRejectRest}
          onReject={preview.dialogHandlers.onReject}
          onSplitDeeper={preview.onSplitDeeperEnabled ? preview.handleSplitDeeper : undefined}
          onVisionMatch={preview.onVisionMatchEnabled ? preview.handleVisionMatch : undefined}
        />
      )}
      {verifyOpen && unit && (
        <VerifyDialog
          worldViewId={worldViewId}
          unit={unit}
          onClose={() => {
            setVerifyOpen(false);
            queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
          }}
        />
      )}
      <ManualFixDialog
        state={dialogs.fixDialogState}
        onClose={() => dialogs.setFixDialogState(null)}
        onSubmit={(rid, note) => mutations.manualFixMutation.mutate({ regionId: rid, needsManualFix: true, fixNote: note })}
        isPending={mutations.manualFixMutation.isPending}
      />
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
            mutations.addChildMutation.mutate({ parentRegionId: dialogs.addChildDialogRegionId, name: dialogs.addChildName.trim() });
            dialogs.setAddChildDialogRegionId(null);
            dialogs.setAddChildName('');
          }
        }}
        isPending={mutations.addChildMutation.isPending}
      />
      <SmartFlattenPreviewDialog
        open={dialogs.flattenPreview != null}
        regionName={dialogs.flattenPreview?.regionName ?? ''}
        geometry={dialogs.flattenPreview?.geometry ?? null}
        regionMapUrl={dialogs.flattenPreview?.regionMapUrl ?? null}
        descendants={dialogs.flattenPreview?.descendants ?? 0}
        divisions={dialogs.flattenPreview?.divisions ?? 0}
        onConfirm={() => {
          if (dialogs.flattenPreview) {
            mutations.smartFlattenMutation.mutate(dialogs.flattenPreview.regionId);
            dialogs.setFlattenPreview(null);
          }
        }}
        onCancel={() => dialogs.setFlattenPreview(null)}
        confirming={mutations.smartFlattenMutation.isPending}
      />
      {dialogs.smartSimplifyDialog && (
        <SmartSimplifyDialog
          open
          onClose={() => dialogs.setSmartSimplifyDialog(null)}
          worldViewId={worldViewId}
          parentRegionId={dialogs.smartSimplifyDialog.regionId}
          parentRegionName={dialogs.smartSimplifyDialog.regionName}
          regionMapUrl={dialogs.smartSimplifyDialog.regionMapUrl}
          onApplied={() => mutations.invalidateTree(dialogs.smartSimplifyDialog?.regionId)}
        />
      )}
      <AISuggestChildrenDialog
        state={dialogs.suggestChildrenResult}
        onClose={() => dialogs.setSuggestChildrenResult(null)}
        onToggle={(key) => {
          dialogs.setSuggestChildrenResult(prev => {
            if (!prev) return prev;
            const next = new Set(prev.selected);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return { ...prev, selected: next };
          });
        }}
        onSubmit={() => dialogs.setSuggestChildrenResult(null)}
        isPending={false}
        submitLabel="Close"
        submitCaption="Apply actions in the legacy match tree (Plan 4 migrates this)"
      />
      <DivisionSearchDialog
        state={dialogs.divisionSearchDialog}
        onClose={() => dialogs.setDivisionSearchDialog(null)}
        onSelect={(divisionId) => {
          if (dialogs.divisionSearchDialog) {
            mutations.acceptMutation.mutate({ regionId: dialogs.divisionSearchDialog.regionId, divisionId });
            dialogs.setDivisionSearchDialog(null);
          }
        }}
        query={dialogs.divSearchQuery}
        results={dialogs.divSearchResults}
        loading={dialogs.divSearchLoading}
        onInputChange={dialogs.handleDivSearchInput}
      />
      {/* CV color match dialog with SSE progress + suggestions */}
      <CvMatchDialog
        cvMatchDialog={cvPipeline.cvMatchDialog}
        setCVMatchDialog={cvPipeline.setCVMatchDialog}
        onClose={() => cvPipeline.cancelCvMatch()}
        highlightClusterId={cvPipeline.highlightClusterId}
        setHighlightClusterId={cvPipeline.setHighlightClusterId}
        worldViewId={worldViewId}
        invalidateTree={mutations.invalidateTree}
        aiModelOverride={cvPipeline.aiModelOverride}
        setAiModelOverride={cvPipeline.setAiModelOverride}
        modelPickerOpen={cvPipeline.modelPickerOpen}
        setModelPickerOpen={cvPipeline.setModelPickerOpen}
        modelPickerModels={cvPipeline.modelPickerModels}
        setModelPickerModels={cvPipeline.setModelPickerModels}
        modelPickerGlobal={cvPipeline.modelPickerGlobal}
        setModelPickerGlobal={cvPipeline.setModelPickerGlobal}
        modelPickerSelected={cvPipeline.modelPickerSelected}
        setModelPickerSelected={cvPipeline.setModelPickerSelected}
      />
    </Box>
  );
}

// ─── CountryWorkspacePage ──────────────────────────────────────────────────────

export function CountryWorkspacePage() {
  const { worldViewId: wvParam, regionId: regionParam } = useParams();
  const worldViewId = parseInt(wvParam ?? '');
  const regionId = parseInt(regionParam ?? '');
  const navigate = useNavigate();
  const { isAdmin, isLoading: authLoading } = useAuth();

  const { data: dashboard, isLoading: dashLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId],
    queryFn: () => getWorkflowDashboard(worldViewId),
    enabled: Number.isInteger(worldViewId),
  });

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
    enabled: Number.isInteger(worldViewId),
  });

  const unit = useMemo(
    () => dashboard?.units.find(u => u.regionId === regionId),
    [dashboard, regionId],
  );

  const subtreeRoot = useMemo(
    () => tree ? findSubtree(tree, regionId) : null,
    [tree, regionId],
  );

  const nextUnit = useMemo(() => {
    if (!dashboard) return null;
    const groups = groupUnitsByContinent(dashboard.units);
    const ordered = groups.flatMap(g => g.units);
    const idx = ordered.findIndex(u => u.regionId === regionId);
    if (idx === -1) return null;
    for (let i = idx + 1; i < ordered.length; i++) {
      if (ordered[i].signoffStatus !== 'signed_off') return ordered[i];
    }
    return null;
  }, [dashboard, regionId]);

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />;
  if (!Number.isInteger(worldViewId) || !Number.isInteger(regionId)) return <Navigate to="/admin" replace />;

  if (dashLoading || treeLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!subtreeRoot) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Region {regionId} is not part of world view {worldViewId} import tree.
        </Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate(`/admin/import/${worldViewId}`)}>
          Back to dashboard
        </Button>
      </Container>
    );
  }

  return (
    <WorkspaceInner
      key={`${worldViewId}-${regionId}`}
      worldViewId={worldViewId}
      regionId={regionId}
      subtreeRoot={subtreeRoot}
      unit={unit}
      tree={tree}
      nextUnit={nextUnit}
    />
  );
}

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
 *   - DivisionPreviewDialog for preview accept/reject
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import {
  getWorkflowDashboard,
  type DashboardUnit,
  type VerifyResult,
} from '../../../api/admin/wvImportWorkflow';
import {
  getMatchTree,
  acceptMatch,
  rejectSuggestion,
  type MatchTreeNode,
} from '../../../api/admin/worldViewImport';
import { fetchDivisionGeometry } from '../../../api/divisions';
import { DivisionPreviewDialog } from '../../WorldViewEditor/components/dialogs/DivisionPreviewDialog';
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
  const unitStatus = unit ? deriveUnitStatus(unit) : 'not_started';
  const dot = STATUS_DOT[unitStatus] ?? STATUS_DOT.not_started;
  const signOffEnabled = unit?.hierarchyConfirmed && verify !== null && verify.blockers.length === 0;

  const stageChips: Array<{ label: string; color: ChipColor }> = unit ? [
    {
      label: `Hierarchy ${unit.hierarchyConfirmed ? '✓' : '✗'}`,
      color: unit.hierarchyConfirmed ? 'success' : 'default',
    },
    {
      label: `Leaves ${unit.leafResolved}/${unit.leafTotal}`,
      color: unit.leafTotal > 0 && unit.leafResolved === unit.leafTotal ? 'success' : 'default',
    },
    ...(stage ? [{ label: stage, color: stageColor(stage) }] : []),
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
      {stageChips.map(c => (
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

  // ── Preview state ─────────────────────────────────────────────────────────
  const [previewState, setPreviewState] = useState<{
    divisionId: number; name: string; path?: string;
    regionMapUrl?: string; wikidataId?: string; regionId?: number; isAssigned?: boolean;
  } | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handlePreviewDivision = useCallback(async (
    divisionId: number, name: string, path?: string,
    regionMapUrl?: string, wikidataId?: string, regId?: number, isAssigned?: boolean,
  ) => {
    setPreviewState({ divisionId, name, path, regionMapUrl, wikidataId, regionId: regId, isAssigned });
    setPreviewGeometry(null);
    setPreviewLoading(true);
    try {
      const feature = await fetchDivisionGeometry(divisionId, 1, { detail: 'medium' });
      setPreviewGeometry((feature?.geometry as GeoJSON.Geometry) ?? null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewState(null);
    setPreviewGeometry(null);
  }, []);

  // ── Preview mutations ─────────────────────────────────────────────────────
  const onPreviewSuccess = useCallback(() => {
    handleClosePreview();
    handleMatchChange();
  }, [handleClosePreview, handleMatchChange]);

  const previewAcceptMutation = useMutation({
    mutationFn: ({ regionId: rid, divisionId }: { regionId: number; divisionId: number }) =>
      acceptMatch(worldViewId, rid, divisionId),
    onSuccess: () => {
      // Invalidate match tree so SuggestionList reflects the accepted division (I1)
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
      onPreviewSuccess();
    },
  });
  const previewRejectMutation = useMutation({
    mutationFn: ({ regionId: rid, divisionId }: { regionId: number; divisionId: number }) =>
      rejectSuggestion(worldViewId, rid, divisionId),
    onSuccess: () => {
      // Invalidate match tree so SuggestionList reflects the rejected division (I1)
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
      onPreviewSuccess();
    },
  });

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
                  <SuggestionList node={selectedNode} mutations={mutations} onPreview={handlePreviewDivision} />
                </Box>
                <ActionPanel
                  worldViewId={worldViewId}
                  node={selectedNode}
                  mutations={mutations}
                  dialogs={dialogs}
                  hasDuplicateSourceUrl={hasDuplicateSourceUrl}
                  onMatchChange={handleMatchChange}
                  cvPipeline={cvPipeline}
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
      {previewState && (
        <DivisionPreviewDialog
          division={{ name: previewState.name, path: previewState.path }}
          geometry={previewGeometry}
          loading={previewLoading}
          onClose={handleClosePreview}
          regionMapUrl={previewState.regionMapUrl}
          wikidataId={previewState.wikidataId}
          worldViewId={worldViewId}
          regionId={previewState.regionId}
          actionPending={previewAcceptMutation.isPending || previewRejectMutation.isPending}
          onAccept={
            previewState.regionId != null && previewState.divisionId != null
              ? () => previewAcceptMutation.mutate({ regionId: previewState.regionId!, divisionId: previewState.divisionId! })
              : undefined
          }
          onReject={
            previewState.regionId != null && previewState.divisionId != null
              ? () => previewRejectMutation.mutate({ regionId: previewState.regionId!, divisionId: previewState.divisionId! })
              : undefined
          }
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

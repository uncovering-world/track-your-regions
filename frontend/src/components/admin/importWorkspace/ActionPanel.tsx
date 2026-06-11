/**
 * ActionPanel — Stage-grouped action buttons for the selected workspace node.
 *
 * Three groups:
 *   Hierarchy: AI review, rename, reparent, add child, remove, restructure menu.
 *   Assignment: geoshape, points, geocode, DB search, AI match, auto-resolve, division search, grouping.
 *   Cleanup & checks: simplify variants, overlap check, clear members, reset match,
 *                     waive toggle, manual-fix, sync.
 *
 * No map-image-picker action (excluded: requires MapImagePickerDialog wiring that
 * is non-trivial to plumb here without extra context — see commit body).
 *
 * Undo snackbar: mirrors the legacy tree's Snackbar + Undo button.
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Divider,
  Link,
  Menu,
  MenuItem,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Psychology as AIIcon,
  Edit as RenameIcon,
  AccountTree as ReparentIcon,
  Add as AddIcon,
  Delete as RemoveIcon,
  TuneRounded as RestructureIcon,
  Search as SearchIcon,
  LocationOn as GeoIcon,
  Place as PointIcon,
  MyLocation as GeocodeIcon,
  Storage as DBIcon,
  AutoFixHigh as AIMatchIcon,
  AutoMode as AutoIcon,
  Merge as MergeIcon,
  Layers as GroupIcon,
  FilterList as SimplifyIcon,
  ContentCut as OverlapIcon,
  Clear as ClearIcon,
  Refresh as ResetIcon,
  PauseCircle as WaiveIcon,
  Build as FixIcon,
  Sync as SyncIcon,
  CallMerge as CollapseIcon,
  UnfoldLess as PruneIcon,
  ColorLens as CvMatchIcon,
  Map as MapshapeIcon,
} from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setAssignmentWaived } from '../../../api/admin/wvImportWorkflow';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { DivisionOverlapResult } from '../../../api/admin/wvImportTreeOps';
import type { useTreeMutations } from '../useTreeMutations';
import type { useImportTreeDialogs } from '../useImportTreeDialogs';
import type { UseCvMatchPipelineResult } from '../useCvMatchPipeline';
import { OverlapResolutionDialog } from '../OverlapResolutionDialog';

type Mutations = ReturnType<typeof useTreeMutations>;
type Dialogs = ReturnType<typeof useImportTreeDialogs>;

interface ActionPanelProps {
  worldViewId: number;
  node: MatchTreeNode | null;
  mutations: Mutations;
  dialogs: Dialogs;
  /** True when this node has a sourceUrl that might be a duplicate (enables Sync) */
  hasDuplicateSourceUrl?: boolean;
  /** Callback to signal a mutation happened (so ChecksBar can go stale). */
  onMatchChange?: () => void;
  /** CV color match / mapshape match pipeline (from CountryWorkspacePage). */
  cvPipeline?: UseCvMatchPipelineResult;
}

// ─── CV / Mapshape buttons (extracted to keep ActionPanel complexity in budget) ─

interface CvButtonsProps {
  cvPipeline: UseCvMatchPipelineResult;
  regionId: number;
  node: MatchTreeNode;
  hasCvPrereqs: boolean;
  hasMapshapePrereqs: boolean;
  cvBusy: boolean;
  mapshapeBusy: boolean;
  btn: (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts?: { disabled?: boolean; tooltip?: string },
  ) => React.ReactNode;
}

function CvButtons({ cvPipeline, regionId, node, hasCvPrereqs, hasMapshapePrereqs, cvBusy, mapshapeBusy, btn }: CvButtonsProps) {
  let cvTooltip: string | undefined;
  if (!hasCvPrereqs) {
    cvTooltip = node.regionMapUrl ? 'Requires child regions' : 'Requires a region map image (regionMapUrl)';
  }
  let mapshapeTooltip: string | undefined;
  if (!hasMapshapePrereqs) {
    mapshapeTooltip = node.sourceUrl ? 'Requires child regions' : 'Requires a Wikivoyage source URL (sourceUrl)';
  }
  return (
    <>
      {btn(
        cvBusy ? 'CV match running…' : 'CV color match',
        <CvMatchIcon sx={{ fontSize: 14 }} />,
        () => { cvPipeline.handleCVMatch(regionId).catch(() => {}); },
        { disabled: !hasCvPrereqs || cvBusy, tooltip: cvTooltip },
      )}
      {btn(
        mapshapeBusy ? 'Mapshape match running…' : 'Mapshape match',
        <MapshapeIcon sx={{ fontSize: 14 }} />,
        () => { cvPipeline.handleMapshapeMatch(regionId).catch(() => {}); },
        { disabled: !hasMapshapePrereqs || mapshapeBusy, tooltip: mapshapeTooltip },
      )}
    </>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <Typography
      variant="overline"
      sx={{ color: 'text.secondary', fontSize: '0.65rem', px: 0.5, lineHeight: 1.4 }}
    >
      {label}
    </Typography>
  );
}

// ─── ActionPanel ─────────────────────────────────────────────────────────────

export function ActionPanel({
  worldViewId,
  node,
  mutations,
  dialogs,
  hasDuplicateSourceUrl = false,
  onMatchChange,
  cvPipeline,
}: ActionPanelProps) {
  const queryClient = useQueryClient();
  const [restructureMenuAnchor, setRestructureMenuAnchor] = useState<HTMLElement | null>(null);
  // I3: overlap resolution dialog state
  const [overlapDialog, setOverlapDialog] = useState<{
    regionId: number;
    regionName: string;
    regionMapUrl: string | null;
    data: DivisionOverlapResult;
  } | null>(null);
  // M8: simplify success snackbar
  const [simplifySnackbar, setSimplifySnackbar] = useState<string | null>(null);
  // I3: no-overlaps snackbar
  const [noOverlapsSnackbar, setNoOverlapsSnackbar] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'verify', worldViewId] }).catch(() => {});
  };

  const waiveMutation = useMutation({
    mutationFn: ({ regionId, waived }: { regionId: number; waived: boolean }) =>
      setAssignmentWaived(worldViewId, regionId, waived),
    onSuccess: () => {
      invalidate();
      // I6: signal mutation to parent so ChecksBar goes stale
      onMatchChange?.();
    },
  });

  if (!node) {
    return (
      <Box sx={{ p: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Select a node to see actions.
        </Typography>
      </Box>
    );
  }

  const regionId = node.id;
  const hasWikidata = !!node.wikidataId;
  const hasChildren = node.children.length > 0;
  const hasSingleChild = node.children.length === 1;
  const busy = mutations.isMutating;

  // CV pipeline prereqs
  const hasCvPrereqs = !!node.regionMapUrl && hasChildren;
  const hasMapshapePrereqs = !!node.sourceUrl && hasChildren;
  const cvBusy = cvPipeline != null && cvPipeline.cvMatchingRegionId === regionId;
  const mapshapeBusy = cvPipeline != null && cvPipeline.mapshapeMatchingRegionId === regionId;

  // I4: geocodeProgress for this node only
  const geocodeProgress = mutations.geocodeProgress?.regionId === regionId
    ? mutations.geocodeProgress
    : null;

  const btn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts?: { disabled?: boolean; tooltip?: string }
  ) => {
    const button = (
      <Button
        key={label}
        size="small"
        startIcon={icon}
        onClick={onClick}
        disabled={busy || (opts?.disabled ?? false)}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.75rem' }}
      >
        {label}
      </Button>
    );
    if (opts?.tooltip) {
      return (
        <Tooltip key={label} title={opts.tooltip}>
          <span>{button}</span>
        </Tooltip>
      );
    }
    return button;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, overflow: 'auto', p: 0.5 }}>
      {/* ── Hierarchy ───────────────────────────────────────────────────── */}
      <SectionLabel label="Hierarchy" />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {btn('AI review children', <AIIcon sx={{ fontSize: 14 }} />,
          () => { dialogs.handleAISuggestChildren(regionId).catch(() => {}); })}
        {btn('Rename', <RenameIcon sx={{ fontSize: 14 }} />,
          () => dialogs.setRenameDialog({ regionId, currentName: node.name, newName: node.name }))}
        {btn('Reparent', <ReparentIcon sx={{ fontSize: 14 }} />,
          () => {
            const item = dialogs.flatRegionList.find(r => r.id === regionId);
            dialogs.setReparentDialog({ regionId, regionName: item?.name ?? node.name, selectedParentId: null });
          })}
        {btn('Add child', <AddIcon sx={{ fontSize: 14 }} />,
          () => dialogs.handleAddChild(regionId))}
        {btn('Remove', <RemoveIcon sx={{ fontSize: 14 }} />,
          () => dialogs.handleRemoveRegion(regionId))}
        {/* Restructure submenu */}
        <Button
          size="small"
          startIcon={<RestructureIcon sx={{ fontSize: 14 }} />}
          onClick={e => setRestructureMenuAnchor(e.currentTarget)}
          disabled={busy}
          sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.75rem' }}
        >
          Restructure ▾
        </Button>
        <Menu
          anchorEl={restructureMenuAnchor}
          open={!!restructureMenuAnchor}
          onClose={() => setRestructureMenuAnchor(null)}
        >
          <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); mutations.dismissMutation.mutate(regionId); }}>
            <PruneIcon sx={{ fontSize: 14, mr: 1 }} /> Dismiss children
          </MenuItem>
          <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); mutations.pruneMutation.mutate(regionId); }}>
            <PruneIcon sx={{ fontSize: 14, mr: 1 }} /> Prune to leaves
          </MenuItem>
          <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); mutations.collapseToParentMutation.mutate(regionId); }}>
            <CollapseIcon sx={{ fontSize: 14, mr: 1 }} /> Collapse to parent
          </MenuItem>
          <MenuItem
            dense
            disabled={!hasSingleChild}
            onClick={() => { setRestructureMenuAnchor(null); mutations.mergeMutation.mutate(regionId); }}
          >
            <MergeIcon sx={{ fontSize: 14, mr: 1 }} /> Merge single child
          </MenuItem>
          <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); dialogs.handleSmartFlatten(regionId).catch(() => {}); }}>
            <MergeIcon sx={{ fontSize: 14, mr: 1 }} /> Smart flatten
          </MenuItem>
        </Menu>
      </Box>

      <Divider sx={{ my: 0.5 }} />

      {/* ── Assignment ──────────────────────────────────────────────────── */}
      <SectionLabel label="Assignment" />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {btn('Geoshape match', <GeoIcon sx={{ fontSize: 14 }} />,
          () => mutations.geoshapeMatchMutation.mutate({ regionId }),
          { disabled: !hasWikidata, tooltip: !hasWikidata ? 'Requires Wikidata ID' : undefined })}
        {btn('Points match', <PointIcon sx={{ fontSize: 14 }} />,
          () => mutations.pointMatchMutation.mutate({ regionId }),
          { disabled: !hasWikidata, tooltip: !hasWikidata ? 'Requires Wikidata ID' : undefined })}
        {btn('Geocode', <GeocodeIcon sx={{ fontSize: 14 }} />,
          () => mutations.geocodeMatchMutation.mutate(regionId))}
        {btn('DB search', <DBIcon sx={{ fontSize: 14 }} />,
          () => mutations.dbSearchOneMutation.mutate(regionId))}
        {btn('AI match', <AIMatchIcon sx={{ fontSize: 14 }} />,
          () => mutations.aiMatchOneMutation.mutate(regionId))}
        {btn('Auto-resolve subtree', <AutoIcon sx={{ fontSize: 14 }} />,
          () => mutations.autoResolveMutation.mutate(regionId),
          { disabled: !hasChildren, tooltip: !hasChildren ? 'Only for parent nodes' : undefined })}
        {btn('Division search', <SearchIcon sx={{ fontSize: 14 }} />,
          () => dialogs.handleManualDivisionSearch(regionId))}
        {btn('Match children independently', <GroupIcon sx={{ fontSize: 14 }} />,
          () => mutations.groupingMutation.mutate(regionId),
          { disabled: !hasChildren, tooltip: !hasChildren ? 'Only for parent nodes' : undefined })}
        {cvPipeline && <CvButtons cvPipeline={cvPipeline} regionId={regionId} node={node} hasCvPrereqs={hasCvPrereqs} hasMapshapePrereqs={hasMapshapePrereqs} cvBusy={cvBusy} mapshapeBusy={mapshapeBusy} btn={btn} />}
        {/* I4: geocode/geoshape/point progress status + scope-fallback retry link */}
        {geocodeProgress && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              {geocodeProgress.message}
            </Typography>
            {geocodeProgress.nextScope && (
              <Link
                component="button"
                type="button"
                variant="caption"
                onClick={() => {
                  const retry = geocodeProgress.retryType === 'point'
                    ? mutations.pointMatchMutation
                    : mutations.geoshapeMatchMutation;
                  retry.mutate({ regionId, scopeAncestorId: geocodeProgress.nextScope!.ancestorId });
                }}
                sx={{
                  fontSize: '0.65rem',
                  color: 'primary.main',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  background: 'none',
                  border: 0,
                  padding: 0,
                  font: 'inherit',
                  lineHeight: 'inherit',
                  '&:hover': { color: 'primary.dark' },
                }}
              >
                Try wider: {geocodeProgress.nextScope.ancestorName}
              </Link>
            )}
          </Box>
        )}
      </Box>

      <Divider sx={{ my: 0.5 }} />

      {/* ── Cleanup & checks ────────────────────────────────────────────── */}
      <SectionLabel label="Cleanup & checks" />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {/* M8: simplify with success snackbar */}
        {btn('Simplify', <SimplifyIcon sx={{ fontSize: 14 }} />,
          () => mutations.simplifyHierarchyMutation.mutate(regionId, {
            onSuccess: (data) => {
              if (data.replacements.length === 0) {
                setSimplifySnackbar('Nothing to simplify');
              } else {
                const summary = data.replacements
                  .map(r => `${r.parentName} (${r.replacedCount} → 1)`)
                  .join(', ');
                setSimplifySnackbar(`Simplified: ${summary}`);
              }
            },
          }))}
        {btn('Simplify children', <SimplifyIcon sx={{ fontSize: 14 }} />,
          () => mutations.simplifyChildrenMutation.mutate(regionId, {
            onSuccess: (data) => {
              if (data.totalSimplified === 0) {
                setSimplifySnackbar('No children could be simplified');
              } else {
                const summary = data.results.map(r => `${r.regionName} (${r.totalReduced} reduced)`).join(', ');
                setSimplifySnackbar(`Simplified ${data.totalSimplified} children: ${summary}`);
              }
            },
          }),
          { disabled: !hasChildren, tooltip: !hasChildren ? 'Only for parent nodes' : undefined })}
        {btn('Smart simplify', <SimplifyIcon sx={{ fontSize: 14 }} />,
          () => dialogs.handleSmartSimplify(regionId))}
        {/* I3: overlap check — show dialog if overlaps found, snackbar if none */}
        {btn('Overlap check', <OverlapIcon sx={{ fontSize: 14 }} />,
          () => mutations.overlapCheckMutation.mutate(regionId, {
            onSuccess: (data) => {
              if (data.overlaps.length === 0) {
                setNoOverlapsSnackbar(true);
              } else {
                setOverlapDialog({
                  regionId,
                  regionName: node.name,
                  regionMapUrl: node.regionMapUrl ?? null,
                  data,
                });
              }
            },
          }))}
        {btn('Clear members', <ClearIcon sx={{ fontSize: 14 }} />,
          () => mutations.clearMembersMutation.mutate(regionId))}
        {btn('Reset match', <ResetIcon sx={{ fontSize: 14 }} />,
          () => mutations.resetMatchMutation.mutate(regionId))}
        {btn(
          node.assignmentWaived ? 'Unwaive assignment' : 'Waive assignment',
          <WaiveIcon sx={{ fontSize: 14 }} />,
          () => waiveMutation.mutate({ regionId, waived: !node.assignmentWaived }),
        )}
        {btn('Manual-fix flag', <FixIcon sx={{ fontSize: 14 }} />,
          () => dialogs.setFixDialogState({ regionId, regionName: node.name }))}
        {btn('Sync instances', <SyncIcon sx={{ fontSize: 14 }} />,
          () => mutations.syncMutation.mutate(regionId),
          { disabled: !hasDuplicateSourceUrl, tooltip: !hasDuplicateSourceUrl ? 'Only for regions with duplicate sourceUrl' : undefined })}
      </Box>

      {/* ── Undo snackbar ─────────────────────────────────────────────── */}
      <Snackbar
        open={mutations.undoSnackbar?.open ?? false}
        message={mutations.undoSnackbar?.message}
        action={
          <Button
            color="secondary"
            size="small"
            onClick={() => mutations.undoMutation.mutate()}
            disabled={mutations.undoMutation.isPending}
          >
            Undo
          </Button>
        }
        onClose={() => mutations.setUndoSnackbar(null)}
        autoHideDuration={10000}
      />

      {/* M8: simplify success snackbar */}
      <Snackbar
        open={simplifySnackbar !== null}
        message={simplifySnackbar ?? ''}
        onClose={() => setSimplifySnackbar(null)}
        autoHideDuration={5000}
      />

      {/* I3: no-overlaps snackbar */}
      <Snackbar
        open={noOverlapsSnackbar}
        message="No division overlaps found among children"
        onClose={() => setNoOverlapsSnackbar(false)}
        autoHideDuration={4000}
      />

      {/* I3: OverlapResolutionDialog */}
      {overlapDialog && (
        <OverlapResolutionDialog
          open
          onClose={() => setOverlapDialog(null)}
          worldViewId={worldViewId}
          parentRegionId={overlapDialog.regionId}
          parentRegionName={overlapDialog.regionName}
          regionMapUrl={overlapDialog.regionMapUrl}
          overlapData={overlapDialog.data}
          onApplied={() => {
            setOverlapDialog(null);
            invalidate();
          }}
        />
      )}
    </Box>
  );
}

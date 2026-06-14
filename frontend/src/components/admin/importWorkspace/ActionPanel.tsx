/**
 * ActionPanel — Stage-split action components for the selected workspace node.
 *
 * Exports three presentational components, one per stage:
 *   HierarchyTools  — AI review, rename, reparent, add child, remove, restructure menu.
 *   AssignmentTools — Finders (geoshape, points, geocode, DB, AI), auto-resolve,
 *                     division search, grouping, CV/Mapshape (prereq-gated),
 *                     geocode progress line, finder feedback line.
 *   VerificationTools — Simplify variants, overlap check, view-map comparison,
 *                       clear members, reset match, waive, manual-fix, sync.
 *
 * Snackbars (undo, simplify-success, no-overlaps) live in their respective tool
 * component; OverlapResolutionDialog lives in VerificationTools.
 *
 * No map-image-picker action (excluded: requires MapImagePickerDialog wiring that
 * is non-trivial to plumb here without extra context — see commit body).
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Divider,
  Link,
  ListItemIcon,
  ListItemText,
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
  CompareArrows as ViewMapIcon,
} from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setAssignmentWaived } from '../../../api/admin/wvImportWorkflow';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { DivisionOverlapResult } from '../../../api/admin/wvImportTreeOps';
import type { useTreeMutations } from '../useTreeMutations';
import type { useImportTreeDialogs } from '../useImportTreeDialogs';
import type { UseCvMatchPipelineResult } from '../useCvMatchPipeline';
import { OverlapResolutionDialog } from '../OverlapResolutionDialog';
import { ACTION_HELP } from './actionHelp';
import {
  formatFinderFeedback,
  type FinderMethod,
  type FinderFeedback,
} from './finderFeedback';

type Mutations = ReturnType<typeof useTreeMutations>;
type Dialogs = ReturnType<typeof useImportTreeDialogs>;

// ─── Shared prop type (all three tool components receive identical props) ──────

export interface StageToolsProps {
  worldViewId: number;
  node: MatchTreeNode | null;
  mutations: Mutations;
  dialogs: Dialogs;
  /** True when this node has a sourceUrl that might be a duplicate (enables Sync) */
  hasDuplicateSourceUrl?: boolean;
  /**
   * Set of sourceUrls that are already in sync across all instances (from the full
   * tree syncedUrls computation — legacy WorldViewImportTree.tsx:451-481).
   */
  syncedUrls?: Set<string>;
  /** Callback to signal a mutation happened (so ChecksBar can go stale). */
  onMatchChange?: () => void;
  /** CV color match / mapshape match pipeline (from CountryWorkspacePage). */
  cvPipeline?: UseCvMatchPipelineResult;
  /**
   * View map comparison: shows the union of this node's assigned divisions next to
   * its Wikidata geoshape or region map (ported from legacy handleViewMap).
   */
  onViewMap?: (
    regionId: number,
    context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string; divisionIds: number[] },
  ) => void;
  /**
   * Parent-map fallback maps: nodes without their own regionMapUrl/name inherit
   * from the nearest ancestor that has one (ported from CountryWorkspacePage).
   */
  parentMapUrlById?: ReadonlyMap<number, string>;
  parentMapNameById?: ReadonlyMap<number, string>;
  /**
   * Current finder feedback — rendered as an inline colour-coded line below the
   * Assignment buttons (persists until the next run or node change).
   */
  finderFeedback?: FinderFeedback | null;
  /**
   * Called by each finder's onSuccess with the formatted feedback + returned
   * suggestions (for proposedSource tracking) + method name.
   */
  onFinderResult?: (
    feedback: FinderFeedback,
    suggestions: Array<{ divisionId: number }>,
    method: FinderMethod,
  ) => void;
  /**
   * Hierarchy confirm toggle — moved from the old header chip into HierarchyTools.
   * Passed from CountryWorkspacePage so HierarchyTools can render the confirm button.
   */
  hierarchyConfirmed?: boolean;
  onConfirmHierarchy?: (confirmed: boolean) => void;
  confirmHierarchyPending?: boolean;
}

// ─── HelpTip ──────────────────────────────────────────────────────────────────
// Structured tooltip: bold title + description + italic "Requires: …" when disabled.

interface HelpTipProps {
  helpKey: string;
  disabled?: boolean;
  children: React.ReactElement;
}

function HelpTip({ helpKey, disabled, children }: HelpTipProps) {
  const help = ACTION_HELP[helpKey];
  if (!help) return children;

  const content = (
    <Box sx={{ maxWidth: 260 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
        {help.title}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.25 }}>
        {help.description}
      </Typography>
      {disabled && help.requires && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
          Requires: {help.requires}
        </Typography>
      )}
    </Box>
  );

  return (
    <Tooltip
      title={content}
      enterDelay={300}
      placement="top"
      arrow
      disableInteractive
      slotProps={{
        popper: {
          modifiers: [{ name: 'hide', enabled: true }],
          sx: { '&[data-popper-reference-hidden]': { visibility: 'hidden', pointerEvents: 'none' } },
        },
      }}
    >
      <span>{children}</span>
    </Tooltip>
  );
}

// ─── CV / Mapshape buttons (extracted to keep component complexity in budget) ─

interface CvButtonsProps {
  cvPipeline: UseCvMatchPipelineResult;
  regionId: number;
  hasCvPrereqs: boolean;
  hasMapshapePrereqs: boolean;
  cvBusy: boolean;
  mapshapeBusy: boolean;
  busy: boolean;
}

function CvButtons({ cvPipeline, regionId, hasCvPrereqs, hasMapshapePrereqs, cvBusy, mapshapeBusy, busy }: CvButtonsProps) {
  return (
    <>
      <HelpTip helpKey="cvColorMatch" disabled={!hasCvPrereqs}>
        <Button
          size="small"
          startIcon={<CvMatchIcon sx={{ fontSize: 14 }} />}
          onClick={() => { cvPipeline.handleCVMatch(regionId).catch(() => {}); }}
          disabled={busy || !hasCvPrereqs || cvBusy}
          sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.75rem' }}
        >
          {cvBusy ? 'CV match running…' : 'CV color match'}
        </Button>
      </HelpTip>
      <HelpTip helpKey="mapshapeMatch" disabled={!hasMapshapePrereqs}>
        <Button
          size="small"
          startIcon={<MapshapeIcon sx={{ fontSize: 14 }} />}
          onClick={() => { cvPipeline.handleMapshapeMatch(regionId).catch(() => {}); }}
          disabled={busy || !hasMapshapePrereqs || mapshapeBusy}
          sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.75rem' }}
        >
          {mapshapeBusy ? 'Mapshape match running…' : 'Mapshape match'}
        </Button>
      </HelpTip>
    </>
  );
}

// ─── Manual-fix helpers ───────────────────────────────────────────────────────

/** Build the label for the manual-fix toggle button (no nested ternary). */
function buildManualFixLabel(node: MatchTreeNode): string {
  if (!node.needsManualFix) return 'Manual-fix flag';
  if (!node.fixNote) return 'Manual fix: click to clear';
  const note = node.fixNote.length > 30 ? node.fixNote.slice(0, 30) + '…' : node.fixNote;
  return `Manual fix: ${note}`;
}

/** Handle manual-fix toggle: clear when set, open dialog when not set. */
function handleManualFixToggle(
  node: MatchTreeNode,
  regionId: number,
  mutations: Mutations,
  dialogs: Dialogs,
): void {
  if (node.needsManualFix) {
    mutations.manualFixMutation.mutate({ regionId, needsManualFix: false });
  } else {
    dialogs.setFixDialogState({ regionId, regionName: node.name });
  }
}

// ─── Shared btn factory (used inside each stage component) ────────────────────

function makeBtn(
  busy: boolean,
) {
  return function btn(
    label: string,
    helpKey: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts?: { disabled?: boolean },
  ) {
    return (
      <HelpTip key={label} helpKey={helpKey} disabled={opts?.disabled}>
        <Button
          size="small"
          startIcon={icon}
          onClick={onClick}
          disabled={busy || (opts?.disabled ?? false)}
          sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.75rem' }}
        >
          {label}
        </Button>
      </HelpTip>
    );
  };
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────
// Quiet overline caption above a button group.

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      sx={{
        fontSize: '0.6rem',
        letterSpacing: '0.08em',
        color: 'text.secondary',
        lineHeight: 1.5,
        display: 'block',
        mb: 0.25,
      }}
    >
      {children}
    </Typography>
  );
}

// ─── HierarchyTools ──────────────────────────────────────────────────────────
// Stage: Hierarchy — AI review, rename, reparent, add child, remove, restructure.

export function HierarchyTools({
  node,
  mutations,
  dialogs,
  hierarchyConfirmed,
  onConfirmHierarchy,
  confirmHierarchyPending,
}: StageToolsProps) {
  const [restructureMenuAnchor, setRestructureMenuAnchor] = useState<HTMLElement | null>(null);

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
  const hasSingleChild = node.children.length === 1;
  const busy = mutations.isMutating;
  const btn = makeBtn(busy);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto', p: 1 }}>
      {/* Hierarchy confirm toggle — full-width, visually prominent */}
      {onConfirmHierarchy !== undefined && (
        <Tooltip title={hierarchyConfirmed ? 'Hierarchy confirmed — click to toggle' : 'Hierarchy not confirmed — click to toggle'}>
          <span style={{ display: 'block' }}>
            <Button
              fullWidth
              size="small"
              variant={hierarchyConfirmed ? 'contained' : 'outlined'}
              color={hierarchyConfirmed ? 'success' : 'warning'}
              onClick={() => onConfirmHierarchy(!hierarchyConfirmed)}
              disabled={confirmHierarchyPending}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              {hierarchyConfirmed ? 'Hierarchy ✓ confirmed' : 'Hierarchy ✗ — click to confirm'}
            </Button>
          </span>
        </Tooltip>
      )}

      {/* Node actions row */}
      <Box>
        <SectionLabel>Node actions</SectionLabel>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {btn('AI review', 'aiReviewChildren', <AIIcon sx={{ fontSize: 14 }} />,
            () => { dialogs.handleAISuggestChildren(regionId).catch(() => {}); })}
          {btn('Rename', 'rename', <RenameIcon sx={{ fontSize: 14 }} />,
            () => dialogs.setRenameDialog({ regionId, currentName: node.name, newName: node.name }))}
          {btn('Reparent', 'reparent', <ReparentIcon sx={{ fontSize: 14 }} />,
            () => {
              const item = dialogs.flatRegionList.find(r => r.id === regionId);
              dialogs.setReparentDialog({ regionId, regionName: item?.name ?? node.name, selectedParentId: null });
            })}
          {btn('Add child', 'addChild', <AddIcon sx={{ fontSize: 14 }} />,
            () => dialogs.handleAddChild(regionId))}
          {btn('Remove', 'remove', <RemoveIcon sx={{ fontSize: 14 }} />,
            () => dialogs.handleRemoveRegion(regionId))}
          {/* Restructure submenu */}
          <HelpTip helpKey="restructure">
            <Button
              size="small"
              startIcon={<RestructureIcon sx={{ fontSize: 14 }} />}
              onClick={e => setRestructureMenuAnchor(e.currentTarget)}
              disabled={busy}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              Restructure ▾
            </Button>
          </HelpTip>
        </Box>
      </Box>

      <Menu
        anchorEl={restructureMenuAnchor}
        open={!!restructureMenuAnchor}
        onClose={() => setRestructureMenuAnchor(null)}
        slotProps={{ paper: { sx: { maxWidth: 360 } } }}
      >
        <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); mutations.dismissMutation.mutate(regionId); }}>
          <ListItemIcon><PruneIcon sx={{ fontSize: 14 }} /></ListItemIcon>
          <ListItemText
            primary={ACTION_HELP.dismissChildren.title}
            secondary={ACTION_HELP.dismissChildren.description}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); mutations.pruneMutation.mutate(regionId); }}>
          <ListItemIcon><PruneIcon sx={{ fontSize: 14 }} /></ListItemIcon>
          <ListItemText
            primary={ACTION_HELP.pruneToLeaves.title}
            secondary={ACTION_HELP.pruneToLeaves.description}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); mutations.collapseToParentMutation.mutate(regionId); }}>
          <ListItemIcon><CollapseIcon sx={{ fontSize: 14 }} /></ListItemIcon>
          <ListItemText
            primary={ACTION_HELP.collapseToParent.title}
            secondary={ACTION_HELP.collapseToParent.description}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem
          dense
          disabled={!hasSingleChild}
          onClick={() => { setRestructureMenuAnchor(null); mutations.mergeMutation.mutate(regionId); }}
        >
          <ListItemIcon><MergeIcon sx={{ fontSize: 14 }} /></ListItemIcon>
          <ListItemText
            primary={ACTION_HELP.mergeSingleChild.title}
            secondary={ACTION_HELP.mergeSingleChild.description}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem dense onClick={() => { setRestructureMenuAnchor(null); dialogs.handleSmartFlatten(regionId).catch(() => {}); }}>
          <ListItemIcon><MergeIcon sx={{ fontSize: 14 }} /></ListItemIcon>
          <ListItemText
            primary={ACTION_HELP.smartFlatten.title}
            secondary={ACTION_HELP.smartFlatten.description}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
      </Menu>

      {/* Undo snackbar — rendered in Hierarchy because rename/reparent/add/remove all use it */}
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
    </Box>
  );
}

// ─── AssignmentTools ─────────────────────────────────────────────────────────
// Stage: Assignment — all finders + progress + feedback + CV/Mapshape.
// Layout: primary row (Geoshape · Points · AI match) → secondary row
//         (Geocode · DB search · Auto-resolve · Division search · Match children)
//         → CV/Mapshape tertiary (prereq-gated) → feedback line.

export function AssignmentTools({
  node,
  mutations,
  dialogs,
  cvPipeline,
  finderFeedback,
  onFinderResult,
}: StageToolsProps) {
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

  const btn = makeBtn(busy);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto', p: 1 }}>
      {/* Primary finders — Geoshape · Points · AI match (highest-use) */}
      <Box>
        <SectionLabel>Primary finders</SectionLabel>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {btn('Geoshape', 'geoshapeMatch', <GeoIcon sx={{ fontSize: 14 }} />,
            () => mutations.geoshapeMatchMutation.mutate({ regionId }, {
              onSuccess: (data) => {
                const fb = formatFinderFeedback('Geoshape', data.found, 0);
                onFinderResult?.(fb, data.suggestions, 'Geoshape');
              },
            }),
            { disabled: !hasWikidata })}
          {btn('Points', 'pointsMatch', <PointIcon sx={{ fontSize: 14 }} />,
            () => mutations.pointMatchMutation.mutate({ regionId }, {
              onSuccess: (data) => {
                const fb = formatFinderFeedback('Points', data.found, 0);
                onFinderResult?.(fb, data.suggestions, 'Points');
              },
            }),
            { disabled: !hasWikidata })}
          {btn('AI match', 'aiMatch', <AIMatchIcon sx={{ fontSize: 14 }} />,
            () => mutations.aiMatchOneMutation.mutate(regionId, {
              onSuccess: (data) => {
                const suggestions = data.suggestion ? [data.suggestion] : [];
                const found = suggestions.length;
                const fb = formatFinderFeedback('AI match', found, 0);
                onFinderResult?.(fb, suggestions, 'AI match');
              },
            }))}
        </Box>
      </Box>

      {/* Secondary finders — Geocode · DB search · Auto-resolve · Division search · Match children */}
      <Box>
        <SectionLabel>More finders</SectionLabel>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {btn('Geocode', 'geocode', <GeocodeIcon sx={{ fontSize: 14 }} />,
            () => mutations.geocodeMatchMutation.mutate(regionId, {
              onSuccess: (data) => {
                const fb = formatFinderFeedback('Geocode', data.found, 0);
                onFinderResult?.(fb, data.suggestions, 'Geocode');
              },
            }))}
          {btn('DB search', 'dbSearch', <DBIcon sx={{ fontSize: 14 }} />,
            () => mutations.dbSearchOneMutation.mutate(regionId, {
              onSuccess: (data) => {
                const fb = formatFinderFeedback('DB search', data.found, 0);
                onFinderResult?.(fb, data.suggestions, 'DB search');
              },
            }))}
          {btn('Auto-resolve', 'autoResolveSubtree', <AutoIcon sx={{ fontSize: 14 }} />,
            () => mutations.autoResolveMutation.mutate(regionId, {
              onSuccess: (data) => {
                const fb = formatFinderFeedback('Auto-resolve', data.resolved, 0);
                onFinderResult?.(fb, [], 'Auto-resolve');
              },
            }),
            { disabled: !hasChildren })}
          {btn('Division search', 'divisionSearch', <SearchIcon sx={{ fontSize: 14 }} />,
            () => dialogs.handleManualDivisionSearch(regionId))}
          {btn('Match children', 'matchChildrenIndependently', <GroupIcon sx={{ fontSize: 14 }} />,
            () => mutations.groupingMutation.mutate(regionId),
            { disabled: !hasChildren })}
        </Box>
      </Box>

      {/* Tertiary — CV / Mapshape (only when pipeline + prereqs exist) */}
      {cvPipeline && (
        <Box>
          <SectionLabel>Visual finders</SectionLabel>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            <CvButtons
              cvPipeline={cvPipeline}
              regionId={regionId}
              hasCvPrereqs={hasCvPrereqs}
              hasMapshapePrereqs={hasMapshapePrereqs}
              cvBusy={cvBusy}
              mapshapeBusy={mapshapeBusy}
              busy={busy}
            />
          </Box>
        </Box>
      )}

      {/* I4: geocode/geoshape/point progress status + scope-fallback retry link */}
      {geocodeProgress && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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

      {/* Inline finder feedback line (persists until next run or node change) */}
      {finderFeedback && (
        <Typography
          variant="caption"
          sx={{
            fontSize: '0.65rem',
            color: finderFeedback.hasResults ? 'success.main' : 'text.secondary',
            fontStyle: 'italic',
          }}
        >
          {finderFeedback.message}
        </Typography>
      )}
    </Box>
  );
}

// ─── VerificationTools ────────────────────────────────────────────────────────
// Stage: Verification — simplify variants, overlap, view-map, clear, reset,
//                       waive, manual-fix, sync.

export function VerificationTools({
  worldViewId,
  node,
  mutations,
  dialogs,
  hasDuplicateSourceUrl = false,
  syncedUrls,
  onMatchChange,
  onViewMap,
  parentMapUrlById,
  parentMapNameById,
}: StageToolsProps) {
  const queryClient = useQueryClient();
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
  const hasChildren = node.children.length > 0;
  const isLeaf = node.isLeaf || !hasChildren;
  const busy = mutations.isMutating;

  // View map comparison: requires wikidata ID, own map, or an inherited parent map
  const parentMapUrl = parentMapUrlById?.get(regionId);
  const effectiveMapUrl = node.regionMapUrl ?? parentMapUrl;
  const parentLabel = parentMapUrl
    ? `${parentMapNameById?.get(regionId) ?? 'Parent'} map`
    : undefined;
  const effectiveMapLabel: string | undefined = node.regionMapUrl ? undefined : parentLabel;
  const hasViewMapPrereqs = !!node.wikidataId || !!effectiveMapUrl;
  const assignedDivisionIds = node.assignedDivisions.map(d => d.divisionId);

  // Sync: "already in sync" detection
  const isSynced = !!(node.sourceUrl && syncedUrls?.has(node.sourceUrl));

  const waiveHelpKey = node.assignmentWaived ? 'unwaiveAssignment' : 'waiveAssignment';

  const btn = makeBtn(busy);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto', p: 1 }}>
      {/* Section A — Cleanup (safe operations) */}
      <Box>
        <SectionLabel>Cleanup</SectionLabel>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {/* M8: simplify with success snackbar */}
          {btn('Simplify', 'simplify', <SimplifyIcon sx={{ fontSize: 14 }} />,
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
          {btn('Simplify children', 'simplifyChildren', <SimplifyIcon sx={{ fontSize: 14 }} />,
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
            { disabled: !hasChildren })}
          {btn('Smart simplify', 'smartSimplify', <SimplifyIcon sx={{ fontSize: 14 }} />,
            () => dialogs.handleSmartSimplify(regionId))}
          {/* I3: overlap check — show dialog if overlaps found, snackbar if none */}
          {btn('Overlap check', 'overlapCheck', <OverlapIcon sx={{ fontSize: 14 }} />,
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
          {onViewMap && btn(
            'View map', 'viewMapComparison', <ViewMapIcon sx={{ fontSize: 14 }} />,
            () => onViewMap(regionId, {
              wikidataId: node.wikidataId ?? undefined,
              regionMapUrl: effectiveMapUrl,
              regionMapLabel: effectiveMapLabel,
              regionName: node.name,
              divisionIds: assignedDivisionIds,
            }),
            { disabled: !hasViewMapPrereqs },
          )}
        </Box>
      </Box>

      {/* Thin divider with "Destructive" label */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Divider sx={{ flex: 1 }} />
        <Typography
          variant="overline"
          sx={{ fontSize: '0.58rem', letterSpacing: '0.07em', color: 'error.light', lineHeight: 1 }}
        >
          Destructive
        </Typography>
        <Divider sx={{ flex: 1 }} />
      </Box>

      {/* Section B — Destructive actions */}
      <Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {btn('Clear members', 'clearMembers', <ClearIcon sx={{ fontSize: 14 }} />,
            () => mutations.clearMembersMutation.mutate(regionId))}
          {btn('Reset match', 'resetMatch', <ResetIcon sx={{ fontSize: 14 }} />,
            () => mutations.resetMatchMutation.mutate(regionId))}
          {btn(
            node.assignmentWaived ? 'Unwaive' : 'Waive',
            waiveHelpKey,
            <WaiveIcon sx={{ fontSize: 14 }} />,
            () => waiveMutation.mutate({ regionId, waived: !node.assignmentWaived }),
            { disabled: !isLeaf },
          )}
          {/* Manual-fix toggle */}
          {btn(
            buildManualFixLabel(node),
            'manualFixFlag',
            <FixIcon sx={{ fontSize: 14, color: node.needsManualFix ? 'error.main' : undefined }} />,
            () => handleManualFixToggle(node, regionId, mutations, dialogs),
          )}
        </Box>
      </Box>

      {/* Section C — Sync (only meaningful when duplicates exist) */}
      {hasDuplicateSourceUrl && (
        <Box>
          <SectionLabel>Sync</SectionLabel>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {/* Sync — disabled with "Already in sync" when syncedUrls has this sourceUrl */}
            <Tooltip
              title={isSynced ? 'Already in sync' : ''}
              placement="top"
              disableInteractive
              slotProps={{
                popper: {
                  modifiers: [{ name: 'hide', enabled: true }],
                  sx: { '&[data-popper-reference-hidden]': { visibility: 'hidden', pointerEvents: 'none' } },
                },
              }}
            >
              <span>
                {btn('Sync instances', 'syncInstances', <SyncIcon sx={{ fontSize: 14 }} />,
                  () => mutations.syncMutation.mutate(regionId),
                  { disabled: isSynced })}
              </span>
            </Tooltip>
          </Box>
        </Box>
      )}

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

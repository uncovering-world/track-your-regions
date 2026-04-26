import {
  Box,
  Chip,
  IconButton,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  Search as SearchIcon,
  AutoFixHigh as AIIcon,
  LayersClear as DismissChildrenIcon,
  SyncAlt as SyncIcon,
  AccountTree as GroupingIcon,
  Place as GeocodeIcon,
  Terrain as GeoshapeIcon,
  RestartAlt as ResetIcon,
  Build as ManualFixIcon,
  CallMerge as MergeIcon,
  Compress as SmartFlattenIcon,
  CheckCircleOutline as DismissWarningsIcon,
  AddCircleOutline as AddChildIcon,
  DeleteOutline as RemoveRegionIcon,
  VerticalAlignTop as CollapseToParentIcon,
  AutoFixHigh as AutoResolveIcon,
  Psychology as ReviewSubtreeIcon,
  Edit as RenameIcon,
  DriveFileMove as ReparentIcon,
  AutoAwesome as SuggestChildrenIcon,
  TravelExplore as DivisionSearchIcon,
  ContentCut as PruneToLeavesIcon,
  ScatterPlot as PointMatchIcon,
  Map as ViewMapIcon,
  Palette as CVMatchIcon,
  Layers as MapshapeMatchIcon,
  ClearAll as ClearAssignedIcon,
  LowPriority as SimplifyIcon,
  PlaylistAddCheck as SimplifyChildrenIcon,
  SwapHoriz as SmartSimplifyIcon,
  JoinInner as OverlapCheckIcon,
} from '@mui/icons-material';
import type { ReactNode } from 'react';
import type { MatchTreeNode } from '../../api/admin/worldViewImport';
import { Tooltip } from './treeNodeShared';

interface TreeNodeActionsProps {
  node: MatchTreeNode;
  role: 'container' | 'country' | 'subdivision';
  hasChildren: boolean;
  summary: { resolved: number; total: number } | null;
  ancestorIsMatched: boolean;
  hasDuplicate: boolean;
  syncedUrls: Set<string>;
  isMutating: boolean;
  dbSearchingRegionId: number | null;
  aiMatchingRegionId: number | null;
  dismissingRegionId: number | null;
  syncingRegionId: number | null;
  groupingRegionId: number | null;
  geocodeMatchingRegionId: number | null;
  geoshapeMatchingRegionId: number | null;
  pointMatchingRegionId: number | null;
  nodeGeocodeMsg: string | null;
  nodeGeocodeNextScope?: { ancestorId: number; ancestorName: string };
  nodeGeocodeRetryType?: 'geoshape' | 'point';
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
  onDismissChildren: (regionId: number) => void;
  onSync: (regionId: number) => void;
  onHandleAsGrouping: (regionId: number) => void;
  onGeocodeMatch: (regionId: number) => void;
  onGeoshapeMatch: (regionId: number, scopeAncestorId?: number) => void;
  onPointMatch: (regionId: number, scopeAncestorId?: number) => void;
  onResetMatch: (regionId: number) => void;
  onManualFix: (regionId: number, needsManualFix: boolean) => void;
  onMergeChild?: (regionId: number) => void;
  mergingRegionId?: number | null;
  onSmartFlatten?: (regionId: number) => void;
  flatteningRegionId?: number | null;
  onDismissHierarchyWarnings?: (regionId: number) => void;
  onAddChild?: (parentRegionId: number) => void;
  onRemoveRegion?: (regionId: number) => void;
  removingRegionId?: number | null;
  onCollapseToParent?: (regionId: number) => void;
  collapsingRegionId?: number | null;
  onAutoResolve?: (regionId: number) => void;
  autoResolvingRegionId?: number | null;
  onReviewSubtree?: (regionId: number) => void;
  reviewingRegionId?: number | null;
  onRename?: (regionId: number, currentName: string) => void;
  renamingRegionId?: number | null;
  onReparent?: (regionId: number, currentParentId: number | null) => void;
  reparentingRegionId?: number | null;
  onAISuggestChildren?: (regionId: number) => void;
  aiSuggestingRegionId?: number | null;
  onManualDivisionSearch?: (regionId: number) => void;
  onPruneToLeaves?: (regionId: number) => void;
  pruningRegionId?: number | null;
  onViewMap?: (regionId: number) => void;
  onCVMatch?: (regionId: number) => void;
  cvMatchingRegionId?: number | null;
  onMapshapeMatch?: (regionId: number) => void;
  mapshapeMatchingRegionId?: number | null;
  onClearMembers?: (regionId: number) => void;
  clearingMembersRegionId?: number | null;
  onSimplifyHierarchy?: (regionId: number) => void;
  simplifyingRegionId?: number | null;
  onSimplifyChildren?: (regionId: number) => void;
  simplifyingChildrenRegionId?: number | null;
  onSmartSimplify?: (regionId: number) => void;
  onCheckOverlap?: (regionId: number) => void;
  checkingOverlapRegionId?: number | null;
  /** Whether this is a root node (depth 0) — remove button is hidden for root */
  isRoot?: boolean;
}

/** Geocode + Geoshape + DB search + AI match button group (shared across multiple status blocks) */
function SearchActionButtons({ nodeId, wikidataId, nodeGeocodeMsg, nodeGeocodeNextScope, nodeGeocodeRetryType, isMutating, geocodeMatchingRegionId, geoshapeMatchingRegionId, pointMatchingRegionId, dbSearchingRegionId, aiMatchingRegionId, onGeocodeMatch, onGeoshapeMatch, onPointMatch, onDBSearch, onAIMatch }: {
  nodeId: number;
  wikidataId: string | null;
  nodeGeocodeMsg: string | null;
  nodeGeocodeNextScope?: { ancestorId: number; ancestorName: string };
  nodeGeocodeRetryType?: 'geoshape' | 'point';
  isMutating: boolean;
  geocodeMatchingRegionId: number | null;
  geoshapeMatchingRegionId: number | null;
  pointMatchingRegionId: number | null;
  dbSearchingRegionId: number | null;
  aiMatchingRegionId: number | null;
  onGeocodeMatch: (regionId: number) => void;
  onGeoshapeMatch: (regionId: number, scopeAncestorId?: number) => void;
  onPointMatch: (regionId: number, scopeAncestorId?: number) => void;
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
}) {
  const anySearching = geocodeMatchingRegionId !== null || geoshapeMatchingRegionId !== null || pointMatchingRegionId !== null || dbSearchingRegionId !== null || aiMatchingRegionId !== null;
  return (
    <>
      <Tooltip title={nodeGeocodeMsg ?? 'Geocode match'}>
        <span>
          <IconButton
            size="small"
            onClick={() => onGeocodeMatch(nodeId)}
            disabled={isMutating || anySearching}
            sx={{ p: 0.25 }}
          >
            {geocodeMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <GeocodeIcon sx={{ fontSize: 16 }} />
            }
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={!wikidataId ? 'No Wikidata ID' : 'Geoshape match (spatial)'}>
        <span>
          <IconButton
            size="small"
            onClick={() => onGeoshapeMatch(nodeId)}
            disabled={isMutating || anySearching || !wikidataId}
            sx={{ p: 0.25 }}
          >
            {geoshapeMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <GeoshapeIcon sx={{ fontSize: 16, color: wikidataId ? 'success.main' : undefined }} />
            }
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={!wikidataId ? 'No Wikidata ID' : 'Point match (Wikivoyage markers)'}>
        <span>
          <IconButton
            size="small"
            onClick={() => onPointMatch(nodeId)}
            disabled={isMutating || anySearching || !wikidataId}
            sx={{ p: 0.25 }}
          >
            {pointMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <PointMatchIcon sx={{ fontSize: 16, color: wikidataId ? 'warning.main' : undefined }} />
            }
          </IconButton>
        </span>
      </Tooltip>
      {nodeGeocodeMsg && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: -0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
            {nodeGeocodeMsg}
          </Typography>
          {nodeGeocodeNextScope && (
            <Typography
              variant="caption"
              component="span"
              onClick={() => {
                const retry = nodeGeocodeRetryType === 'point' ? onPointMatch : onGeoshapeMatch;
                retry(nodeId, nodeGeocodeNextScope.ancestorId);
              }}
              sx={{
                fontSize: '0.65rem',
                color: 'primary.main',
                cursor: 'pointer',
                textDecoration: 'underline',
                '&:hover': { color: 'primary.dark' },
              }}
            >
              Try wider: {nodeGeocodeNextScope.ancestorName}
            </Typography>
          )}
        </Box>
      )}
      <Tooltip title="DB search">
        <span>
          <IconButton
            size="small"
            onClick={() => onDBSearch(nodeId)}
            disabled={isMutating || anySearching}
            sx={{ p: 0.25 }}
          >
            {dbSearchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <SearchIcon sx={{ fontSize: 16 }} />
            }
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="AI match">
        <span>
          <IconButton
            size="small"
            onClick={() => onAIMatch(nodeId)}
            disabled={isMutating || anySearching}
            sx={{ p: 0.25 }}
          >
            {aiMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <AIIcon sx={{ fontSize: 16 }} />
            }
          </IconButton>
        </span>
      </Tooltip>
    </>
  );
}

/** Generic tooltip+icon-button action row used by many conditional buttons.
 * Returning null lets the caller write `show && <ActionIconButton ... />` once. */
function ActionIconButton({
  show,
  title,
  onClick,
  loading,
  disabled,
  icon,
  loadingSize = 14,
}: {
  show: boolean;
  title: string;
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
  icon: ReactNode;
  loadingSize?: number;
}) {
  if (!show) return null;
  return (
    <Tooltip title={title}>
      <span>
        <IconButton size="small" onClick={onClick} disabled={disabled} sx={{ p: 0.25 }}>
          {loading ? <CircularProgress size={loadingSize} /> : icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

/** Sync-to-other-instances icon button with dynamic tooltip/disabled state. */
function SyncToInstancesButton({
  role,
  hasDuplicate,
  node,
  syncedUrls,
  isMutating,
  syncingRegionId,
  onSync,
}: {
  role: string;
  hasDuplicate: boolean;
  node: MatchTreeNode;
  syncedUrls: Set<string>;
  isMutating: boolean;
  syncingRegionId: number | null;
  onSync: (id: number) => void;
}) {
  const isMatched =
    node.matchStatus === 'auto_matched' ||
    node.matchStatus === 'manual_matched' ||
    node.matchStatus === 'children_matched';
  if (role !== 'country' || !hasDuplicate || !isMatched) return null;
  const isSynced = !!(node.sourceUrl && syncedUrls.has(node.sourceUrl));
  return (
    <ActionIconButton
      show={true}
      title={isSynced ? 'Already in sync' : 'Sync to other instances'}
      onClick={() => onSync(node.id)}
      loading={syncingRegionId === node.id}
      disabled={isMutating || syncingRegionId !== null || isSynced}
      icon={<SyncIcon sx={{ fontSize: 16 }} />}
    />
  );
}

/** Toggle "needs manual fix" flag icon button. */
function ManualFixButton({
  node,
  isMutating,
  onManualFix,
}: {
  node: MatchTreeNode;
  isMutating: boolean;
  onManualFix: (regionId: number, needsManualFix: boolean, fixNote?: string) => void;
}) {
  if (node.matchStatus == null) return null;
  const tooltipTitle = node.needsManualFix
    ? (node.fixNote ?? 'Needs manual fix — click to clear')
    : 'Mark as needing manual fix';
  return (
    <ActionIconButton
      show={true}
      title={tooltipTitle}
      onClick={() => onManualFix(node.id, !node.needsManualFix)}
      loading={false}
      disabled={isMutating}
      icon={<ManualFixIcon sx={{ fontSize: 16, color: node.needsManualFix ? 'error.main' : 'text.disabled' }} />}
    />
  );
}

/** Country-role status chip (auto/manual/matched). */
function CountryStatusChip({ matchStatus, role }: { matchStatus: MatchTreeNode['matchStatus']; role: string }) {
  if (role !== 'country') return null;
  if (matchStatus === 'auto_matched' || matchStatus === 'children_matched') {
    return <Chip label="matched" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />;
  }
  if (matchStatus === 'manual_matched') {
    return <Chip label="manual" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />;
  }
  return null;
}

/** Container summary (resolved/total) with unresolved warning suffix. */
function ContainerSummary({
  role,
  summary,
  ancestorIsMatched,
}: {
  role: string;
  summary: { resolved: number; total: number } | null | undefined;
  ancestorIsMatched: boolean;
}) {
  if (role !== 'container' || !summary) return null;
  const unresolved = summary.total - summary.resolved;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
      {summary.resolved}/{summary.total} matched
      {unresolved > 0 && !ancestorIsMatched && (
        <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
          ({unresolved} unresolved)
        </Typography>
      )}
    </Typography>
  );
}

export function TreeNodeActions({
  node,
  role,
  hasChildren,
  summary,
  ancestorIsMatched,
  hasDuplicate,
  syncedUrls,
  isMutating,
  dbSearchingRegionId,
  aiMatchingRegionId,
  dismissingRegionId,
  syncingRegionId,
  groupingRegionId,
  geocodeMatchingRegionId,
  geoshapeMatchingRegionId,
  pointMatchingRegionId,
  nodeGeocodeMsg,
  nodeGeocodeNextScope,
  nodeGeocodeRetryType,
  onDBSearch,
  onAIMatch,
  onDismissChildren,
  onSync,
  onHandleAsGrouping,
  onGeocodeMatch,
  onGeoshapeMatch,
  onPointMatch,
  onResetMatch,
  onManualFix,
  onMergeChild,
  mergingRegionId,
  onSmartFlatten,
  flatteningRegionId,
  onDismissHierarchyWarnings,
  onAddChild,
  onRemoveRegion,
  removingRegionId,
  onCollapseToParent,
  collapsingRegionId,
  onAutoResolve,
  autoResolvingRegionId,
  onReviewSubtree,
  reviewingRegionId,
  onRename,
  renamingRegionId,
  onReparent,
  reparentingRegionId,
  onAISuggestChildren,
  aiSuggestingRegionId,
  onManualDivisionSearch,
  onPruneToLeaves,
  pruningRegionId,
  onViewMap,
  onCVMatch,
  cvMatchingRegionId,
  onMapshapeMatch,
  mapshapeMatchingRegionId,
  onClearMembers,
  clearingMembersRegionId,
  onSimplifyHierarchy,
  simplifyingRegionId,
  onSimplifyChildren,
  simplifyingChildrenRegionId,
  onSmartSimplify,
  onCheckOverlap,
  checkingOverlapRegionId,
  isRoot,
}: TreeNodeActionsProps) {
  // Show dismiss button when node has children with unsuccessful match statuses
  const hasUnmatchedChildren = hasChildren && node.children.some(
    c => c.matchStatus === 'needs_review' || c.matchStatus === 'no_candidates' || c.matchStatus === 'suggested',
  );

  const searchButtonProps = {
    nodeId: node.id,
    wikidataId: node.wikidataId,
    nodeGeocodeMsg,
    nodeGeocodeNextScope,
    nodeGeocodeRetryType,
    isMutating,
    geocodeMatchingRegionId,
    geoshapeMatchingRegionId,
    pointMatchingRegionId,
    dbSearchingRegionId,
    aiMatchingRegionId,
    onGeocodeMatch,
    onGeoshapeMatch,
    onPointMatch,
    onDBSearch,
    onAIMatch,
  };

  return (
    <>
      {/* Container summary */}
      <ContainerSummary role={role} summary={summary} ancestorIsMatched={ancestorIsMatched} />

      {/* Status chips */}
      <CountryStatusChip matchStatus={node.matchStatus} role={role} />

      {/* View map — opens geoshape/division preview for any node with wikidataId */}
      <ActionIconButton
        show={!!onViewMap && !!node.wikidataId}
        title="View map comparison"
        onClick={() => onViewMap?.(node.id)}
        loading={false}
        disabled={false}
        icon={<ViewMapIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* CV color match — for parent nodes with children and a region map */}
      <ActionIconButton
        show={!!onCVMatch && hasChildren && !!node.regionMapUrl}
        title="CV color match (gap divisions only)"
        onClick={() => onCVMatch?.(node.id)}
        loading={cvMatchingRegionId === node.id}
        disabled={isMutating || cvMatchingRegionId === node.id}
        icon={<CVMatchIcon sx={{ fontSize: 16, color: 'info.main' }} />}
        loadingSize={16}
      />

      {/* Mapshape match — for parent nodes with children and a Wikivoyage source page */}
      <ActionIconButton
        show={!!onMapshapeMatch && hasChildren && !!node.sourceUrl}
        title="Mapshape match (Kartographer region boundaries from Wikivoyage)"
        onClick={() => onMapshapeMatch?.(node.id)}
        loading={mapshapeMatchingRegionId === node.id}
        disabled={isMutating || mapshapeMatchingRegionId === node.id}
        icon={<MapshapeMatchIcon sx={{ fontSize: 16, color: 'info.main' }} />}
        loadingSize={16}
      />

      {/* Dismiss subregions button */}
      <ActionIconButton
        show={hasUnmatchedChildren}
        title="Dismiss subregions (make leaf)"
        onClick={() => onDismissChildren(node.id)}
        loading={dismissingRegionId === node.id}
        disabled={isMutating || dismissingRegionId !== null}
        icon={<DismissChildrenIcon sx={{ fontSize: 16 }} />}
      />

      {/* Prune to leaves: keep direct children, remove grandchildren+ */}
      <ActionIconButton
        show={hasChildren && !!onPruneToLeaves}
        title="Prune to leaves (keep children, remove grandchildren+)"
        onClick={() => onPruneToLeaves?.(node.id)}
        loading={pruningRegionId === node.id}
        disabled={isMutating || pruningRegionId !== null}
        icon={<PruneToLeavesIcon sx={{ fontSize: 16 }} />}
      />

      {/* Collapse to parent: clear children data, generate parent suggestions */}
      <ActionIconButton
        show={hasChildren && !!onCollapseToParent}
        title="Clear children's matches, generate suggestions for this region"
        onClick={() => onCollapseToParent?.(node.id)}
        loading={collapsingRegionId === node.id}
        disabled={isMutating || collapsingRegionId != null}
        icon={<CollapseToParentIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* Merge single child into parent */}
      <ActionIconButton
        show={role === 'container' && node.children.length === 1 && !!onMergeChild}
        title="Merge single child into this node"
        onClick={() => onMergeChild?.(node.id)}
        loading={mergingRegionId === node.id}
        disabled={isMutating || mergingRegionId != null}
        icon={<MergeIcon sx={{ fontSize: 16, color: 'secondary.main' }} />}
      />

      {/* Smart flatten — absorb children's divisions */}
      <ActionIconButton
        show={
          hasChildren &&
          node.children.length > 1 &&
          !!onSmartFlatten &&
          (node.matchStatus == null ||
            node.matchStatus === 'no_candidates' ||
            node.matchStatus === 'children_matched')
        }
        title="Smart flatten: match children to GADM, absorb their divisions"
        onClick={() => onSmartFlatten?.(node.id)}
        loading={flatteningRegionId === node.id}
        disabled={isMutating || flatteningRegionId != null}
        icon={<SmartFlattenIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* Auto-resolve children: batch-match all unmatched leaf descendants */}
      <ActionIconButton
        show={hasChildren && !!onAutoResolve && hasUnmatchedChildren}
        title="Auto-resolve: batch-match all unmatched leaf descendants"
        onClick={() => onAutoResolve?.(node.id)}
        loading={autoResolvingRegionId === node.id}
        disabled={isMutating || autoResolvingRegionId != null}
        icon={<AutoResolveIcon sx={{ fontSize: 16, color: 'success.main' }} />}
      />

      {/* AI review subtree */}
      <ActionIconButton
        show={hasChildren && !!onReviewSubtree}
        title="AI review of this branch"
        onClick={() => onReviewSubtree?.(node.id)}
        loading={reviewingRegionId === node.id}
        disabled={isMutating || reviewingRegionId != null}
        icon={<ReviewSubtreeIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* Rename region */}
      <ActionIconButton
        show={!!onRename}
        title="Rename region"
        onClick={() => onRename?.(node.id, node.name)}
        loading={renamingRegionId === node.id}
        disabled={isMutating || renamingRegionId != null}
        icon={<RenameIcon sx={{ fontSize: 16 }} />}
      />

      {/* Move region to new parent */}
      <ActionIconButton
        show={!isRoot && !!onReparent}
        title="Move to different parent"
        onClick={() => onReparent?.(node.id, null)}
        loading={reparentingRegionId === node.id}
        disabled={isMutating || reparentingRegionId != null}
        icon={<ReparentIcon sx={{ fontSize: 16 }} />}
      />

      {/* Remove region from import tree */}
      <ActionIconButton
        show={!isRoot && !!onRemoveRegion}
        title="Remove region from tree"
        onClick={() => onRemoveRegion?.(node.id)}
        loading={removingRegionId === node.id}
        disabled={isMutating || removingRegionId != null}
        icon={<RemoveRegionIcon sx={{ fontSize: 16, color: 'error.main' }} />}
      />

      {/* Container: all children resolved — show success chip */}
      {role === 'container' && summary && summary.total > 0 && summary.resolved === summary.total && node.matchStatus !== 'children_matched' && (
        <Chip label="matched" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
      )}

      {/* Container with no_candidates + unresolved children — show search buttons */}
      {role === 'container' && node.matchStatus === 'no_candidates' && !(summary && summary.total > 0 && summary.resolved === summary.total) && (
        <>
          <Chip label="no match" color="default" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
          <SearchActionButtons {...searchButtonProps} />
        </>
      )}

      {/* Container with children_matched — show search buttons so user can match parent for coverage checking */}
      {role === 'container' && node.matchStatus === 'children_matched' && (
        <SearchActionButtons {...searchButtonProps} />
      )}

      {/* Country: no_candidates — always show search buttons (even under matched ancestors,
          because the user may have explicitly dismissed subregions to search at this level) */}
      {role === 'country' && node.matchStatus === 'no_candidates' && (
        <>
          <Chip label="no match" color="default" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
          <SearchActionButtons {...searchButtonProps} />
        </>
      )}

      {/* Country: needs_review */}
      {role === 'country' && node.matchStatus === 'needs_review' && (
        <>
          <Chip label="review" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
          <SearchActionButtons {...searchButtonProps} />
        </>
      )}

      {/* Country: already matched — show search buttons to add more divisions */}
      {role === 'country' && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched') && (
        <SearchActionButtons {...searchButtonProps} />
      )}

      {/* Country: suggested */}
      {role === 'country' && node.matchStatus === 'suggested' && (
        <Chip label="suggested" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
      )}

      {/* Country-role parents: show children summary only when not already matched */}
      {role === 'country' && hasChildren && summary
        && node.matchStatus !== 'auto_matched' && node.matchStatus !== 'manual_matched' && (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          children: {summary.resolved}/{summary.total}
          {summary.total - summary.resolved > 0 && !ancestorIsMatched && (
            <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
              ({summary.total - summary.resolved} unresolved)
            </Typography>
          )}
        </Typography>
      )}

      {/* Drill into children — match them independently */}
      <ActionIconButton
        show={hasChildren && node.matchStatus != null && node.matchStatus !== 'children_matched'}
        title="Match children independently (drill down)"
        onClick={() => onHandleAsGrouping(node.id)}
        loading={groupingRegionId === node.id}
        disabled={isMutating || groupingRegionId !== null}
        icon={<GroupingIcon sx={{ fontSize: 16 }} />}
      />

      {/* Smart simplify — detect misplaced divisions across children */}
      <ActionIconButton
        show={hasChildren && !!onSmartSimplify}
        title="Smart simplify — detect misplaced divisions across children"
        onClick={() => onSmartSimplify?.(node.id)}
        loading={false}
        disabled={isMutating}
        icon={<SmartSimplifyIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* Check division overlap among children */}
      <ActionIconButton
        show={hasChildren && !!onCheckOverlap}
        title="Check for divisions shared between children (including via parent/child GADM relationships)"
        onClick={() => onCheckOverlap?.(node.id)}
        loading={checkingOverlapRegionId === node.id}
        disabled={isMutating || checkingOverlapRegionId != null}
        icon={<OverlapCheckIcon sx={{ fontSize: 16, color: 'warning.main' }} />}
      />

      {/* Sync to other instances button */}
      <SyncToInstancesButton
        role={role}
        hasDuplicate={hasDuplicate}
        node={node}
        syncedUrls={syncedUrls}
        isMutating={isMutating}
        syncingRegionId={syncingRegionId}
        onSync={onSync}
      />

      {/* Simplify hierarchy — merge child divisions into parents */}
      <ActionIconButton
        show={
          node.assignedDivisions.length >= 2 &&
          (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched') &&
          !!onSimplifyHierarchy
        }
        title="Simplify — merge child divisions into parents where all children are assigned"
        onClick={() => onSimplifyHierarchy?.(node.id)}
        loading={simplifyingRegionId === node.id}
        disabled={isMutating || simplifyingRegionId != null}
        icon={<SimplifyIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* Simplify children — simplify each child region one by one */}
      <ActionIconButton
        show={hasChildren && !!onSimplifyChildren}
        title="Simplify children — merge child divisions into parents for each child region"
        onClick={() => onSimplifyChildren?.(node.id)}
        loading={simplifyingChildrenRegionId === node.id}
        disabled={isMutating || simplifyingChildrenRegionId != null}
        icon={<SimplifyChildrenIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* Clear all assigned divisions (keep suggestions) */}
      <ActionIconButton
        show={role === 'country' && node.assignedDivisions.length > 0 && !!onClearMembers}
        title={`Clear all ${node.assignedDivisions.length} assigned division${node.assignedDivisions.length > 1 ? 's' : ''}`}
        onClick={() => onClearMembers?.(node.id)}
        loading={clearingMembersRegionId === node.id}
        disabled={isMutating || clearingMembersRegionId != null}
        icon={<ClearAssignedIcon sx={{ fontSize: 16, color: 'warning.main' }} />}
      />

      {/* Reset match state */}
      <ActionIconButton
        show={node.matchStatus != null}
        title="Reset match (clear suggestions & rejections)"
        onClick={() => onResetMatch(node.id)}
        loading={false}
        disabled={isMutating}
        icon={<ResetIcon sx={{ fontSize: 16, color: 'text.disabled' }} />}
      />

      {/* Add child region (available on all nodes) */}
      <ActionIconButton
        show={!!onAddChild}
        title="Add child region"
        onClick={() => onAddChild?.(node.id)}
        loading={false}
        disabled={isMutating}
        icon={<AddChildIcon sx={{ fontSize: 16, color: 'info.main' }} />}
      />

      {/* AI review children (Wikivoyage + AI) */}
      <ActionIconButton
        show={!!node.sourceUrl && !!onAISuggestChildren}
        title="AI review children"
        onClick={() => onAISuggestChildren?.(node.id)}
        loading={aiSuggestingRegionId === node.id}
        disabled={isMutating || aiSuggestingRegionId != null}
        icon={<SuggestChildrenIcon sx={{ fontSize: 16, color: 'secondary.main' }} />}
      />

      {/* Manual division search — assign a GADM division by name search */}
      <ActionIconButton
        show={!!onManualDivisionSearch && node.matchStatus != null}
        title="Search and assign GADM division"
        onClick={() => onManualDivisionSearch?.(node.id)}
        loading={false}
        disabled={isMutating}
        icon={<DivisionSearchIcon sx={{ fontSize: 16 }} />}
      />

      {/* Dismiss hierarchy warnings (shown on nodes with unreviewed warnings) */}
      <ActionIconButton
        show={node.hierarchyWarnings.length > 0 && !node.hierarchyReviewed && !!onDismissHierarchyWarnings}
        title="Dismiss hierarchy warnings"
        onClick={() => onDismissHierarchyWarnings?.(node.id)}
        loading={false}
        disabled={isMutating}
        icon={<DismissWarningsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
      />

      {/* Manual fix flag */}
      <ManualFixButton
        node={node}
        isMutating={isMutating}
        onManualFix={onManualFix}
      />
      {node.needsManualFix && node.fixNote && (
        <Typography variant="caption" color="error" sx={{ fontSize: '0.65rem', fontStyle: 'italic' }}>
          {node.fixNote}
        </Typography>
      )}
    </>
  );
}

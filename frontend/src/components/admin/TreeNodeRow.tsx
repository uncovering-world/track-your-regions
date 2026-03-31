import { memo, useCallback, useMemo } from 'react';
import {
  Box,
  Chip,
  Typography,
  IconButton,
  Link,
} from '@mui/material';
import {
  ExpandMore as ExpandIcon,
  ChevronRight as CollapseRightIcon,
  OpenInNew as OpenInNewIcon,
  Image as ImageIcon,
  WarningAmber as WarningAmberIcon,
  PublicOff as PublicOffIcon,
} from '@mui/icons-material';
import type { MatchTreeNode } from '../../api/adminWorldViewImport';
import { Tooltip, type ShadowInsertion } from './treeNodeShared';
import { TreeNodeActions } from './TreeNodeActions';
import { TreeNodeContent } from './TreeNodeContent';
import { countDirectChildrenResolved } from './importTreeUtils';

export interface TreeNodeRowProps {
  node: MatchTreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onAccept: (regionId: number, divisionId: number) => void;
  onAcceptTransfer?: (regionId: number, divisionId: number, conflict: { type: 'direct' | 'split'; donorRegionId: number; donorDivisionId: number }) => void;
  onAcceptAndRejectRest: (regionId: number, divisionId: number) => void;
  onReject: (regionId: number, divisionId: number) => void;
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
  onDismissChildren: (regionId: number) => void;
  onSync: (regionId: number) => void;
  onHandleAsGrouping: (regionId: number) => void;
  onGeocodeMatch: (regionId: number) => void;
  onGeoshapeMatch: (regionId: number, scopeAncestorId?: number) => void;
  onPointMatch: (regionId: number, scopeAncestorId?: number) => void;
  onResetMatch: (regionId: number) => void;
  onRejectRemaining: (regionId: number) => void;
  onAcceptAll: (assignments: Array<{ regionId: number; divisionId: number }>) => void;
  onPreviewUnion?: (regionId: number, divisionIds: number[], context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string }) => void;
  onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' }, wikidataId: string, regionName: string, regionId?: number, allDivisionIds?: number[], allSuggestions?: Array<{ divisionId: number; conflict?: { donorDivisionId: number; donorRegionId: number; type: 'direct' | 'split' } }>) => void;
  onAcceptSelected?: (regionId: number, divisionIds: number[]) => void;
  onAcceptSelectedRejectRest?: (regionId: number, divisionIds: number[]) => void;
  onRejectSelected?: (regionId: number, divisionIds: number[]) => void;
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean, regionMapLabel?: string, regionName?: string, markerPoints?: Array<{ name: string; lat: number; lon: number }>) => void;
  onOpenMapPicker: (node: MatchTreeNode, pendingPreview?: { divisionId: number; name: string; path?: string; isAssigned: boolean }) => void;
  onManualFix: (regionId: number, needsManualFix: boolean, fixNote?: string) => void;
  isMutating: boolean;
  dbSearchingRegionId: number | null;
  aiMatchingRegionId: number | null;
  dismissingRegionId: number | null;
  syncingRegionId: number | null;
  groupingRegionId: number | null;
  geocodeMatchingRegionId: number | null;
  geoshapeMatchingRegionId: number | null;
  pointMatchingRegionId: number | null;
  /** Nearest ancestor's region map URL — fallback for preview when node has no own image/geoshape */
  parentRegionMapUrl?: string;
  parentRegionMapName?: string;
  geocodeProgress: { regionId: number; message: string; nextScope?: { ancestorId: number; ancestorName: string }; retryType?: 'geoshape' | 'point' } | null;
  duplicateUrls: Set<string>;
  syncedUrls: Set<string>;
  shadowsByRegionId: Map<number, ShadowInsertion[]>;
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  /** True when any ancestor is matched (has assigned GADM divisions covering this node's territory) */
  ancestorIsMatched: boolean;
  /** Region ID currently highlighted by single-child navigation */
  highlightedRegionId?: number | null;
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
  onViewMap?: (regionId: number, context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string; divisionIds: number[] }) => void;
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
  /** Coverage % data for all regions */
  coverageData?: Record<string, number>;
  /** Whether coverage data is still loading for the first time */
  coverageLoading?: boolean;
  /** Set of region IDs whose coverage is being recalculated */
  coverageDirtyIds?: ReadonlySet<number>;
  /** Callback when coverage chip is clicked */
  onCoverageClick?: (regionId: number) => void;
  /** Notify virtualizer to re-measure row height after content resize */
  onContentResize?: () => void;
}

/** Determine the role of a node for display purposes */
function getNodeRole(node: MatchTreeNode): 'container' | 'country' | 'subdivision' {
  if (node.children.length > 0) {
    // Nodes with actionable suggestions keep country role to show candidates
    if (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched' ||
        node.matchStatus === 'suggested' || node.matchStatus === 'needs_review') {
      return 'country';
    }
    // no_candidates, children_matched, null → container (shows summary)
    return 'container';
  }
  // Leaf nodes with match status are countries
  if (node.matchStatus != null) {
    return 'country';
  }
  return 'container';
}

/** Custom comparator for React.memo — only re-render when rendering-relevant props change.
 * Skips callback comparisons (they're semantically stable) and compares collection props
 * (Sets, Maps) only for THIS node's values, not by reference identity. */
function arePropsEqual(prev: TreeNodeRowProps, next: TreeNodeRowProps): boolean {
  // Node identity — optimisticTreeUpdate preserves references for unchanged branches
  if (prev.node !== next.node) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.ancestorIsMatched !== next.ancestorIsMatched) return false;
  if (prev.isMutating !== next.isMutating) return false;

  // Only this node's expanded state matters
  if (prev.expanded.has(prev.node.id) !== next.expanded.has(next.node.id)) return false;

  // Only whether THIS node is highlighted matters
  if ((prev.highlightedRegionId === prev.node.id) !== (next.highlightedRegionId === next.node.id)) return false;

  // Loading states — only when targeting THIS node
  const id = prev.node.id;
  if ((prev.dbSearchingRegionId === id) !== (next.dbSearchingRegionId === id)) return false;
  if ((prev.aiMatchingRegionId === id) !== (next.aiMatchingRegionId === id)) return false;
  if ((prev.dismissingRegionId === id) !== (next.dismissingRegionId === id)) return false;
  if ((prev.syncingRegionId === id) !== (next.syncingRegionId === id)) return false;
  if ((prev.groupingRegionId === id) !== (next.groupingRegionId === id)) return false;
  if ((prev.geocodeMatchingRegionId === id) !== (next.geocodeMatchingRegionId === id)) return false;
  if ((prev.geoshapeMatchingRegionId === id) !== (next.geoshapeMatchingRegionId === id)) return false;
  if ((prev.pointMatchingRegionId === id) !== (next.pointMatchingRegionId === id)) return false;
  if ((prev.mergingRegionId === id) !== (next.mergingRegionId === id)) return false;
  if ((prev.flatteningRegionId === id) !== (next.flatteningRegionId === id)) return false;
  if ((prev.removingRegionId === id) !== (next.removingRegionId === id)) return false;
  if ((prev.collapsingRegionId === id) !== (next.collapsingRegionId === id)) return false;
  if ((prev.autoResolvingRegionId === id) !== (next.autoResolvingRegionId === id)) return false;
  if ((prev.reviewingRegionId === id) !== (next.reviewingRegionId === id)) return false;
  if ((prev.renamingRegionId === id) !== (next.renamingRegionId === id)) return false;
  if ((prev.reparentingRegionId === id) !== (next.reparentingRegionId === id)) return false;
  if ((prev.aiSuggestingRegionId === id) !== (next.aiSuggestingRegionId === id)) return false;
  if ((prev.cvMatchingRegionId === id) !== (next.cvMatchingRegionId === id)) return false;
  if ((prev.mapshapeMatchingRegionId === id) !== (next.mapshapeMatchingRegionId === id)) return false;
  if ((prev.clearingMembersRegionId === id) !== (next.clearingMembersRegionId === id)) return false;
  if ((prev.simplifyingRegionId === id) !== (next.simplifyingRegionId === id)) return false;
  if ((prev.simplifyingChildrenRegionId === id) !== (next.simplifyingChildrenRegionId === id)) return false;

  // Coverage data for this node
  if (prev.coverageData?.[String(id)] !== next.coverageData?.[String(id)]) return false;
  if (prev.coverageLoading !== next.coverageLoading) return false;
  if (prev.coverageDirtyIds?.has(id) !== next.coverageDirtyIds?.has(id)) return false;

  // Geocode progress for this node
  const prevGeo = prev.geocodeProgress?.regionId === id ? prev.geocodeProgress : null;
  const nextGeo = next.geocodeProgress?.regionId === id ? next.geocodeProgress : null;
  if (prevGeo?.message !== nextGeo?.message || prevGeo?.nextScope?.ancestorId !== nextGeo?.nextScope?.ancestorId) return false;

  // Duplicate/synced URL status for this node
  const url = prev.node.sourceUrl;
  if (url) {
    if (prev.duplicateUrls.has(url) !== next.duplicateUrls.has(url)) return false;
    if (prev.syncedUrls.has(url) !== next.syncedUrls.has(url)) return false;
  }

  // Parent map fallback
  if (prev.parentRegionMapUrl !== next.parentRegionMapUrl) return false;
  if (prev.parentRegionMapName !== next.parentRegionMapName) return false;

  // Shadow insertions for this node
  if (prev.shadowsByRegionId.get(id) !== next.shadowsByRegionId.get(id)) return false;

  return true;
}

export const TreeNodeRow = memo(function TreeNodeRow({ node, depth, expanded, onToggle, onAccept, onAcceptTransfer, onAcceptAndRejectRest, onReject, onDBSearch, onAIMatch, onDismissChildren, onSync, onHandleAsGrouping, onGeocodeMatch, onGeoshapeMatch, onPointMatch, onResetMatch, onRejectRemaining, onAcceptAll, onPreviewUnion, onPreviewTransfer, onAcceptSelected, onAcceptSelectedRejectRest, onRejectSelected, onPreview, onOpenMapPicker, onManualFix, isMutating, dbSearchingRegionId, aiMatchingRegionId, dismissingRegionId, syncingRegionId, groupingRegionId, geocodeMatchingRegionId, geoshapeMatchingRegionId, pointMatchingRegionId, parentRegionMapUrl, parentRegionMapName, geocodeProgress, duplicateUrls, syncedUrls, shadowsByRegionId, onApproveShadow, onRejectShadow, ancestorIsMatched, highlightedRegionId, onMergeChild, mergingRegionId, onSmartFlatten, flatteningRegionId, onDismissHierarchyWarnings, onAddChild, onRemoveRegion, removingRegionId, onCollapseToParent, collapsingRegionId, onAutoResolve, autoResolvingRegionId, onReviewSubtree, reviewingRegionId, onRename, renamingRegionId, onReparent, reparentingRegionId, onAISuggestChildren, aiSuggestingRegionId, onManualDivisionSearch, onPruneToLeaves, pruningRegionId, onViewMap, onCVMatch, cvMatchingRegionId, onMapshapeMatch, mapshapeMatchingRegionId, onClearMembers, clearingMembersRegionId, onSimplifyHierarchy, simplifyingRegionId, onSimplifyChildren, simplifyingChildrenRegionId, onSmartSimplify, coverageData, coverageLoading, coverageDirtyIds, onCoverageClick, onContentResize }: TreeNodeRowProps) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const role = getNodeRole(node);
  const hasDuplicate = !!(node.sourceUrl && duplicateUrls.has(node.sourceUrl));

  // Geocode progress for this specific node
  const nodeGeocode = geocodeProgress?.regionId === node.id ? geocodeProgress : null;

  // Intercept preview: if unreviewed candidates and no map URL, open picker first
  const shouldInterceptPreview = node.mapImageCandidates.length > 1 && !node.mapImageReviewed && !node.regionMapUrl;

  // Wrap onPreview to inject this node's regionMapUrl, wikidataId, regionId, and isAssigned.
  // When node has no own map image, fall back to parent's regionMapUrl for side-by-side reference.
  const effectiveMapUrl = node.regionMapUrl ?? parentRegionMapUrl ?? undefined;
  const fallbackMapLabel = !node.regionMapUrl && parentRegionMapUrl && parentRegionMapName
    ? `Parent region map (${parentRegionMapName})`
    : !node.regionMapUrl && parentRegionMapUrl
      ? 'Parent region map'
      : undefined;
  const handlePreviewAssigned = useCallback(
    (divisionId: number, name: string, path?: string) => {
      if (shouldInterceptPreview) {
        onOpenMapPicker(node, { divisionId, name, path, isAssigned: true });
        return;
      }
      onPreview(divisionId, name, path, effectiveMapUrl, node.wikidataId ?? undefined, node.id, true, fallbackMapLabel, node.name, node.markerPoints ?? undefined);
    },
    [onPreview, node, shouldInterceptPreview, onOpenMapPicker, effectiveMapUrl, fallbackMapLabel],
  );
  const handlePreviewSuggestion = useCallback(
    (divisionId: number, name: string, path?: string) => {
      if (shouldInterceptPreview) {
        onOpenMapPicker(node, { divisionId, name, path, isAssigned: false });
        return;
      }
      onPreview(divisionId, name, path, effectiveMapUrl, node.wikidataId ?? undefined, node.id, false, fallbackMapLabel, node.name, node.markerPoints ?? undefined);
    },
    [onPreview, node, shouldInterceptPreview, onOpenMapPicker, effectiveMapUrl, fallbackMapLabel],
  );
  const handlePreviewUnion = useCallback(
    (regionId: number, divisionIds: number[]) => {
      onPreviewUnion?.(regionId, divisionIds, {
        wikidataId: node.wikidataId ?? undefined,
        regionMapUrl: effectiveMapUrl,
        regionMapLabel: fallbackMapLabel,
        regionName: node.name,
      });
    },
    [onPreviewUnion, node.wikidataId, node.name, effectiveMapUrl, fallbackMapLabel],
  );
  const handlePreviewTransferSuggestion = useCallback(
    (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' }, regionId?: number, allDivisionIds?: number[], allSuggestions?: Array<{ divisionId: number; conflict?: { donorDivisionId: number; donorRegionId: number; type: 'direct' | 'split' } }>) => {
      if (onPreviewTransfer && node.wikidataId) {
        onPreviewTransfer(divisionId, name, path, conflict, node.wikidataId, node.name, regionId, allDivisionIds, allSuggestions);
      }
    },
    [onPreviewTransfer, node.wikidataId, node.name],
  );
  const handleViewMap = useCallback(
    () => {
      onViewMap?.(node.id, {
        wikidataId: node.wikidataId ?? undefined,
        regionMapUrl: effectiveMapUrl,
        regionMapLabel: fallbackMapLabel,
        regionName: node.name,
        divisionIds: node.assignedDivisions.map(d => d.divisionId),
      });
    },
    [onViewMap, node.id, node.wikidataId, node.name, node.assignedDivisions, effectiveMapUrl, fallbackMapLabel],
  );

  // For nodes with children, count resolved direct children.
  // Only this node's own match counts as coverage — ancestor matches are NOT propagated
  // to avoid showing "X/X matched" when children haven't been individually matched.
  const summary = useMemo(() => {
    if (!hasChildren) return null;
    const nodeHasOwnMembers = node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched' || node.memberCount > 0;
    return countDirectChildrenResolved(node.children, nodeHasOwnMembers);
  }, [hasChildren, node.children, node.matchStatus, node.memberCount]);

  const nodeShadows = shadowsByRegionId.get(node.id);

  return (
    <Box data-region-id={node.id}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          pl: depth * 3,
          py: 0.3,
          '&:hover': { bgcolor: 'action.hover' },
          borderBottom: '1px solid',
          borderColor: 'divider',
          minHeight: role === 'container' ? 36 : 32,
          flexWrap: 'wrap',
          ...(node.id === highlightedRegionId && {
            bgcolor: 'rgba(25, 118, 210, 0.08)',
          }),
        }}
      >
        {/* Expand/collapse toggle */}
        <Box sx={{ width: 28, flexShrink: 0 }}>
          {hasChildren ? (
            <IconButton size="small" onClick={() => onToggle(node.id)} sx={{ p: 0.25 }}>
              {isExpanded ? <ExpandIcon fontSize="small" /> : <CollapseRightIcon fontSize="small" />}
            </IconButton>
          ) : null}
        </Box>

        {/* Region name */}
        <Typography
          variant="body2"
          sx={{
            fontWeight: role === 'container' ? 600 : 400,
            minWidth: 80,
            flexShrink: 0,
          }}
        >
          {node.name}
        </Typography>

        {/* Hierarchy warning indicator */}
        {node.hierarchyWarnings.length > 0 && !node.hierarchyReviewed && (
          <Tooltip title={node.hierarchyWarnings.join('\n')}>
            <WarningAmberIcon sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }} />
          </Tooltip>
        )}

        {/* Geo similarity badge (top suggestion) — only when no divisions assigned yet */}
        {(() => {
          if (node.assignedDivisions.length > 0) return null;
          const topSuggestion = node.suggestions[0];
          const geo = topSuggestion?.geoSimilarity;
          if (geo != null && geo >= 0.5) {
            const isStrong = geo >= 0.7;
            return (
              <Chip
                size="small"
                variant="outlined"
                label={`${isStrong ? 'Strong geo' : 'Geo'} ${Math.round(geo * 100)}%`}
                color={isStrong ? 'success' : 'warning'}
                sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
              />
            );
          }
          if (node.geoAvailable === false) {
            return (
              <Tooltip title="No geoshape available for comparison">
                <PublicOffIcon sx={{ fontSize: 14, color: 'text.disabled', flexShrink: 0 }} />
              </Tooltip>
            );
          }
          return null;
        })()}

        {/* Source page link */}
        {node.sourceUrl && (
          <Link
            href={node.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            <OpenInNewIcon sx={{ fontSize: 13 }} />
          </Link>
        )}

        {/* Map image picker button */}
        {role === 'country' && node.mapImageCandidates.length > 1 && !node.regionMapUrl && (node.matchStatus === 'needs_review' || node.matchStatus === 'suggested') && (
          <Tooltip title={`${node.mapImageCandidates.length} image candidates${node.mapImageReviewed ? ' (reviewed)' : ''}`}>
            <IconButton
              size="small"
              onClick={() => onOpenMapPicker(node)}
              sx={{ p: 0.25 }}
            >
              <ImageIcon sx={{ fontSize: 16, color: node.mapImageReviewed ? 'success.main' : 'warning.main' }} />
            </IconButton>
          </Tooltip>
        )}

        {/* Actions: status chips, search buttons, sync, reset, manual fix */}
        <TreeNodeActions
          node={node}
          role={role}
          hasChildren={hasChildren}
          summary={summary}
          ancestorIsMatched={ancestorIsMatched}
          hasDuplicate={hasDuplicate}
          syncedUrls={syncedUrls}
          isMutating={isMutating}
          dbSearchingRegionId={dbSearchingRegionId}
          aiMatchingRegionId={aiMatchingRegionId}
          dismissingRegionId={dismissingRegionId}
          syncingRegionId={syncingRegionId}
          groupingRegionId={groupingRegionId}
          geocodeMatchingRegionId={geocodeMatchingRegionId}
          geoshapeMatchingRegionId={geoshapeMatchingRegionId}
          pointMatchingRegionId={pointMatchingRegionId}
          nodeGeocodeMsg={nodeGeocode?.message ?? null}
          nodeGeocodeNextScope={nodeGeocode?.nextScope}
          nodeGeocodeRetryType={nodeGeocode?.retryType}
          onDBSearch={onDBSearch}
          onAIMatch={onAIMatch}
          onDismissChildren={onDismissChildren}
          onSync={onSync}
          onHandleAsGrouping={onHandleAsGrouping}
          onGeocodeMatch={onGeocodeMatch}
          onGeoshapeMatch={onGeoshapeMatch}
          onPointMatch={onPointMatch}
          onResetMatch={onResetMatch}
          onManualFix={onManualFix}
          onMergeChild={onMergeChild}
          mergingRegionId={mergingRegionId}
          onSmartFlatten={onSmartFlatten}
          flatteningRegionId={flatteningRegionId}
          onDismissHierarchyWarnings={onDismissHierarchyWarnings}
          onAddChild={onAddChild}
          onRemoveRegion={onRemoveRegion}
          removingRegionId={removingRegionId}
          onCollapseToParent={onCollapseToParent}
          collapsingRegionId={collapsingRegionId}
          onAutoResolve={onAutoResolve}
          autoResolvingRegionId={autoResolvingRegionId}
          onReviewSubtree={onReviewSubtree}
          reviewingRegionId={reviewingRegionId}
          onRename={onRename}
          renamingRegionId={renamingRegionId}
          onReparent={onReparent}
          reparentingRegionId={reparentingRegionId}
          onAISuggestChildren={onAISuggestChildren}
          aiSuggestingRegionId={aiSuggestingRegionId}
          onManualDivisionSearch={onManualDivisionSearch}
          onPruneToLeaves={onPruneToLeaves}
          pruningRegionId={pruningRegionId}
          onViewMap={onViewMap ? handleViewMap : undefined}
          onCVMatch={onCVMatch}
          cvMatchingRegionId={cvMatchingRegionId}
          onMapshapeMatch={onMapshapeMatch}
          mapshapeMatchingRegionId={mapshapeMatchingRegionId}
          onClearMembers={onClearMembers}
          clearingMembersRegionId={clearingMembersRegionId}
          onSimplifyHierarchy={onSimplifyHierarchy}
          simplifyingRegionId={simplifyingRegionId}
          onSimplifyChildren={onSimplifyChildren}
          simplifyingChildrenRegionId={simplifyingChildrenRegionId}
          onSmartSimplify={onSmartSimplify}
          isRoot={depth === 0}
        />
      </Box>

      {/* Content: division lists, suggestions, shadow insertions (add_member only) */}
      <TreeNodeContent
        node={node}
        depth={depth}
        role={role}
        hasChildren={hasChildren}
        nodeShadows={nodeShadows}
        onAccept={onAccept}
        onAcceptTransfer={onAcceptTransfer}
        onAcceptAndRejectRest={onAcceptAndRejectRest}
        onReject={onReject}
        onRejectRemaining={onRejectRemaining}
        onAcceptAll={onAcceptAll}
        handlePreviewAssigned={handlePreviewAssigned}
        handlePreviewSuggestion={handlePreviewSuggestion}
        onPreviewTransfer={handlePreviewTransferSuggestion}
        onApproveShadow={onApproveShadow}
        onRejectShadow={onRejectShadow}
        onPreviewUnion={onPreviewUnion ? handlePreviewUnion : undefined}
        onAcceptSelected={onAcceptSelected}
        onAcceptSelectedRejectRest={onAcceptSelectedRejectRest}
        onRejectSelected={onRejectSelected}
        isMutating={isMutating}
        coveragePercent={hasChildren ? coverageData?.[String(node.id)] : undefined}
        coverageLoading={hasChildren ? coverageLoading : false}
        coverageFetching={(coverageDirtyIds?.has(node.id) ?? false)}
        onCoverageClick={onCoverageClick}
        onContentResize={onContentResize}
      />
    </Box>
  );
}, arePropsEqual);

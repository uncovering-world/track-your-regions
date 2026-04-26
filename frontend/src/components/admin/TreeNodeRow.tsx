import { memo, useCallback, useMemo, type ReactElement } from 'react';
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
import type { MatchTreeNode } from '../../api/admin/worldViewImport';
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
  onCheckOverlap?: (regionId: number) => void;
  checkingOverlapRegionId?: number | null;
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

/** Compute the fallback map label when the node has no own region map. */
function computeFallbackMapLabel(
  ownRegionMapUrl: string | null | undefined,
  parentRegionMapUrl: string | undefined,
  parentRegionMapName: string | undefined,
): string | undefined {
  if (ownRegionMapUrl || !parentRegionMapUrl) return undefined;
  return parentRegionMapName ? `Parent region map (${parentRegionMapName})` : 'Parent region map';
}

/** Hook: build the preview-callbacks that depend on node + map-picker interception */
function usePreviewCallbacks(
  node: MatchTreeNode,
  shouldInterceptPreview: boolean,
  effectiveMapUrl: string | undefined,
  fallbackMapLabel: string | undefined,
  onPreview: TreeNodeRowProps['onPreview'],
  onOpenMapPicker: TreeNodeRowProps['onOpenMapPicker'],
  onPreviewTransfer: TreeNodeRowProps['onPreviewTransfer'],
  onPreviewUnion: TreeNodeRowProps['onPreviewUnion'],
  onViewMap: TreeNodeRowProps['onViewMap'],
) {
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
  return {
    handlePreviewAssigned,
    handlePreviewSuggestion,
    handlePreviewUnion,
    handlePreviewTransferSuggestion,
    handleViewMap,
  };
}

/** Render the map-image picker button for a country-role node if applicable. */
function MapImagePickerButton({
  node,
  role,
  onOpenMapPicker,
}: {
  node: MatchTreeNode;
  role: 'container' | 'country' | 'subdivision';
  onOpenMapPicker: TreeNodeRowProps['onOpenMapPicker'];
}): ReactElement | null {
  if (role !== 'country') return null;
  if (node.mapImageCandidates.length <= 1) return null;
  if (node.regionMapUrl) return null;
  if (node.matchStatus !== 'needs_review' && node.matchStatus !== 'suggested') return null;
  return (
    <Tooltip title={`${node.mapImageCandidates.length} image candidates${node.mapImageReviewed ? ' (reviewed)' : ''}`}>
      <IconButton size="small" onClick={() => onOpenMapPicker(node)} sx={{ p: 0.25 }}>
        <ImageIcon sx={{ fontSize: 16, color: node.mapImageReviewed ? 'success.main' : 'warning.main' }} />
      </IconButton>
    </Tooltip>
  );
}

/** Render the expand/collapse caret for a row. */
function ExpandToggle({
  hasChildren,
  isExpanded,
  onClick,
}: {
  hasChildren: boolean;
  isExpanded: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <Box sx={{ width: 28, flexShrink: 0 }}>
      {hasChildren ? (
        <IconButton size="small" onClick={onClick} sx={{ p: 0.25 }}>
          {isExpanded ? <ExpandIcon fontSize="small" /> : <CollapseRightIcon fontSize="small" />}
        </IconButton>
      ) : null}
    </Box>
  );
}

/** Render the hierarchy-warning indicator when there are unreviewed warnings. */
function HierarchyWarningIcon({ node }: { node: MatchTreeNode }): ReactElement | null {
  if (node.hierarchyWarnings.length === 0 || node.hierarchyReviewed) return null;
  return (
    <Tooltip title={node.hierarchyWarnings.join('\n')}>
      <WarningAmberIcon sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }} />
    </Tooltip>
  );
}

/** External source link glyph. */
function SourcePageLink({ url }: { url: string | null | undefined }): ReactElement | null {
  if (!url) return null;
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
    >
      <OpenInNewIcon sx={{ fontSize: 13 }} />
    </Link>
  );
}

/** Render the geo-similarity chip (or "no geoshape" icon) for a node, or null. */
function GeoSimilarityBadge({ node }: { node: MatchTreeNode }): ReactElement | null {
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

/** Every per-node "currently-busy-with-this-ID" prop. Comparator scans these as a list. */
const LOADING_KEYS: ReadonlyArray<keyof TreeNodeRowProps> = [
  'dbSearchingRegionId',
  'aiMatchingRegionId',
  'dismissingRegionId',
  'syncingRegionId',
  'groupingRegionId',
  'geocodeMatchingRegionId',
  'geoshapeMatchingRegionId',
  'pointMatchingRegionId',
  'mergingRegionId',
  'flatteningRegionId',
  'removingRegionId',
  'collapsingRegionId',
  'autoResolvingRegionId',
  'reviewingRegionId',
  'renamingRegionId',
  'reparentingRegionId',
  'aiSuggestingRegionId',
  'cvMatchingRegionId',
  'mapshapeMatchingRegionId',
  'clearingMembersRegionId',
  'simplifyingRegionId',
  'simplifyingChildrenRegionId',
  'checkingOverlapRegionId',
];

function scalarPropsEqual(prev: TreeNodeRowProps, next: TreeNodeRowProps): boolean {
  return (
    prev.node === next.node &&
    prev.depth === next.depth &&
    prev.ancestorIsMatched === next.ancestorIsMatched &&
    prev.isMutating === next.isMutating &&
    prev.parentRegionMapUrl === next.parentRegionMapUrl &&
    prev.parentRegionMapName === next.parentRegionMapName &&
    prev.coverageLoading === next.coverageLoading
  );
}

function loadingStatesEqual(prev: TreeNodeRowProps, next: TreeNodeRowProps, id: number): boolean {
  for (const key of LOADING_KEYS) {
    // eslint-disable-next-line security/detect-object-injection -- key iterated from LOADING_KEYS (module-level const string[]); prev/next are typed TreeNodeRowProps
    if ((prev[key] === id) !== (next[key] === id)) return false;
  }
  return true;
}

function geocodeStatusEqual(prev: TreeNodeRowProps, next: TreeNodeRowProps, id: number): boolean {
  const prevGeo = prev.geocodeProgress?.regionId === id ? prev.geocodeProgress : null;
  const nextGeo = next.geocodeProgress?.regionId === id ? next.geocodeProgress : null;
  return (
    prevGeo?.message === nextGeo?.message &&
    prevGeo?.nextScope?.ancestorId === nextGeo?.nextScope?.ancestorId
  );
}

function urlStatusEqual(prev: TreeNodeRowProps, next: TreeNodeRowProps): boolean {
  const url = prev.node.sourceUrl;
  if (!url) return true;
  return (
    prev.duplicateUrls.has(url) === next.duplicateUrls.has(url) &&
    prev.syncedUrls.has(url) === next.syncedUrls.has(url)
  );
}

/** Custom comparator for React.memo — only re-render when rendering-relevant props change.
 * Skips callback comparisons (they're semantically stable) and compares collection props
 * (Sets, Maps) only for THIS node's values, not by reference identity. */
function arePropsEqual(prev: TreeNodeRowProps, next: TreeNodeRowProps): boolean {
  if (!scalarPropsEqual(prev, next)) return false;

  // Only this node's expanded state matters
  if (prev.expanded.has(prev.node.id) !== next.expanded.has(next.node.id)) return false;

  // Only whether THIS node is highlighted matters
  if (
    (prev.highlightedRegionId === prev.node.id) !==
    (next.highlightedRegionId === next.node.id)
  ) {
    return false;
  }

  const id = prev.node.id;
  if (!loadingStatesEqual(prev, next, id)) return false;

  // Coverage data for this node
  if (prev.coverageData?.[String(id)] !== next.coverageData?.[String(id)]) return false;
  if (prev.coverageDirtyIds?.has(id) !== next.coverageDirtyIds?.has(id)) return false;

  if (!geocodeStatusEqual(prev, next, id)) return false;
  if (!urlStatusEqual(prev, next)) return false;

  // Shadow insertions for this node
  if (prev.shadowsByRegionId.get(id) !== next.shadowsByRegionId.get(id)) return false;

  return true;
}

export const TreeNodeRow = memo(function TreeNodeRow({ node, depth, expanded, onToggle, onAccept, onAcceptTransfer: _onAcceptTransfer, onAcceptAndRejectRest, onReject, onDBSearch, onAIMatch, onDismissChildren, onSync, onHandleAsGrouping, onGeocodeMatch, onGeoshapeMatch, onPointMatch, onResetMatch, onRejectRemaining, onAcceptAll, onPreviewUnion, onPreviewTransfer, onAcceptSelected, onAcceptSelectedRejectRest, onRejectSelected, onPreview, onOpenMapPicker, onManualFix, isMutating, dbSearchingRegionId, aiMatchingRegionId, dismissingRegionId, syncingRegionId, groupingRegionId, geocodeMatchingRegionId, geoshapeMatchingRegionId, pointMatchingRegionId, parentRegionMapUrl, parentRegionMapName, geocodeProgress, duplicateUrls, syncedUrls, shadowsByRegionId, onApproveShadow, onRejectShadow, ancestorIsMatched, highlightedRegionId, onMergeChild, mergingRegionId, onSmartFlatten, flatteningRegionId, onDismissHierarchyWarnings, onAddChild, onRemoveRegion, removingRegionId, onCollapseToParent, collapsingRegionId, onAutoResolve, autoResolvingRegionId, onReviewSubtree, reviewingRegionId, onRename, renamingRegionId, onReparent, reparentingRegionId, onAISuggestChildren, aiSuggestingRegionId, onManualDivisionSearch, onPruneToLeaves, pruningRegionId, onViewMap, onCVMatch, cvMatchingRegionId, onMapshapeMatch, mapshapeMatchingRegionId, onClearMembers, clearingMembersRegionId, onSimplifyHierarchy, simplifyingRegionId, onSimplifyChildren, simplifyingChildrenRegionId, onSmartSimplify, onCheckOverlap, checkingOverlapRegionId, coverageData, coverageLoading, coverageDirtyIds, onCoverageClick, onContentResize }: TreeNodeRowProps) {
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
  const fallbackMapLabel = computeFallbackMapLabel(node.regionMapUrl, parentRegionMapUrl, parentRegionMapName);
  const {
    handlePreviewAssigned,
    handlePreviewSuggestion,
    handlePreviewUnion,
    handlePreviewTransferSuggestion,
    handleViewMap,
  } = usePreviewCallbacks(
    node,
    shouldInterceptPreview,
    effectiveMapUrl,
    fallbackMapLabel,
    onPreview,
    onOpenMapPicker,
    onPreviewTransfer,
    onPreviewUnion,
    onViewMap,
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
        <ExpandToggle hasChildren={hasChildren} isExpanded={isExpanded} onClick={() => onToggle(node.id)} />

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
        <HierarchyWarningIcon node={node} />

        {/* Geo similarity badge (top suggestion) — only when no divisions assigned yet */}
        <GeoSimilarityBadge node={node} />

        {/* Source page link */}
        <SourcePageLink url={node.sourceUrl} />

        {/* Map image picker button */}
        <MapImagePickerButton node={node} role={role} onOpenMapPicker={onOpenMapPicker} />

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
          onCheckOverlap={onCheckOverlap}
          checkingOverlapRegionId={checkingOverlapRegionId}
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

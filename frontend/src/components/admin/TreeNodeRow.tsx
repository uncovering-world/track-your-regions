import { useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Collapse,
  Link,
} from '@mui/material';
import {
  ExpandMore as ExpandIcon,
  ChevronRight as CollapseRightIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon,
  Image as ImageIcon,
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
  onAcceptAndRejectRest: (regionId: number, divisionId: number) => void;
  onReject: (regionId: number, divisionId: number) => void;
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
  onDismissChildren: (regionId: number) => void;
  onSync: (regionId: number) => void;
  onHandleAsGrouping: (regionId: number) => void;
  onGeocodeMatch: (regionId: number) => void;
  onResetMatch: (regionId: number) => void;
  onRejectRemaining: (regionId: number) => void;
  onAcceptAll: (assignments: Array<{ regionId: number; divisionId: number }>) => void;
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean) => void;
  onOpenMapPicker: (node: MatchTreeNode, pendingPreview?: { divisionId: number; name: string; path?: string; isAssigned: boolean }) => void;
  onManualFix: (regionId: number, needsManualFix: boolean, fixNote?: string) => void;
  isMutating: boolean;
  dbSearchingRegionId: number | null;
  aiMatchingRegionId: number | null;
  dismissingRegionId: number | null;
  syncingRegionId: number | null;
  groupingRegionId: number | null;
  geocodeMatchingRegionId: number | null;
  geocodeProgress: { regionId: number; message: string } | null;
  duplicateUrls: Set<string>;
  syncedUrls: Set<string>;
  shadowsByRegionId: Map<number, ShadowInsertion[]>;
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  skipAnimationRef: React.RefObject<boolean>;
  /** True when any ancestor is matched (has assigned GADM divisions covering this node's territory) */
  ancestorIsMatched: boolean;
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

export function TreeNodeRow({ node, depth, expanded, onToggle, onAccept, onAcceptAndRejectRest, onReject, onDBSearch, onAIMatch, onDismissChildren, onSync, onHandleAsGrouping, onGeocodeMatch, onResetMatch, onRejectRemaining, onAcceptAll, onPreview, onOpenMapPicker, onManualFix, isMutating, dbSearchingRegionId, aiMatchingRegionId, dismissingRegionId, syncingRegionId, groupingRegionId, geocodeMatchingRegionId, geocodeProgress, duplicateUrls, syncedUrls, shadowsByRegionId, onApproveShadow, onRejectShadow, skipAnimationRef, ancestorIsMatched }: TreeNodeRowProps) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const role = getNodeRole(node);
  const hasDuplicate = !!(node.sourceUrl && duplicateUrls.has(node.sourceUrl));
  // This node is matched — its territory is covered by assigned GADM divisions
  const nodeIsMatched = ancestorIsMatched || node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched' || node.memberCount > 0;

  // Geocode progress for this specific node
  const nodeGeocodeMsg = geocodeProgress?.regionId === node.id ? geocodeProgress.message : null;

  // Intercept preview: if unreviewed candidates and no map URL, open picker first
  const shouldInterceptPreview = node.mapImageCandidates.length > 1 && !node.mapImageReviewed && !node.regionMapUrl;

  // Wrap onPreview to inject this node's regionMapUrl, wikidataId, regionId, and isAssigned
  const handlePreviewAssigned = useCallback(
    (divisionId: number, name: string, path?: string) => {
      if (shouldInterceptPreview) {
        onOpenMapPicker(node, { divisionId, name, path, isAssigned: true });
        return;
      }
      onPreview(divisionId, name, path, node.regionMapUrl ?? undefined, node.wikidataId ?? undefined, node.id, true);
    },
    [onPreview, node, shouldInterceptPreview, onOpenMapPicker],
  );
  const handlePreviewSuggestion = useCallback(
    (divisionId: number, name: string, path?: string) => {
      if (shouldInterceptPreview) {
        onOpenMapPicker(node, { divisionId, name, path, isAssigned: false });
        return;
      }
      onPreview(divisionId, name, path, node.regionMapUrl ?? undefined, node.wikidataId ?? undefined, node.id, false);
    },
    [onPreview, node, shouldInterceptPreview, onOpenMapPicker],
  );

  // For nodes with children, count resolved direct children
  const summary = useMemo(() => {
    if (!hasChildren) return null;
    return countDirectChildrenResolved(node.children, nodeIsMatched);
  }, [hasChildren, node.children, nodeIsMatched]);

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
          nodeGeocodeMsg={nodeGeocodeMsg}
          onDBSearch={onDBSearch}
          onAIMatch={onAIMatch}
          onDismissChildren={onDismissChildren}
          onSync={onSync}
          onHandleAsGrouping={onHandleAsGrouping}
          onGeocodeMatch={onGeocodeMatch}
          onResetMatch={onResetMatch}
          onManualFix={onManualFix}
        />
      </Box>

      {/* Content: division lists, suggestions, shadow insertions */}
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
        onApproveShadow={onApproveShadow}
        onRejectShadow={onRejectShadow}
        isMutating={isMutating}
      />

      {/* Children */}
      {hasChildren && (
        <Collapse in={isExpanded} timeout={skipAnimationRef.current ? 0 : 'auto'} unmountOnExit>
          {node.children.map(child => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onAccept={onAccept}
              onAcceptAndRejectRest={onAcceptAndRejectRest}
              onReject={onReject}
              onDBSearch={onDBSearch}
              onAIMatch={onAIMatch}
              onDismissChildren={onDismissChildren}
              onSync={onSync}
              onHandleAsGrouping={onHandleAsGrouping}
              onGeocodeMatch={onGeocodeMatch}
              onResetMatch={onResetMatch}
              onRejectRemaining={onRejectRemaining}
              onAcceptAll={onAcceptAll}
              onPreview={onPreview}
              onOpenMapPicker={onOpenMapPicker}
              onManualFix={onManualFix}
              isMutating={isMutating}
              dbSearchingRegionId={dbSearchingRegionId}
              aiMatchingRegionId={aiMatchingRegionId}
              dismissingRegionId={dismissingRegionId}
              syncingRegionId={syncingRegionId}
              groupingRegionId={groupingRegionId}
              geocodeMatchingRegionId={geocodeMatchingRegionId}
              geocodeProgress={geocodeProgress}
              duplicateUrls={duplicateUrls}
              syncedUrls={syncedUrls}
              shadowsByRegionId={shadowsByRegionId}
              onApproveShadow={onApproveShadow}
              onRejectShadow={onRejectShadow}
              skipAnimationRef={skipAnimationRef}
              ancestorIsMatched={nodeIsMatched}
            />
          ))}
          {/* Shadow insertions for create_region — show as synthetic child nodes */}
          {nodeShadows?.filter(s => s.action === 'create_region').map(shadow => (
            <Box
              key={`shadow-create-${shadow.gapDivisionId}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                pl: (depth + 1) * 3,
                py: 0.3,
                borderBottom: '1px solid',
                borderColor: 'divider',
                borderLeft: '2px dashed',
                borderLeftColor: 'warning.main',
                bgcolor: 'rgba(237, 108, 2, 0.06)',
                minHeight: 32,
              }}
            >
              <Box sx={{ width: 28, flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                + {shadow.gapDivisionName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                (new region)
              </Typography>
              <Tooltip title="Approve — create region and add member">
                <IconButton size="small" color="success" onClick={() => onApproveShadow?.(shadow)} disabled={isMutating} sx={{ p: 0.25 }}>
                  <CheckIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Reject">
                <IconButton size="small" color="error" onClick={() => onRejectShadow?.(shadow)} sx={{ p: 0.25 }}>
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Collapse>
      )}
    </Box>
  );
}

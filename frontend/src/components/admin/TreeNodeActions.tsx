import {
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
} from '@mui/icons-material';
import type { MatchTreeNode } from '../../api/adminWorldViewImport';
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
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
  onDismissChildren: (regionId: number) => void;
  onSync: (regionId: number) => void;
  onHandleAsGrouping: (regionId: number) => void;
  onGeocodeMatch: (regionId: number) => void;
  onGeoshapeMatch: (regionId: number) => void;
  onPointMatch: (regionId: number) => void;
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
  /** Whether this is a root node (depth 0) — remove button is hidden for root */
  isRoot?: boolean;
}

/** Geocode + Geoshape + DB search + AI match button group (shared across multiple status blocks) */
function SearchActionButtons({ nodeId, wikidataId, geoAvailable, nodeGeocodeMsg, isMutating, geocodeMatchingRegionId, geoshapeMatchingRegionId, pointMatchingRegionId, dbSearchingRegionId, aiMatchingRegionId, onGeocodeMatch, onGeoshapeMatch, onPointMatch, onDBSearch, onAIMatch }: {
  nodeId: number;
  wikidataId: string | null;
  geoAvailable: boolean | null;
  nodeGeocodeMsg: string | null;
  isMutating: boolean;
  geocodeMatchingRegionId: number | null;
  geoshapeMatchingRegionId: number | null;
  pointMatchingRegionId: number | null;
  dbSearchingRegionId: number | null;
  aiMatchingRegionId: number | null;
  onGeocodeMatch: (regionId: number) => void;
  onGeoshapeMatch: (regionId: number) => void;
  onPointMatch: (regionId: number) => void;
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
      <Tooltip title={!wikidataId ? 'No Wikidata ID' : geoAvailable === false ? 'No geoshape available' : 'Geoshape match (spatial)'}>
        <span>
          <IconButton
            size="small"
            onClick={() => onGeoshapeMatch(nodeId)}
            disabled={isMutating || anySearching || !wikidataId || geoAvailable === false}
            sx={{ p: 0.25 }}
          >
            {geoshapeMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <GeoshapeIcon sx={{ fontSize: 16, color: wikidataId && geoAvailable !== false ? 'success.main' : undefined }} />
            }
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={!wikidataId ? 'No Wikidata ID' : geoAvailable !== false ? 'Geoshape available — use geoshape match' : 'Point match (Wikivoyage markers)'}>
        <span>
          <IconButton
            size="small"
            onClick={() => onPointMatch(nodeId)}
            disabled={isMutating || anySearching || !wikidataId || geoAvailable !== false}
            sx={{ p: 0.25 }}
          >
            {pointMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <PointMatchIcon sx={{ fontSize: 16, color: wikidataId && geoAvailable === false ? 'warning.main' : undefined }} />
            }
          </IconButton>
        </span>
      </Tooltip>
      {nodeGeocodeMsg && (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', ml: -0.5 }}>
          {nodeGeocodeMsg}
        </Typography>
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
  isRoot,
}: TreeNodeActionsProps) {
  // Show dismiss button when node has children with unsuccessful match statuses
  const hasUnmatchedChildren = hasChildren && node.children.some(
    c => c.matchStatus === 'needs_review' || c.matchStatus === 'no_candidates' || c.matchStatus === 'suggested',
  );

  const searchButtonProps = {
    nodeId: node.id,
    wikidataId: node.wikidataId,
    geoAvailable: node.geoAvailable,
    nodeGeocodeMsg,
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
      {role === 'container' && summary && (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {summary.resolved}/{summary.total} matched
          {summary.total - summary.resolved > 0 && !ancestorIsMatched && (
            <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
              ({summary.total - summary.resolved} unresolved)
            </Typography>
          )}
        </Typography>
      )}

      {/* Status chips */}
      {role === 'country' && node.matchStatus === 'auto_matched' && (
        <Chip label="matched" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
      )}
      {role === 'country' && node.matchStatus === 'manual_matched' && (
        <Chip label="manual" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
      )}
      {role === 'country' && node.matchStatus === 'children_matched' && (
        <Chip label="matched" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
      )}

      {/* View map — opens geoshape/division preview for any node with wikidataId */}
      {onViewMap && node.wikidataId && (
        <Tooltip title="View map comparison">
          <span>
            <IconButton
              size="small"
              onClick={() => onViewMap(node.id)}
              sx={{ p: 0.25 }}
            >
              <ViewMapIcon sx={{ fontSize: 16, color: 'info.main' }} />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* CV color match — for parent nodes with children and a region map */}
      {onCVMatch && hasChildren && node.regionMapUrl && (
        <Tooltip title="CV color match (align country outline to map, cluster divisions by color)">
          <span>
            <IconButton
              size="small"
              onClick={() => onCVMatch(node.id)}
              disabled={isMutating || cvMatchingRegionId === node.id}
              sx={{ p: 0.25 }}
            >
              {cvMatchingRegionId === node.id
                ? <CircularProgress size={16} />
                : <CVMatchIcon sx={{ fontSize: 16, color: 'secondary.main' }} />}
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Mapshape match — for parent nodes with children and a Wikivoyage source page */}
      {onMapshapeMatch && hasChildren && node.sourceUrl && (
        <Tooltip title="Mapshape match (Kartographer region boundaries from Wikivoyage)">
          <span>
            <IconButton
              size="small"
              onClick={() => onMapshapeMatch(node.id)}
              disabled={isMutating || mapshapeMatchingRegionId === node.id}
              sx={{ p: 0.25 }}
            >
              {mapshapeMatchingRegionId === node.id
                ? <CircularProgress size={16} />
                : <MapshapeMatchIcon sx={{ fontSize: 16, color: 'info.main' }} />}
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Dismiss subregions button */}
      {hasUnmatchedChildren && (
        <Tooltip title="Dismiss subregions (make leaf)">
          <span>
            <IconButton
              size="small"
              onClick={() => onDismissChildren(node.id)}
              disabled={isMutating || dismissingRegionId !== null}
              sx={{ p: 0.25 }}
            >
              {dismissingRegionId === node.id
                ? <CircularProgress size={14} />
                : <DismissChildrenIcon sx={{ fontSize: 16 }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Prune to leaves: keep direct children, remove grandchildren+ */}
      {hasChildren && onPruneToLeaves && (
        <Tooltip title="Prune to leaves (keep children, remove grandchildren+)">
          <span>
            <IconButton
              size="small"
              onClick={() => onPruneToLeaves(node.id)}
              disabled={isMutating || pruningRegionId !== null}
              sx={{ p: 0.25 }}
            >
              {pruningRegionId === node.id
                ? <CircularProgress size={14} />
                : <PruneToLeavesIcon sx={{ fontSize: 16 }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Collapse to parent: clear children data, generate parent suggestions */}
      {hasChildren && onCollapseToParent && (
        <Tooltip title="Clear children's matches, generate suggestions for this region">
          <span>
            <IconButton
              size="small"
              onClick={() => onCollapseToParent(node.id)}
              disabled={isMutating || collapsingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {collapsingRegionId === node.id
                ? <CircularProgress size={14} />
                : <CollapseToParentIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Merge single child into parent */}
      {role === 'container' && node.children.length === 1 && onMergeChild && (
        <Tooltip title="Merge single child into this node">
          <span>
            <IconButton
              size="small"
              onClick={() => onMergeChild(node.id)}
              disabled={isMutating || mergingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {mergingRegionId === node.id
                ? <CircularProgress size={14} />
                : <MergeIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Smart flatten — absorb children's divisions */}
      {hasChildren && node.children.length > 1 && onSmartFlatten && (
        node.matchStatus == null || node.matchStatus === 'no_candidates' || node.matchStatus === 'children_matched'
      ) && (
        <Tooltip title="Smart flatten: match children to GADM, absorb their divisions">
          <span>
            <IconButton
              size="small"
              onClick={() => onSmartFlatten(node.id)}
              disabled={isMutating || flatteningRegionId != null}
              sx={{ p: 0.25 }}
            >
              {flatteningRegionId === node.id
                ? <CircularProgress size={14} />
                : <SmartFlattenIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Auto-resolve children: batch-match all unmatched leaf descendants */}
      {hasChildren && onAutoResolve && hasUnmatchedChildren && (
        <Tooltip title="Auto-resolve: batch-match all unmatched leaf descendants">
          <span>
            <IconButton
              size="small"
              onClick={() => onAutoResolve(node.id)}
              disabled={isMutating || autoResolvingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {autoResolvingRegionId === node.id
                ? <CircularProgress size={14} />
                : <AutoResolveIcon sx={{ fontSize: 16, color: 'success.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* AI review subtree */}
      {hasChildren && onReviewSubtree && (
        <Tooltip title="AI review of this branch">
          <span>
            <IconButton
              size="small"
              onClick={() => onReviewSubtree(node.id)}
              disabled={isMutating || reviewingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {reviewingRegionId === node.id
                ? <CircularProgress size={14} />
                : <ReviewSubtreeIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Rename region */}
      {onRename && (
        <Tooltip title="Rename region">
          <span>
            <IconButton
              size="small"
              onClick={() => onRename(node.id, node.name)}
              disabled={isMutating || renamingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {renamingRegionId === node.id
                ? <CircularProgress size={14} />
                : <RenameIcon sx={{ fontSize: 16 }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Move region to new parent */}
      {!isRoot && onReparent && (
        <Tooltip title="Move to different parent">
          <span>
            <IconButton
              size="small"
              onClick={() => onReparent(node.id, null)}
              disabled={isMutating || reparentingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {reparentingRegionId === node.id
                ? <CircularProgress size={14} />
                : <ReparentIcon sx={{ fontSize: 16 }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Remove region from import tree */}
      {!isRoot && onRemoveRegion && (
        <Tooltip title="Remove region from tree">
          <span>
            <IconButton
              size="small"
              onClick={() => onRemoveRegion(node.id)}
              disabled={isMutating || removingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {removingRegionId === node.id
                ? <CircularProgress size={14} />
                : <RemoveRegionIcon sx={{ fontSize: 16, color: 'error.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

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
      {hasChildren && node.matchStatus != null && node.matchStatus !== 'children_matched' && (
        <Tooltip title="Match children independently (drill down)">
          <span>
            <IconButton
              size="small"
              onClick={() => onHandleAsGrouping(node.id)}
              disabled={isMutating || groupingRegionId !== null}
              sx={{ p: 0.25 }}
            >
              {groupingRegionId === node.id
                ? <CircularProgress size={14} />
                : <GroupingIcon sx={{ fontSize: 16 }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Sync to other instances button */}
      {role === 'country' && hasDuplicate && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched' || node.matchStatus === 'children_matched') && (() => {
        const isSynced = !!(node.sourceUrl && syncedUrls.has(node.sourceUrl));
        return (
          <Tooltip title={isSynced ? 'Already in sync' : 'Sync to other instances'}>
            <span>
              <IconButton
                size="small"
                onClick={() => onSync(node.id)}
                disabled={isMutating || syncingRegionId !== null || isSynced}
                sx={{ p: 0.25 }}
              >
                {syncingRegionId === node.id
                  ? <CircularProgress size={14} />
                  : <SyncIcon sx={{ fontSize: 16 }} />
                }
              </IconButton>
            </span>
          </Tooltip>
        );
      })()}

      {/* Clear all assigned divisions (keep suggestions) */}
      {role === 'country' && node.assignedDivisions.length > 0 && onClearMembers && (
        <Tooltip title={`Clear all ${node.assignedDivisions.length} assigned division${node.assignedDivisions.length > 1 ? 's' : ''}`}>
          <span>
            <IconButton
              size="small"
              onClick={() => onClearMembers(node.id)}
              disabled={isMutating || clearingMembersRegionId != null}
              sx={{ p: 0.25 }}
            >
              {clearingMembersRegionId === node.id
                ? <CircularProgress size={14} />
                : <ClearAssignedIcon sx={{ fontSize: 16, color: 'warning.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Reset match state */}
      {node.matchStatus != null && (
        <Tooltip title="Reset match (clear suggestions & rejections)">
          <span>
            <IconButton
              size="small"
              onClick={() => onResetMatch(node.id)}
              disabled={isMutating}
              sx={{ p: 0.25 }}
            >
              <ResetIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Add child region (available on all nodes) */}
      {onAddChild && (
        <Tooltip title="Add child region">
          <span>
            <IconButton
              size="small"
              onClick={() => onAddChild(node.id)}
              disabled={isMutating}
              sx={{ p: 0.25 }}
            >
              <AddChildIcon sx={{ fontSize: 16, color: 'info.main' }} />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* AI suggest missing children (Wikivoyage + AI) */}
      {node.sourceUrl && onAISuggestChildren && (
        <Tooltip title="AI suggest missing children">
          <span>
            <IconButton
              size="small"
              onClick={() => onAISuggestChildren(node.id)}
              disabled={isMutating || aiSuggestingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {aiSuggestingRegionId === node.id
                ? <CircularProgress size={14} />
                : <SuggestChildrenIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Manual division search — assign a GADM division by name search */}
      {onManualDivisionSearch && node.matchStatus != null && (
        <Tooltip title="Search and assign GADM division">
          <span>
            <IconButton
              size="small"
              onClick={() => onManualDivisionSearch(node.id)}
              disabled={isMutating}
              sx={{ p: 0.25 }}
            >
              <DivisionSearchIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Dismiss hierarchy warnings (shown on nodes with unreviewed warnings) */}
      {node.hierarchyWarnings.length > 0 && !node.hierarchyReviewed && onDismissHierarchyWarnings && (
        <Tooltip title="Dismiss hierarchy warnings">
          <span>
            <IconButton
              size="small"
              onClick={() => onDismissHierarchyWarnings(node.id)}
              disabled={isMutating}
              sx={{ p: 0.25 }}
            >
              <DismissWarningsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Manual fix flag */}
      {node.matchStatus != null && (
        <Tooltip title={node.needsManualFix ? (node.fixNote ?? 'Needs manual fix — click to clear') : 'Mark as needing manual fix'}>
          <span>
            <IconButton
              size="small"
              onClick={() => onManualFix(node.id, !node.needsManualFix)}
              disabled={isMutating}
              sx={{ p: 0.25 }}
            >
              <ManualFixIcon sx={{ fontSize: 16, color: node.needsManualFix ? 'error.main' : 'text.disabled' }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {node.needsManualFix && node.fixNote && (
        <Typography variant="caption" color="error" sx={{ fontSize: '0.65rem', fontStyle: 'italic' }}>
          {node.fixNote}
        </Typography>
      )}
    </>
  );
}

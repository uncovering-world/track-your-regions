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
  RestartAlt as ResetIcon,
  Build as ManualFixIcon,
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
  nodeGeocodeMsg: string | null;
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
  onDismissChildren: (regionId: number) => void;
  onSync: (regionId: number) => void;
  onHandleAsGrouping: (regionId: number) => void;
  onGeocodeMatch: (regionId: number) => void;
  onResetMatch: (regionId: number) => void;
  onManualFix: (regionId: number, needsManualFix: boolean) => void;
}

/** Geocode + DB search + AI match button group (shared across multiple status blocks) */
function SearchActionButtons({ nodeId, nodeGeocodeMsg, isMutating, geocodeMatchingRegionId, dbSearchingRegionId, aiMatchingRegionId, onGeocodeMatch, onDBSearch, onAIMatch }: {
  nodeId: number;
  nodeGeocodeMsg: string | null;
  isMutating: boolean;
  geocodeMatchingRegionId: number | null;
  dbSearchingRegionId: number | null;
  aiMatchingRegionId: number | null;
  onGeocodeMatch: (regionId: number) => void;
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
}) {
  return (
    <>
      <Tooltip title={nodeGeocodeMsg ?? 'Geocode match'}>
        <IconButton
          size="small"
          onClick={() => onGeocodeMatch(nodeId)}
          disabled={isMutating || geocodeMatchingRegionId !== null || dbSearchingRegionId !== null || aiMatchingRegionId !== null}
          sx={{ p: 0.25 }}
        >
          {geocodeMatchingRegionId === nodeId
            ? <CircularProgress size={14} />
            : <GeocodeIcon sx={{ fontSize: 16 }} />
          }
        </IconButton>
      </Tooltip>
      {nodeGeocodeMsg && (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', ml: -0.5 }}>
          {nodeGeocodeMsg}
        </Typography>
      )}
      <Tooltip title="DB search">
        <IconButton
          size="small"
          onClick={() => onDBSearch(nodeId)}
          disabled={isMutating || dbSearchingRegionId !== null || aiMatchingRegionId !== null}
          sx={{ p: 0.25 }}
        >
          {dbSearchingRegionId === nodeId
            ? <CircularProgress size={14} />
            : <SearchIcon sx={{ fontSize: 16 }} />
          }
        </IconButton>
      </Tooltip>
      <Tooltip title="AI match">
        <IconButton
          size="small"
          onClick={() => onAIMatch(nodeId)}
          disabled={isMutating || aiMatchingRegionId !== null || dbSearchingRegionId !== null}
          sx={{ p: 0.25 }}
        >
          {aiMatchingRegionId === nodeId
            ? <CircularProgress size={14} />
            : <AIIcon sx={{ fontSize: 16 }} />
          }
        </IconButton>
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
  nodeGeocodeMsg,
  onDBSearch,
  onAIMatch,
  onDismissChildren,
  onSync,
  onHandleAsGrouping,
  onGeocodeMatch,
  onResetMatch,
  onManualFix,
}: TreeNodeActionsProps) {
  // Show dismiss button when node has children with unsuccessful match statuses
  const hasUnmatchedChildren = hasChildren && node.children.some(
    c => c.matchStatus === 'needs_review' || c.matchStatus === 'no_candidates' || c.matchStatus === 'suggested',
  );

  // Show "match parent" button when all matchable descendants failed to find candidates (deep check)
  const allChildrenUnmatched = hasChildren && summary != null && summary.total > 0 && summary.resolved === 0;

  const searchButtonProps = {
    nodeId: node.id,
    nodeGeocodeMsg,
    isMutating,
    geocodeMatchingRegionId,
    dbSearchingRegionId,
    aiMatchingRegionId,
    onGeocodeMatch,
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

      {/* Dismiss subregions button */}
      {hasUnmatchedChildren && (
        <Tooltip title="Dismiss subregions (make leaf)">
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
        </Tooltip>
      )}

      {/* Container with all children unmatched — search buttons */}
      {role === 'container' && allChildrenUnmatched && !ancestorIsMatched && (
        <SearchActionButtons {...searchButtonProps} />
      )}

      {/* Container with no_candidates + unresolved descendants */}
      {role === 'container' && node.matchStatus === 'no_candidates' && !ancestorIsMatched && !allChildrenUnmatched && summary && summary.resolved < summary.total && (
        <>
          <Chip label="no match" color="default" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
          <SearchActionButtons {...searchButtonProps} />
        </>
      )}

      {/* Country: no_candidates */}
      {role === 'country' && node.matchStatus === 'no_candidates' && !ancestorIsMatched && (
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

      {/* Reset match state */}
      {node.matchStatus != null && (
        <Tooltip title="Reset match (clear suggestions & rejections)">
          <IconButton
            size="small"
            onClick={() => onResetMatch(node.id)}
            disabled={isMutating}
            sx={{ p: 0.25 }}
          >
            <ResetIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
          </IconButton>
        </Tooltip>
      )}

      {/* Manual fix flag */}
      {node.matchStatus != null && (
        <Tooltip title={node.needsManualFix ? (node.fixNote ?? 'Needs manual fix — click to clear') : 'Mark as needing manual fix'}>
          <IconButton
            size="small"
            onClick={() => onManualFix(node.id, !node.needsManualFix)}
            disabled={isMutating}
            sx={{ p: 0.25 }}
          >
            <ManualFixIcon sx={{ fontSize: 16, color: node.needsManualFix ? 'error.main' : 'text.disabled' }} />
          </IconButton>
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

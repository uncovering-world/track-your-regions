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
  RestartAlt as ResetIcon,
  Build as ManualFixIcon,
  LowPriority as SimplifyIcon,
  PlaylistAddCheck as SimplifyChildrenIcon,
  SwapHoriz as SmartSimplifyIcon,
  Terrain as GeoshapeIcon,
  ScatterPlot as PointMatchIcon,
  RateReview as ReviewChildrenIcon,
  Palette as CVMatchIcon,
  Map as MapshapeMatchIcon,
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
  nodeGeocodeNextScope?: { ancestorId: number; ancestorName: string };
  nodeGeocodeRetryType?: 'geoshape' | 'point';
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
  onDismissChildren: (regionId: number) => void;
  onSimplifyHierarchy?: (regionId: number) => void;
  simplifyingRegionId?: number | null;
  onSimplifyChildren?: (regionId: number) => void;
  simplifyingChildrenRegionId?: number | null;
  onSmartSimplify?: (regionId: number) => void;
  onAISuggestChildren?: (regionId: number) => void;
  aiSuggestingRegionId?: number | null;
  onCVMatch?: (regionId: number) => void;
  cvMatchingRegionId?: number | null;
  onMapshapeMatch?: (regionId: number) => void;
  mapshapeMatchingRegionId?: number | null;
  onSync: (regionId: number) => void;
  onHandleAsGrouping: (regionId: number) => void;
  onGeocodeMatch: (regionId: number) => void;
  onGeoshapeMatch: (regionId: number, scopeAncestorId?: number) => void;
  onPointMatch: (regionId: number, scopeAncestorId?: number) => void;
  onResetMatch: (regionId: number) => void;
  onManualFix: (regionId: number, needsManualFix: boolean) => void;
}

/** Geocode + DB search + AI match + geoshape + point-match button group (shared across multiple status blocks) */
function SearchActionButtons({ nodeId, wikidataId, geoAvailable, nodeGeocodeMsg, nodeGeocodeNextScope, nodeGeocodeRetryType, isMutating, geocodeMatchingRegionId, geoshapeMatchingRegionId, pointMatchingRegionId, dbSearchingRegionId, aiMatchingRegionId, onGeocodeMatch, onDBSearch, onAIMatch, onGeoshapeMatch, onPointMatch }: {
  nodeId: number;
  wikidataId: string | null;
  geoAvailable: boolean | null;
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
  onDBSearch: (regionId: number) => void;
  onAIMatch: (regionId: number) => void;
  onGeoshapeMatch: (regionId: number, scopeAncestorId?: number) => void;
  onPointMatch: (regionId: number, scopeAncestorId?: number) => void;
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
            disabled={isMutating || dbSearchingRegionId !== null || aiMatchingRegionId !== null}
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
            disabled={isMutating || aiMatchingRegionId !== null || dbSearchingRegionId !== null}
            sx={{ p: 0.25 }}
          >
            {aiMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <AIIcon sx={{ fontSize: 16 }} />
            }
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Geoshape match — union Wikidata geoshape with GADM divisions">
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
      <Tooltip title="Point match — extract Wikivoyage marker coords and find GADM divisions">
        <span>
          <IconButton
            size="small"
            onClick={() => onPointMatch(nodeId)}
            disabled={isMutating || anySearching || !wikidataId || geoAvailable !== false}
            sx={{ p: 0.25 }}
          >
            {pointMatchingRegionId === nodeId
              ? <CircularProgress size={14} />
              : <PointMatchIcon sx={{ fontSize: 16, color: (wikidataId && geoAvailable === false) ? 'warning.main' : undefined }} />
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
  simplifyingRegionId,
  simplifyingChildrenRegionId,
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
  onSimplifyHierarchy,
  onSimplifyChildren,
  onSmartSimplify,
  onAISuggestChildren,
  aiSuggestingRegionId,
  onCVMatch,
  cvMatchingRegionId,
  onMapshapeMatch,
  mapshapeMatchingRegionId,
  onSync,
  onHandleAsGrouping,
  onGeocodeMatch,
  onGeoshapeMatch,
  onPointMatch,
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
    wikidataId: node.wikidataId ?? null,
    geoAvailable: node.geoAvailable ?? null,
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
    onDBSearch,
    onAIMatch,
    onGeoshapeMatch,
    onPointMatch,
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

      {/* Simplify hierarchy — merge child divisions into parents where all siblings assigned */}
      {node.assignedDivisions.length >= 2 &&
        (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched') &&
        !!onSimplifyHierarchy && (
        <Tooltip title="Simplify — merge child divisions into parents where all children are assigned">
          <span>
            <IconButton
              size="small"
              onClick={() => onSimplifyHierarchy(node.id)}
              disabled={isMutating || simplifyingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {simplifyingRegionId === node.id
                ? <CircularProgress size={14} />
                : <SimplifyIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Simplify children — apply simplification to each direct child independently */}
      {hasChildren && !!onSimplifyChildren && (
        <Tooltip title="Simplify children — merge child divisions into parents for each child region">
          <span>
            <IconButton
              size="small"
              onClick={() => onSimplifyChildren(node.id)}
              disabled={isMutating || simplifyingChildrenRegionId != null}
              sx={{ p: 0.25 }}
            >
              {simplifyingChildrenRegionId === node.id
                ? <CircularProgress size={14} />
                : <SimplifyChildrenIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Smart Simplify — detect and fix cross-sibling division splits */}
      {hasChildren && !!onSmartSimplify && (
        <Tooltip title="Smart Simplify — detect divisions split across sibling regions">
          <span>
            <IconButton
              size="small"
              onClick={() => onSmartSimplify(node.id)}
              disabled={isMutating}
              sx={{ p: 0.25 }}
            >
              <SmartSimplifyIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
            </IconButton>
          </span>
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

      {/* CV color match — for parent nodes with children and a region map image */}
      {onCVMatch && hasChildren && !!node.regionMapUrl && (
        <Tooltip title="CV color match (gap divisions only)">
          <span>
            <IconButton
              size="small"
              onClick={() => onCVMatch(node.id)}
              disabled={isMutating || cvMatchingRegionId === node.id}
              sx={{ p: 0.25 }}
            >
              {cvMatchingRegionId === node.id
                ? <CircularProgress size={14} />
                : <CVMatchIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Mapshape match — for parent nodes with children and a Wikivoyage source page */}
      {onMapshapeMatch && hasChildren && !!node.sourceUrl && (
        <Tooltip title="Mapshape match (Kartographer region boundaries from Wikivoyage)">
          <span>
            <IconButton
              size="small"
              onClick={() => onMapshapeMatch(node.id)}
              disabled={isMutating || mapshapeMatchingRegionId === node.id}
              sx={{ p: 0.25 }}
            >
              {mapshapeMatchingRegionId === node.id
                ? <CircularProgress size={14} />
                : <MapshapeMatchIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* AI review children (Wikivoyage + AI audit + enrichment) */}
      {node.sourceUrl && onAISuggestChildren && (
        <Tooltip title="AI review children">
          <span>
            <IconButton
              size="small"
              onClick={() => onAISuggestChildren(node.id)}
              disabled={isMutating || aiSuggestingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {aiSuggestingRegionId === node.id
                ? <CircularProgress size={14} />
                : <ReviewChildrenIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}
    </>
  );
}

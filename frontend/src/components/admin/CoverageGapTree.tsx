/**
 * Coverage Gap Tree Components
 *
 * GapNodeRow and SubtreeNodeRow -- recursive tree display for GADM coverage gaps.
 * Also includes ContextTreeNode for geo-suggest hierarchy selection.
 */

import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Collapse,
  Stack,
} from '@mui/material';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import Public from '@mui/icons-material/Public';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Undo from '@mui/icons-material/Undo';
import type {
  CoverageGap,
  SubtreeNode,
  GeoSuggestResult,
  RegionContextNode,
} from '../../api/adminWorldViewImport';
import { allLeavesApplied } from './coverageResolveUtils';

// =============================================================================
// GapNodeRow -- renders a single gap and its subtree recursively
// =============================================================================

interface GapNodeRowProps {
  gap: CoverageGap;
  depth: number;
  selectedNodeId: number | null;
  expandedNodes: Set<number>;
  nodeSuggestions: Map<number, GeoSuggestResult>;
  appliedNodes: Set<number>;
  getNodeSuggestion: (id: number, treeSugg: CoverageGap['suggestion'] | null) => CoverageGap['suggestion'] | null;
  onSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onGeoSuggest: (id: number, name: string) => void;
  onDismiss: (id: number) => void;
  onApplySingle: (id: number, name: string) => void;
  onUnapply: (id: number) => void;
  geoSuggestPending: boolean;
  dismissPending: boolean;
}

export function GapNodeRow({
  gap,
  depth,
  selectedNodeId,
  expandedNodes,
  nodeSuggestions,
  appliedNodes,
  getNodeSuggestion,
  onSelect,
  onToggleExpand,
  onGeoSuggest,
  onDismiss,
  onApplySingle,
  onUnapply,
  geoSuggestPending,
  dismissPending,
}: GapNodeRowProps) {
  const hasSubtree = gap.subtree && gap.subtree.length > 0;
  const directlyApplied = appliedNodes.has(gap.id);
  // Parent is effectively applied if all its subtree leaves are applied
  const childrenResolved = hasSubtree && allLeavesApplied(gap.subtree!, appliedNodes);
  const isApplied = directlyApplied || childrenResolved;
  const isExpanded = expandedNodes.has(gap.id) && !isApplied;
  const isSelected = selectedNodeId === gap.id;
  const effectiveSuggestion = getNodeSuggestion(gap.id, gap.suggestion);
  const geoResult = nodeSuggestions.get(gap.id);

  return (
    <Box sx={isApplied ? { opacity: 0.45 } : undefined}>
      {/* Gap node row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: depth * 2.5,
          py: 0.25,
          pr: 0.5,
          borderRadius: 1,
          bgcolor: isSelected ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
          cursor: 'pointer',
        }}
        onClick={() => !isApplied && onSelect(gap.id)}
      >
        {/* Expand toggle */}
        {hasSubtree && !isApplied ? (
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(gap.id); }}
            sx={{ p: 0.25 }}
          >
            {isExpanded ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
          </IconButton>
        ) : (
          <Box sx={{ width: 26 }} />
        )}

        {/* Name */}
        <Typography variant="body2" sx={{ flex: 1, ml: 0.5, minWidth: 0 }} noWrap>
          {gap.name}
        </Typography>

        {/* Action buttons */}
        <Stack direction="row" spacing={0} sx={{ flexShrink: 0 }}>
          {isApplied ? (
            <Tooltip title="Undo apply">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); onUnapply(gap.id); }}
              >
                <Undo sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <>
              <Tooltip title="Geo-suggest (find nearest region)">
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); onGeoSuggest(gap.id, gap.name); }}
                    disabled={geoSuggestPending}
                  >
                    <Public sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              {effectiveSuggestion && (
                <Tooltip title={`Apply: ${effectiveSuggestion.action === 'add_member' ? 'Add to' : 'Create under'} ${effectiveSuggestion.targetRegionName}`}>
                  <IconButton
                    size="small"
                    color="success"
                    onClick={(e) => { e.stopPropagation(); onApplySingle(gap.id, gap.name); }}
                  >
                    <CheckCircle sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="Dismiss">
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); onDismiss(gap.id); }}
                    disabled={dismissPending}
                  >
                    <VisibilityOff sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
        </Stack>
      </Box>

      {/* Suggestion chip */}
      {effectiveSuggestion && !isApplied && (
        <Box sx={{ pl: depth * 2.5 + 3.5, py: 0.25 }}>
          <Chip
            label={`${effectiveSuggestion.action === 'add_member' ? '+ Add to' : '+ Create under'} ${effectiveSuggestion.targetRegionName}${geoResult?.distanceKm ? ` (${geoResult.distanceKm.toLocaleString()} km)` : ''}`}
            size="small"
            variant="outlined"
            color="info"
            sx={{ height: 22, fontSize: '0.7rem' }}
          />
        </Box>
      )}

      {/* Subtree children */}
      {hasSubtree && (
        <Collapse in={isExpanded} unmountOnExit>
          {gap.subtree!.map((child) => (
            <SubtreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              expandedNodes={expandedNodes}
              nodeSuggestions={nodeSuggestions}
              appliedNodes={appliedNodes}
              getNodeSuggestion={getNodeSuggestion}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onGeoSuggest={onGeoSuggest}
              onApplySingle={onApplySingle}
              onUnapply={onUnapply}
              geoSuggestPending={geoSuggestPending}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

// =============================================================================
// SubtreeNodeRow -- renders a GADM subtree child node (with per-node actions)
// =============================================================================

interface SubtreeNodeRowProps {
  node: SubtreeNode;
  depth: number;
  selectedNodeId: number | null;
  expandedNodes: Set<number>;
  nodeSuggestions: Map<number, GeoSuggestResult>;
  appliedNodes: Set<number>;
  getNodeSuggestion: (id: number, treeSugg: CoverageGap['suggestion'] | null) => CoverageGap['suggestion'] | null;
  onSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onGeoSuggest: (id: number, name: string) => void;
  onApplySingle: (id: number, name: string) => void;
  onUnapply: (id: number) => void;
  geoSuggestPending: boolean;
}

function SubtreeNodeRow({
  node,
  depth,
  selectedNodeId,
  expandedNodes,
  nodeSuggestions,
  appliedNodes,
  getNodeSuggestion,
  onSelect,
  onToggleExpand,
  onGeoSuggest,
  onApplySingle,
  onUnapply,
  geoSuggestPending,
}: SubtreeNodeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id) && !appliedNodes.has(node.id);
  const isSelected = selectedNodeId === node.id;
  const isApplied = appliedNodes.has(node.id);
  const geoResult = nodeSuggestions.get(node.id);
  const effectiveSuggestion = getNodeSuggestion(node.id, null);

  return (
    <Box sx={isApplied ? { opacity: 0.45 } : undefined}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: depth * 2.5,
          py: 0.25,
          pr: 0.5,
          borderRadius: 1,
          bgcolor: isSelected ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
          cursor: 'pointer',
        }}
        onClick={() => !isApplied && onSelect(node.id)}
      >
        {hasChildren && !isApplied ? (
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id); }}
            sx={{ p: 0.25 }}
          >
            {isExpanded ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
          </IconButton>
        ) : (
          <Box sx={{ width: 26 }} />
        )}

        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, ml: 0.5, minWidth: 0 }} noWrap>
          {node.name}
        </Typography>

        <Stack direction="row" spacing={0} sx={{ flexShrink: 0 }}>
          {isApplied ? (
            <Tooltip title="Undo apply">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); onUnapply(node.id); }}
              >
                <Undo sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <>
              <Tooltip title="Geo-suggest (find nearest region)">
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); onGeoSuggest(node.id, node.name); }}
                    disabled={geoSuggestPending}
                  >
                    <Public sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              {effectiveSuggestion && (
                <Tooltip title={`Apply: ${effectiveSuggestion.action === 'add_member' ? 'Add to' : 'Create under'} ${effectiveSuggestion.targetRegionName}`}>
                  <IconButton
                    size="small"
                    color="success"
                    onClick={(e) => { e.stopPropagation(); onApplySingle(node.id, node.name); }}
                  >
                    <CheckCircle sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </>
          )}
        </Stack>
      </Box>

      {/* Suggestion chip */}
      {effectiveSuggestion && !isApplied && (
        <Box sx={{ pl: depth * 2.5 + 3.5, py: 0.25 }}>
          <Chip
            label={`${effectiveSuggestion.action === 'add_member' ? '+ Add to' : '+ Create under'} ${effectiveSuggestion.targetRegionName}${geoResult?.distanceKm ? ` (${geoResult.distanceKm.toLocaleString()} km)` : ''}`}
            size="small"
            variant="outlined"
            color="info"
            sx={{ height: 22, fontSize: '0.7rem' }}
          />
        </Box>
      )}

      {hasChildren && (
        <Collapse in={isExpanded} unmountOnExit>
          {node.children.map((child) => (
            <SubtreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              expandedNodes={expandedNodes}
              nodeSuggestions={nodeSuggestions}
              appliedNodes={appliedNodes}
              getNodeSuggestion={getNodeSuggestion}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onGeoSuggest={onGeoSuggest}
              onApplySingle={onApplySingle}
              onUnapply={onUnapply}
              geoSuggestPending={geoSuggestPending}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

// =============================================================================
// ContextTreeNode -- compact mini-tree for geo-suggest hierarchy selection
// =============================================================================

interface ContextTreeNodeProps {
  node: RegionContextNode;
  depth: number;
  selectedId: number;
  onSelect: (id: number, name: string) => void;
}

export function ContextTreeNode({ node, depth, selectedId, onSelect }: ContextTreeNodeProps) {
  const isSelected = node.id === selectedId;
  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: depth * 2,
          py: 0.125,
          cursor: 'pointer',
          borderRadius: 1,
          bgcolor: isSelected ? 'primary.main' : 'transparent',
          color: isSelected ? 'primary.contrastText' : 'text.primary',
          '&:hover': { bgcolor: isSelected ? 'primary.main' : 'action.hover' },
        }}
        onClick={() => onSelect(node.id, node.name)}
      >
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.8rem',
            fontWeight: node.isSuggested ? 700 : 400,
            pl: 0.5,
          }}
        >
          {node.isSuggested ? '\u25CF ' : '\u25CB '}
          {node.name}
        </Typography>
      </Box>
      {node.children.map(child => (
        <ContextTreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

/**
 * WorkspaceTree — Scoped virtualized tree for the country workspace.
 *
 * Shows only the subtree rooted at the work unit, with state-only row indicators
 * (status chip, division count, warnings). No action icons — everything via ActionPanel.
 *
 * Virtualization: @tanstack/react-virtual (same setup as WorldViewImportTree).
 */

import { useState, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Box,
  Chip,
  Typography,
  Tooltip,
} from '@mui/material';
import {
  ChevronRight as ExpandIcon,
  ExpandMore as CollapseIcon,
} from '@mui/icons-material';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import { flattenSubtree } from './workspaceUtils';

// ─── Status chip helpers ─────────────────────────────────────────────────────

type StatusStyle = { label: string; color: 'success' | 'info' | 'warning' | 'default' };

function statusStyle(status: string | null): StatusStyle {
  switch (status) {
    // Camel-case variants from MatchTreeNode + snake_case API values (I7)
    case 'manual_matched':
    case 'auto_matched':
    case 'children_matched':  return { label: 'matched', color: 'success' };
    case 'suggested':         return { label: 'suggested', color: 'info' };
    case 'needs_review':      return { label: 'review', color: 'warning' };
    case 'no_candidates':     return { label: 'no match', color: 'default' };
    default:                  return { label: status ?? 'unknown', color: 'default' };
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface WorkspaceTreeProps {
  root: MatchTreeNode;
  selectedId: number;
  hoveredId: number | null;
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
}

// ─── WorkspaceTree ───────────────────────────────────────────────────────────

export function WorkspaceTree({
  root,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: WorkspaceTreeProps) {
  // Default: root and its direct children expanded
  const defaultExpanded = new Set<number>([root.id, ...root.children.map(c => c.id)]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(defaultExpanded);

  const toggleExpand = useCallback((nodeId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const rows = flattenSubtree(root, expandedIds);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  return (
    <Box
      ref={scrollRef}
      sx={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <Box
        sx={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualItem => {
          const row = rows[virtualItem.index];
          const { node, depth } = row;
          const hasChildren = node.children.length > 0;
          const isExpanded = expandedIds.has(node.id);
          const isSelected = node.id === selectedId;
          const isHovered = node.id === hoveredId;
          const style = statusStyle(node.matchStatus);

          let rowBgColor = 'transparent';
          if (isSelected) rowBgColor = 'action.selected';
          else if (isHovered) rowBgColor = 'action.hover';

          return (
            <Box
              key={node.id}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              onClick={() => onSelect(node.id)}
              onMouseEnter={() => onHover(node.id)}
              onMouseLeave={() => onHover(null)}
              sx={{
                position: 'absolute',
                top: virtualItem.start,
                left: 0,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.25,
                pl: `${8 + depth * 16}px`,
                cursor: 'pointer',
                bgcolor: rowBgColor,
                '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
                minHeight: 36,
              }}
            >
              {/* Expand/collapse caret */}
              {hasChildren ? (
                <Box
                  component="span"
                  onClick={(e) => toggleExpand(node.id, e)}
                  sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'text.secondary' }}
                >
                  {isExpanded
                    ? <CollapseIcon sx={{ fontSize: 16 }} />
                    : <ExpandIcon sx={{ fontSize: 16 }} />
                  }
                </Box>
              ) : (
                <Box sx={{ width: 16, flexShrink: 0 }} />
              )}

              {/* Name */}
              <Typography
                variant="body2"
                noWrap
                sx={{ flex: 1, fontWeight: isSelected ? 600 : 400, minWidth: 0 }}
              >
                {node.name}
              </Typography>

              {/* State indicators — right-aligned */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                {/* Status chip */}
                <Chip
                  label={style.label}
                  color={style.color}
                  size="small"
                  sx={{ height: 18, fontSize: '0.65rem' }}
                />

                {/* Division count badge */}
                {node.assignedDivisions.length > 0 && (
                  <Tooltip title={`${node.assignedDivisions.length} assigned division(s)`}>
                    <Chip
                      label={`${node.assignedDivisions.length}d`}
                      size="small"
                      variant="outlined"
                      sx={{ height: 18, fontSize: '0.65rem' }}
                    />
                  </Tooltip>
                )}

                {/* Unreviewed warnings */}
                {node.hierarchyWarnings.length > 0 && !node.hierarchyReviewed && (
                  <Tooltip title={node.hierarchyWarnings.join('; ')}>
                    <Chip
                      label="⚠"
                      size="small"
                      color="warning"
                      variant="outlined"
                      sx={{ height: 18, fontSize: '0.65rem' }}
                    />
                  </Tooltip>
                )}

                {/* Waived indicator */}
                {node.assignmentWaived && (
                  <Chip
                    label="waived"
                    size="small"
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem', color: 'text.secondary' }}
                  />
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

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
  CircularProgress,
  Link,
  Typography,
  Tooltip,
} from '@mui/material';
import {
  ChevronRight as ExpandIcon,
  ExpandMore as CollapseIcon,
  OpenInNew as OpenInNewIcon,
  Build as ManualFixIcon,
  PublicOff as PublicOffIcon,
} from '@mui/icons-material';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { ChildrenCoverageResult } from '../../../api/admin/wvImportCoverage';
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
  /** Children coverage data for container rows (from getChildrenCoverage) */
  coverageData?: ChildrenCoverageResult;
  /** True while coverage data is first loading */
  coverageLoading?: boolean;
  /** True when the coverage query errored — hides "Calculating…" chip permanently */
  coverageError?: boolean;
  /** Called when warning chip is clicked — dismisses all warnings for the region */
  onDismissWarnings?: (regionId: number) => void;
}

// ─── Coverage chips ───────────────────────────────────────────────────────────

/** Color thresholds matching legacy TNC:187-191 */
function coverageChipColor(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 0.9) return 'success';
  if (pct >= 0.5) return 'warning';
  return 'error';
}

/** Coverage chips for container rows — extracted to avoid nested ternary */
function CoverageChips({ coverageLoading, coveragePct, coverageFetching, geoshapePct, coverageError }: {
  coverageLoading: boolean;
  coveragePct: number | undefined;
  coverageFetching: boolean;
  geoshapePct: number | undefined;
  coverageError: boolean;
}) {
  // Never show "Calculating…" if the query errored or data loaded but this node has no entry
  if (coverageLoading && coveragePct == null && !coverageError) {
    return (
      <Chip
        size="small"
        icon={<CircularProgress size={12} />}
        label="Calculating…"
        variant="outlined"
        sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
      />
    );
  }
  if (coveragePct == null) return null;
  return (
    // flexWrap:'nowrap' keeps chips inline on the same line as the row content
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap' }}>
      <Chip
        size="small"
        icon={coverageFetching ? <CircularProgress size={12} color="inherit" /> : undefined}
        label={`cover ${(coveragePct * 100).toFixed(2)}%`}
        color={coverageChipColor(coveragePct)}
        variant="outlined"
        onClick={(e) => e.stopPropagation()}
        sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
      />
      {geoshapePct != null && (
        <Chip
          size="small"
          label={`geo ${(geoshapePct * 100).toFixed(1)}%`}
          color={coverageChipColor(geoshapePct)}
          variant="outlined"
          onClick={(e) => e.stopPropagation()}
          sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
        />
      )}
    </Box>
  );
}

// ─── WorkspaceTreeRowContent ──────────────────────────────────────────────────
// Extracted so the virtualizer map callback stays under the complexity cap.

interface RowContentProps {
  node: MatchTreeNode;
  depth: number;
  isSelected: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  coverageLoading: boolean;
  coveragePct: number | undefined;
  coverageFetching: boolean;
  geoshapePct: number | undefined;
  coverageError: boolean;
  onDismissWarnings?: (regionId: number) => void;
  onToggleExpand: (nodeId: number, e: React.MouseEvent) => void;
}

function WorkspaceTreeRowContent({
  node, depth, isSelected, hasChildren, isExpanded,
  coverageLoading, coveragePct, coverageFetching, geoshapePct, coverageError,
  onDismissWarnings, onToggleExpand,
}: RowContentProps) {
  const style = statusStyle(node.matchStatus);
  const topSug = node.suggestions[0];
  const topGeo = topSug?.geoSimilarity;
  const showGeoSimBadge = node.assignedDivisions.length === 0 && topGeo != null && topGeo >= 0.5;

  return (
    <>
      {/* Main row */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.5,
        px: 1, py: 0.25, pl: `${8 + depth * 16}px`, minHeight: 36,
      }}>
        {/* Expand/collapse caret */}
        {hasChildren ? (
          <Box
            component="span"
            onClick={(e) => onToggleExpand(node.id, e)}
            sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'text.secondary' }}
          >
            {isExpanded ? <CollapseIcon sx={{ fontSize: 16 }} /> : <ExpandIcon sx={{ fontSize: 16 }} />}
          </Box>
        ) : (
          <Box sx={{ width: 16, flexShrink: 0 }} />
        )}

        {/* Name */}
        <Typography
          variant="body2" noWrap
          sx={{ flex: 1, fontWeight: isSelected ? 600 : 400, minWidth: 0 }}
        >
          {node.name}
        </Typography>

        {/* Source-page link glyph (legacy TNR:259-271) */}
        {node.sourceUrl && (
          <Link
            href={node.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            <OpenInNewIcon sx={{ fontSize: 13 }} />
          </Link>
        )}

        {/* Geo-sim badge (top suggestion) — legacy TNR:274-298 */}
        {showGeoSimBadge && topGeo != null && (
          <Chip
            size="small" variant="outlined"
            label={`${topGeo >= 0.7 ? 'Strong geo' : 'Geo'} ${Math.round(topGeo * 100)}%`}
            color={topGeo >= 0.7 ? 'success' : 'warning'}
            sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {node.assignedDivisions.length === 0 && node.geoAvailable === false && (
          <Tooltip title="No geoshape available for comparison">
            <PublicOffIcon sx={{ fontSize: 14, color: 'text.disabled', flexShrink: 0 }} />
          </Tooltip>
        )}

        {/* Manual-fix icon */}
        {node.matchStatus != null && node.needsManualFix && (
          <Tooltip title={node.fixNote ?? 'Needs manual fix'}>
            <ManualFixIcon sx={{ fontSize: 14, color: 'error.main', flexShrink: 0 }} />
          </Tooltip>
        )}

        {/* State indicators — right-aligned */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Chip label={style.label} color={style.color} size="small"
            sx={{ height: 18, fontSize: '0.65rem' }} />

          {node.assignedDivisions.length > 0 && (
            <Tooltip title={`${node.assignedDivisions.length} assigned division(s)`}>
              <Chip label={`${node.assignedDivisions.length}d`} size="small" variant="outlined"
                sx={{ height: 18, fontSize: '0.65rem' }} />
            </Tooltip>
          )}

          {node.hierarchyWarnings.length > 0 && !node.hierarchyReviewed && (
            <WarningChip node={node} onDismissWarnings={onDismissWarnings} />
          )}

          {node.assignmentWaived && (
            <Chip label="waived" size="small" variant="outlined"
              sx={{ height: 18, fontSize: '0.65rem', color: 'text.secondary' }} />
          )}
        </Box>
      </Box>

      {/* Coverage chips — container nodes only (legacy TNC:194-254) */}
      {hasChildren && (
        <Box sx={{ pl: `${8 + depth * 16 + 20}px`, pb: 0.25 }}>
          <CoverageChips
            coverageLoading={coverageLoading}
            coveragePct={coveragePct}
            coverageFetching={coverageFetching}
            geoshapePct={geoshapePct}
            coverageError={coverageError}
          />
        </Box>
      )}
    </>
  );
}

/** Warning chip that can optionally be clicked to dismiss. */
function WarningChip({ node, onDismissWarnings }: {
  node: MatchTreeNode;
  onDismissWarnings?: (regionId: number) => void;
}) {
  const tooltipContent = (
    <Box>
      <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
        {node.hierarchyWarnings.join('; ')}
      </Typography>
      {onDismissWarnings && (
        <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
          Click to dismiss warnings
        </Typography>
      )}
    </Box>
  );
  return (
    <Tooltip title={tooltipContent}>
      <Chip
        label="⚠" size="small" color="warning" variant="outlined"
        onClick={onDismissWarnings ? (e) => { e.stopPropagation(); onDismissWarnings(node.id); } : undefined}
        clickable={!!onDismissWarnings}
        sx={{ height: 18, fontSize: '0.65rem' }}
      />
    </Tooltip>
  );
}

// ─── WorkspaceTree ───────────────────────────────────────────────────────────

export function WorkspaceTree({
  root,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  coverageData,
  coverageLoading,
  coverageError,
  onDismissWarnings,
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
          const coveragePct = hasChildren ? coverageData?.coverage[String(node.id)] : undefined;
          const geoshapePct = hasChildren ? coverageData?.geoshapeCoverage[String(node.id)] : undefined;
          const coverageFetching = false;
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
                position: 'absolute', top: virtualItem.start, left: 0, width: '100%',
                display: 'flex', flexDirection: 'column', cursor: 'pointer',
                bgcolor: rowBgColor,
                '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
              }}
            >
              <WorkspaceTreeRowContent
                node={node}
                depth={depth}
                isSelected={isSelected}
                hasChildren={hasChildren}
                isExpanded={isExpanded}
                coverageLoading={coverageLoading ?? false}
                coveragePct={coveragePct}
                coverageFetching={coverageFetching}
                geoshapePct={geoshapePct}
                coverageError={coverageError ?? false}
                onDismissWarnings={onDismissWarnings}
                onToggleExpand={toggleExpand}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * SkeletonTree — expandable indented tree for the Skeleton tab.
 *
 * Container rows (non-unit nodes): name, "N countries" badge or match-status
 *   chip, action menu (Add grouping… / Rename… / Move under… / Remove (children
 *   move up) / Promote to work unit).
 * Unit rows (work-unit leaves): STATUS_DOT + name + demote switch.
 *
 * Alignment guarantee: both row kinds share the same fixed-width ICON_SLOT_PX
 * leading slot (caret for containers, dot for units) so names at equal depth
 * align exactly. Indentation is applied once to the wrapping List via
 * `pl: depth * INDENT_PX` — no per-row padding offsets.
 *
 * All mutations are invoked via callbacks from SkeletonTab to keep this
 * component a pure rendering layer.
 */

import { useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Menu,
  MenuItem,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  MoreVert as MenuIcon,
} from '@mui/icons-material';
import { deriveUnitStatus } from './dashboardUtils';
import { STATUS_DOT } from './CountryRow';
import type { SkeletonNode } from './dashboardUtils';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import type { RenameDialogState, ReparentDialogState } from '../useImportTreeDialogs';

// ─── Layout constants ─────────────────────────────────────────────────────────

/** px of left-padding added per depth level by the wrapping List. */
const INDENT_PX = 16;

/**
 * Width (px) of the fixed leading slot shared by both row kinds:
 * - containers: the expand/collapse caret IconButton (size="small" = 30px + 0.5 mr = ~34px ≈ 36)
 * - units: the status dot Typography
 * Matching these keeps names at equal depth aligned exactly.
 */
const ICON_SLOT_PX = 36;

// ─── Match-status chip helper (mirrors WorkspaceTree's statusStyle) ───────────

type ChipColor = 'success' | 'info' | 'warning' | 'default';
interface ChipStyle { label: string; color: ChipColor }

function matchStatusChipStyle(status: string | null): ChipStyle | null {
  switch (status) {
    case 'needs_review':  return { label: 'review', color: 'warning' };
    case 'no_candidates': return { label: 'no match', color: 'default' };
    default:              return null;
  }
}

// ─── Prop types ───────────────────────────────────────────────────────────────

export interface SkeletonTreeCallbacks {
  /** Demote a work unit (set isWorkUnit = false). */
  onDemote: (regionId: number) => void;
  /** Promote a container to work unit (set isWorkUnit = true). */
  onPromote: (regionId: number) => void;
  /** Open add-child dialog for a container. */
  onAddChild: (regionId: number) => void;
  /** Open rename dialog for a node. */
  onRename: (state: RenameDialogState) => void;
  /** Open reparent dialog for a node. */
  onReparent: (state: ReparentDialogState) => void;
  /** Remove a container, reparenting its children to the container's parent. */
  onRemove: (regionId: number, regionName: string) => void;
  /** True while any mutation is in flight. */
  isPending: boolean;
}

interface SkeletonTreeProps {
  nodes: SkeletonNode[];
  units: DashboardUnit[];
  callbacks: SkeletonTreeCallbacks;
  depth?: number;
}

// ─── ContainerRow ─────────────────────────────────────────────────────────────

interface ContainerRowProps {
  node: SkeletonNode;
  expanded: boolean;
  onToggle: () => void;
  callbacks: SkeletonTreeCallbacks;
}

function ContainerRow({ node, expanded, onToggle, callbacks }: ContainerRowProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const chipStyle = matchStatusChipStyle(node.matchStatus);

  return (
    <ListItem
      dense
      disablePadding
      secondaryAction={
        <IconButton
          edge="end"
          size="small"
          aria-label={`actions for ${node.name}`}
          onClick={e => { e.stopPropagation(); setMenuAnchor(e.currentTarget); }}
          disabled={callbacks.isPending}
        >
          <MenuIcon fontSize="small" />
        </IconButton>
      }
    >
      {/* Leading slot: fixed-width caret to align with unit dot */}
      <IconButton
        size="small"
        onClick={onToggle}
        sx={{ mr: 0.5, flexShrink: 0, width: ICON_SLOT_PX, justifyContent: 'center' }}
      >
        {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      </IconButton>
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Muted medium-weight name distinguishes containers from bold unit names */}
            <Typography
              variant="body2"
              component="span"
              sx={{ fontWeight: 500, color: 'text.secondary' }}
            >
              {node.name}
            </Typography>
            {node.childUnits > 0 && (
              <Chip
                label={`${node.childUnits} ${node.childUnits === 1 ? 'country' : 'countries'}`}
                size="small"
                variant="outlined"
              />
            )}
            {node.childUnits === 0 && chipStyle !== null && (
              <Chip
                label={chipStyle.label}
                color={chipStyle.color}
                size="small"
                sx={{ height: 18, fontSize: '0.65rem' }}
              />
            )}
          </Box>
        }
      />
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          callbacks.onAddChild(node.id);
        }}>
          Add grouping…
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          callbacks.onRename({ regionId: node.id, currentName: node.name, newName: node.name });
        }}>
          Rename…
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          callbacks.onReparent({ regionId: node.id, regionName: node.name, selectedParentId: null });
        }}>
          Move under…
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          callbacks.onRemove(node.id, node.name);
        }}>
          Remove (children move up)
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          callbacks.onPromote(node.id);
        }}>
          Promote to work unit
        </MenuItem>
      </Menu>
    </ListItem>
  );
}

// ─── UnitRow ─────────────────────────────────────────────────────────────────

interface UnitRowProps {
  node: SkeletonNode;
  unit: DashboardUnit | undefined;
  callbacks: SkeletonTreeCallbacks;
}

function UnitRow({ node, unit, callbacks }: UnitRowProps) {
  const status = unit ? deriveUnitStatus(unit) : 'not_started';
  const dot = STATUS_DOT[status];

  return (
    <ListItem
      dense
      disablePadding
      secondaryAction={
        <Tooltip title="Demote (resets sign-off lifecycle)">
          <Switch
            size="small"
            checked
            disabled={callbacks.isPending}
            onChange={() => callbacks.onDemote(node.id)}
          />
        </Tooltip>
      }
    >
      {/* Leading slot: fixed-width dot to align with container caret */}
      <Tooltip title={dot.label}>
        <Typography
          sx={{
            width: ICON_SLOT_PX,
            mr: 0.5,
            color: dot.color,
            fontWeight: 700,
            flexShrink: 0,
            textAlign: 'center',
          }}
        >
          {dot.glyph}
        </Typography>
      </Tooltip>
      <ListItemText primary={node.name} />
    </ListItem>
  );
}

// ─── SkeletonTree ─────────────────────────────────────────────────────────────

export function SkeletonTree({
  nodes,
  units,
  callbacks,
  depth = 0,
}: SkeletonTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    // Expand all container nodes at depth 0 on initial render
    const ids = new Set<number>();
    if (depth === 0) {
      for (const n of nodes) {
        if (!n.isWorkUnit) ids.add(n.id);
      }
    }
    return ids;
  });

  const toggle = (id: number) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    // Indentation is applied once here — neither row kind adds its own pl.
    <List dense disablePadding sx={{ pl: `${depth * INDENT_PX}px` }}>
      {nodes.map(node => {
        if (node.isWorkUnit) {
          const unit = units.find(u => u.regionId === node.id);
          return (
            <UnitRow key={node.id} node={node} unit={unit} callbacks={callbacks} />
          );
        }
        const expanded = expandedIds.has(node.id);
        return (
          <Box key={node.id}>
            <ContainerRow
              node={node}
              expanded={expanded}
              onToggle={() => toggle(node.id)}
              callbacks={callbacks}
            />
            <Collapse in={expanded} unmountOnExit>
              <SkeletonTree
                nodes={node.children}
                units={units}
                callbacks={callbacks}
                depth={depth + 1}
              />
            </Collapse>
          </Box>
        );
      })}
    </List>
  );
}

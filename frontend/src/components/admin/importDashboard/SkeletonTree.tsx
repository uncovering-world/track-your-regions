/**
 * SkeletonTree — expandable indented tree for the Skeleton tab.
 *
 * Container rows (non-unit nodes): name, "N countries" badge, action menu
 *   (Add grouping… / Rename… / Move under… / Remove (children move up) /
 *   Promote to work unit).
 * Unit rows (work-unit leaves): STATUS_DOT + demote switch.
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
      <IconButton size="small" onClick={onToggle} sx={{ mr: 0.5, flexShrink: 0 }}>
        {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      </IconButton>
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" component="span">{node.name}</Typography>
            {node.childUnits > 0 && (
              <Chip
                label={`${node.childUnits} ${node.childUnits === 1 ? 'country' : 'countries'}`}
                size="small"
                variant="outlined"
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
  depth: number;
}

function UnitRow({ node, unit, callbacks, depth }: UnitRowProps) {
  const status = unit ? deriveUnitStatus(unit) : 'not_started';
  const dot = STATUS_DOT[status];

  return (
    <ListItem
      dense
      disablePadding
      sx={{ pl: depth > 0 ? 1 : 0 }}
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
      {/* Indent to align with container rows (icon button width + margin) */}
      <Box sx={{ width: 36, flexShrink: 0 }} />
      <Tooltip title={dot.label}>
        <Typography sx={{ color: dot.color, fontWeight: 700, mr: 1, flexShrink: 0 }}>
          {dot.glyph}
        </Typography>
      </Tooltip>
      <ListItemText primary={node.name} secondary={unit?.continent ?? undefined} />
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
    <List dense disablePadding sx={{ pl: depth > 0 ? 2 : 0 }}>
      {nodes.map(node => {
        if (node.isWorkUnit) {
          const unit = units.find(u => u.regionId === node.id);
          return (
            <UnitRow key={node.id} node={node} unit={unit} callbacks={callbacks} depth={depth} />
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

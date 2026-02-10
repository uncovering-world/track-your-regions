import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Checkbox,
  FormControlLabel,
  CircularProgress,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Tooltip,
  Collapse,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { AdministrativeDivision, Region } from '../../../../types';
import type { SubregionNode } from '../../types';
import { fetchSubdivisions, fetchDivisionUsageCounts } from '../../../../api';

export interface SubdivisionResult {
  divisionId: number;
  selectedChildIds: number[];
  customName?: string;
  createAsSubregions: boolean;
  includeChildren: boolean;
  inheritColor: boolean;
}

interface SubdivisionDialogProps {
  division: AdministrativeDivision | null;
  selectedRegion: Region | null;
  createAsSubregions: boolean;
  includeChildren: boolean;
  onIncludeChildrenChange: (value: boolean) => void;
  inheritColor: boolean;
  onInheritColorChange: (value: boolean) => void;
  worldViewId: number;
  onClose: () => void;
  onConfirm: (result: SubdivisionResult) => void;
  isPending: boolean;
}

export function SubdivisionDialog({
  division,
  selectedRegion,
  createAsSubregions,
  includeChildren,
  onIncludeChildrenChange,
  inheritColor,
  onInheritColorChange,
  worldViewId,
  onClose,
  onConfirm,
  isPending,
}: SubdivisionDialogProps) {
  // Internal state — previously lifted to parent
  const [tree, setTree] = useState<SubregionNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [customRegionName, setCustomRegionName] = useState('');
  const [usageCounts, setUsageCounts] = useState<Record<number, number>>({});

  // Fetch subdivisions when dialog opens (division changes from null to a value)
  useEffect(() => {
    if (!division) return;

    let cancelled = false;
    setLoading(true);
    setCustomRegionName(division.name);

    (async () => {
      try {
        const children = await fetchSubdivisions(division.id);
        if (cancelled) return;
        const newTree: SubregionNode[] = children.map(child => ({
          id: child.id,
          name: child.name,
          hasSubregions: child.hasChildren,
          selected: true,
          expanded: false,
          children: [],
          loaded: false,
        }));
        setTree(newTree);

        const childIds = children.map(c => c.id);
        if (childIds.length > 0) {
          const counts = await fetchDivisionUsageCounts(worldViewId, childIds);
          if (!cancelled) setUsageCounts(counts);
        }
      } catch (e) {
        console.error('Failed to fetch subdivisions:', e);
        if (!cancelled) setTree([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [division, worldViewId]);

  // Load children for a node in the subdivision tree
  const loadChildren = useCallback(async (nodeId: number, currentTree: SubregionNode[]): Promise<SubregionNode[]> => {
    const walk = async (nodes: SubregionNode[]): Promise<SubregionNode[]> => {
      const result: SubregionNode[] = [];
      for (const node of nodes) {
        if (node.id === nodeId && !node.loaded && node.hasSubregions) {
          const children = await fetchSubdivisions(node.id);
          result.push({
            ...node,
            loaded: true,
            expanded: true,
            children: children.map(child => ({
              id: child.id,
              name: child.name,
              hasSubregions: child.hasChildren,
              selected: node.selected,
              expanded: false,
              children: [],
              loaded: false,
            })),
          });
        } else if (node.children.length > 0) {
          result.push({
            ...node,
            children: await walk(node.children),
          });
        } else {
          result.push(node);
        }
      }
      return result;
    };

    return walk(currentTree);
  }, []);

  // Toggle node expansion — loads children on first expand
  const handleToggleExpanded = useCallback(async (nodeId: number) => {
    const findNode = (nodes: SubregionNode[]): SubregionNode | undefined => {
      for (const node of nodes) {
        if (node.id === nodeId) return node;
        const found = findNode(node.children);
        if (found) return found;
      }
      return undefined;
    };

    const node = findNode(tree);
    if (node && !node.expanded && node.hasSubregions && !node.loaded) {
      setTree(await loadChildren(nodeId, tree));
    } else {
      const toggleExpand = (nodes: SubregionNode[]): SubregionNode[] => {
        return nodes.map(n => {
          if (n.id === nodeId) return { ...n, expanded: !n.expanded };
          if (n.children.length > 0) return { ...n, children: toggleExpand(n.children) };
          return n;
        });
      };
      setTree(toggleExpand(tree));
    }
  }, [tree, loadChildren]);

  // Toggle selection — unchecking parent unchecks all descendants
  const handleToggleSelection = useCallback((nodeId: number, selected: boolean) => {
    const updateSelection = (nodes: SubregionNode[]): SubregionNode[] => {
      return nodes.map(node => {
        if (node.id === nodeId) {
          const updateDescendants = (n: SubregionNode): SubregionNode => ({
            ...n,
            selected,
            children: n.children.map(updateDescendants),
          });
          return updateDescendants(node);
        }
        if (node.children.length > 0) {
          return { ...node, children: updateSelection(node.children) };
        }
        return node;
      });
    };
    setTree(updateSelection(tree));
  }, [tree]);

  // Collect selected IDs from tree
  const getSelectedIds = useCallback((): number[] => {
    const collectSelected = (nodes: SubregionNode[]): number[] => {
      const ids: number[] = [];
      for (const node of nodes) {
        if (node.selected) ids.push(node.id);
        ids.push(...collectSelected(node.children));
      }
      return ids;
    };
    return collectSelected(tree);
  }, [tree]);

  // Confirm handler — build result and pass to parent
  const handleConfirm = useCallback(() => {
    if (!division) return;

    const selectedIds = getSelectedIds();
    onConfirm({
      divisionId: division.id,
      selectedChildIds: selectedIds,
      customName: customRegionName.trim() !== division.name ? customRegionName.trim() : undefined,
      createAsSubregions,
      includeChildren: includeChildren && selectedIds.length > 0,
      inheritColor,
    });
  }, [division, getSelectedIds, customRegionName, createAsSubregions, includeChildren, inheritColor, onConfirm]);

  const handleClose = () => {
    onClose();
  };

  // Tree helpers
  const countSelected = (nodes: SubregionNode[]): number => {
    let count = 0;
    for (const node of nodes) {
      if (node.selected) count++;
      count += countSelected(node.children);
    }
    return count;
  };

  const countTotal = (nodes: SubregionNode[]): number => {
    let count = nodes.length;
    for (const node of nodes) {
      count += countTotal(node.children);
    }
    return count;
  };

  const selectAll = (nodes: SubregionNode[], selected: boolean): SubregionNode[] => {
    return nodes.map(node => ({
      ...node,
      selected,
      children: selectAll(node.children, selected),
    }));
  };

  // Recursive function to render subdivision tree with checkboxes
  const renderSubdivisionNode = (node: SubregionNode, depth = 0): React.ReactNode => {
    const usageCount = usageCounts[node.id] || 0;
    const isUsed = usageCount > 0;

    return (
      <Box key={node.id}>
        <ListItem disablePadding sx={{ pl: depth * 2 }}>
          <ListItemButton
            onClick={() => handleToggleSelection(node.id, !node.selected)}
            dense
          >
            {node.hasSubregions && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleExpanded(node.id);
                }}
                sx={{ mr: 0.5, p: 0.25 }}
              >
                {node.expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            )}
            {!node.hasSubregions && <Box sx={{ width: 28 }} />}
            <Checkbox
              edge="start"
              checked={node.selected}
              tabIndex={-1}
              disableRipple
              sx={{ mr: 1 }}
            />
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{ color: isUsed ? 'text.secondary' : 'text.primary' }}
                  >
                    {node.name}
                  </Typography>
                  {isUsed && (
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: 'text.disabled', fontWeight: 'normal' }}
                    >
                      ({usageCount})
                    </Typography>
                  )}
                </Box>
              }
              secondary={node.hasSubregions ? (node.loaded ? `${node.children.length} children` : 'Has children') : undefined}
            />
          </ListItemButton>
        </ListItem>
        {node.expanded && node.children.length > 0 && (
          <Collapse in={node.expanded} timeout="auto" unmountOnExit>
            {node.children.map(child => renderSubdivisionNode(child, depth + 1))}
          </Collapse>
        )}
      </Box>
    );
  };

  const selectedCount = countSelected(tree);
  const totalCount = countTotal(tree);

  return (
    <Dialog
      open={!!division}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        Select Children to Include
        <Typography variant="body2" color="text.secondary">
          Choose which children of "{division?.name}" to include
        </Typography>
      </DialogTitle>
      <DialogContent>
        {/* Custom region name field - only show when creating as subregion */}
        {createAsSubregions && (
          <TextField
            fullWidth
            size="small"
            label="Region Name"
            value={customRegionName}
            onChange={(e) => setCustomRegionName(e.target.value)}
            placeholder={division?.name}
            helperText="Enter a custom name or keep the original division name"
            sx={{ mb: 2, mt: 1 }}
          />
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : tree.length === 0 ? (
          <Typography color="text.secondary">No subdivisions found.</Typography>
        ) : (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {selectedCount} of {totalCount} selected
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title="Copy list to clipboard">
                  <IconButton
                    size="small"
                    onClick={() => {
                      const collectNames = (nodes: SubregionNode[], indent = ''): string[] => {
                        const names: string[] = [];
                        for (const node of nodes) {
                          names.push(`${indent}${node.name}${node.selected ? ' ✓' : ''}`);
                          if (node.children.length > 0) {
                            names.push(...collectNames(node.children, indent + '  '));
                          }
                        }
                        return names;
                      };
                      const text = collectNames(tree).join('\n');
                      navigator.clipboard.writeText(text);
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Button size="small" onClick={() => setTree(selectAll(tree, true))}>
                  Select All
                </Button>
                <Button size="small" onClick={() => setTree(selectAll(tree, false))}>
                  Deselect All
                </Button>
              </Box>
            </Box>
            <Paper variant="outlined" sx={{ maxHeight: 350, overflow: 'auto' }}>
              <List dense>
                {tree.map(node => renderSubdivisionNode(node))}
              </List>
            </Paper>
            {createAsSubregions && (
              <Box sx={{ mt: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={includeChildren}
                      onChange={(e) => onIncludeChildrenChange(e.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="body2">Create selected children as subregions</Typography>
                  }
                />
                {includeChildren && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={inheritColor}
                        onChange={(e) => onInheritColorChange(e.target.checked)}
                      />
                    }
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">Inherit parent color</Typography>
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            backgroundColor: selectedRegion?.color || '#3388ff',
                            borderRadius: 0.5,
                            border: '1px solid rgba(0,0,0,0.2)',
                          }}
                        />
                      </Box>
                    }
                    sx={{ ml: 2, display: 'block' }}
                  />
                )}
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={isPending || getSelectedIds().length === 0}
        >
          {isPending
            ? 'Adding...'
            : createAsSubregions && includeChildren
              ? `Add ${getSelectedIds().length} as Subregions`
              : `Add ${getSelectedIds().length} Divisions`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Checkbox,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Tooltip,
  Collapse,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { Region } from '../../../../types';

interface PropagateColorDialogProps {
  region: Region | null;
  regions: Region[];
  onClose: () => void;
  onConfirm: (regionIds: number[]) => void;
  isPending: boolean;
}

export function PropagateColorDialog({
  region,
  regions,
  onClose,
  onConfirm,
  isPending,
}: PropagateColorDialogProps) {
  // Internal state — previously lifted to parent
  const [selection, setSelection] = useState<Map<number, boolean>>(new Map());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Get all descendant region IDs recursively
  const getDescendantIds = useCallback((regionId: number): number[] => {
    const children = regions.filter(r => r.parentRegionId === regionId);
    const childIds = children.map(c => c.id);
    const descendantIds = children.flatMap(c => getDescendantIds(c.id));
    return [...childIds, ...descendantIds];
  }, [regions]);

  // Initialize selection when the dialog opens (region changes from null to a value)
  useEffect(() => {
    if (region) {
      const descendantIds = getDescendantIds(region.id);
      const newSelection = new Map<number, boolean>();
      descendantIds.forEach(id => newSelection.set(id, true));
      setSelection(newSelection);
      setExpanded(new Set([region.id]));
    }
  }, [region, getDescendantIds]);

  // Toggle selection — unchecking a node unchecks all its descendants
  const handleToggleSelection = useCallback((regionId: number, checked: boolean) => {
    setSelection(prev => {
      const next = new Map(prev);
      next.set(regionId, checked);

      if (!checked) {
        const descendantIds = getDescendantIds(regionId);
        descendantIds.forEach(id => next.set(id, false));
      }

      return next;
    });
  }, [getDescendantIds]);

  // Confirm handler — collect selected IDs and pass to parent
  const handleConfirm = useCallback(() => {
    const selectedIds = Array.from(selection.entries())
      .filter(([_, selected]) => selected)
      .map(([id]) => id);

    if (selectedIds.length === 0) {
      onClose();
      return;
    }

    onConfirm(selectedIds);
  }, [selection, onClose, onConfirm]);

  // Recursive function to render region tree with checkboxes
  const renderPropagateRegionItem = (regionItem: Region, depth = 0): React.ReactNode => {
    const children = regions.filter(r => r.parentRegionId === regionItem.id);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(regionItem.id);
    const isSelected = selection.get(regionItem.id) ?? false;

    return (
      <Box key={regionItem.id}>
        <ListItem disablePadding sx={{ pl: depth * 2 }}>
          <ListItemButton
            onClick={() => handleToggleSelection(regionItem.id, !isSelected)}
            dense
          >
            {hasChildren && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(prev => {
                    const next = new Set(prev);
                    if (next.has(regionItem.id)) {
                      next.delete(regionItem.id);
                    } else {
                      next.add(regionItem.id);
                    }
                    return next;
                  });
                }}
                sx={{ mr: 0.5, p: 0.25 }}
              >
                {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            )}
            {!hasChildren && <Box sx={{ width: 28 }} />}
            <Checkbox
              edge="start"
              checked={isSelected}
              tabIndex={-1}
              disableRipple
              sx={{ mr: 1 }}
            />
            <ListItemIcon sx={{ minWidth: 28 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  backgroundColor: regionItem.color || '#3388ff',
                  borderRadius: 0.5,
                  border: '1px solid rgba(0,0,0,0.2)',
                }}
              />
            </ListItemIcon>
            <ListItemText
              primary={regionItem.name}
              secondary={hasChildren ? `${children.length} children` : undefined}
            />
          </ListItemButton>
        </ListItem>
        {hasChildren && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            {children.map(child => renderPropagateRegionItem(child, depth + 1))}
          </Collapse>
        )}
      </Box>
    );
  };

  // Helper to collect all region names for copying
  const collectRegionNames = (parentId: number | null, indent = ''): string[] => {
    const names: string[] = [];
    const children = regions.filter(r => r.parentRegionId === parentId);
    for (const child of children) {
      const isSelected = selection.get(child.id) ?? false;
      names.push(`${indent}${child.name}${isSelected ? ' ✓' : ''}`);
      names.push(...collectRegionNames(child.id, indent + '  '));
    }
    return names;
  };

  const directChildren = region ? regions.filter(r => r.parentRegionId === region.id) : [];
  const selectedCount = Array.from(selection.values()).filter(Boolean).length;

  return (
    <Dialog
      open={!!region}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        Propagate Color to Children
        <Typography variant="body2" color="text.secondary">
          Apply "{region?.name}" color to selected children
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box
            sx={{
              width: 24,
              height: 24,
              backgroundColor: region?.color || '#3388ff',
              borderRadius: 1,
              border: '1px solid rgba(0,0,0,0.2)',
            }}
          />
          <Typography variant="body2">
            {region?.color || '#3388ff'}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        {region && (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {selectedCount} of {selection.size} selected
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title="Copy list to clipboard">
                  <IconButton
                    size="small"
                    onClick={() => {
                      const text = collectRegionNames(region.id).join('\n');
                      navigator.clipboard.writeText(text);
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Button
                  size="small"
                  onClick={() => {
                    const next = new Map(selection);
                    next.forEach((_, key) => next.set(key, true));
                    setSelection(next);
                  }}
                >
                  Select All
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const next = new Map(selection);
                    next.forEach((_, key) => next.set(key, false));
                    setSelection(next);
                  }}
                >
                  Deselect All
                </Button>
              </Box>
            </Box>
            <Paper variant="outlined" sx={{ maxHeight: 350, overflow: 'auto' }}>
              <List dense>
                {directChildren.map(child => renderPropagateRegionItem(child))}
              </List>
            </Paper>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={isPending || selectedCount === 0}
        >
          {isPending
            ? 'Applying...'
            : `Apply to ${selectedCount} Regions`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

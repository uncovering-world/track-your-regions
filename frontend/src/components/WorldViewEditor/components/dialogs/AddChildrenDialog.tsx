import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  CircularProgress,
  Alert,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import type { RegionMember, Region } from '../../../../types';
import { fetchSubdivisions, fetchDivisionUsageCounts } from '../../../../api';

export interface ChildToAdd {
  id: number;
  name: string;
  selected: boolean;
}

export interface AddChildrenResult {
  divisionId: number;
  childIds?: number[];
  asSubregions: boolean;
  inheritColor: boolean;
}

interface AddChildrenDialogProps {
  member: RegionMember | null;
  selectedRegion: Region | null;
  inheritColor: boolean;
  onInheritColorChange: (value: boolean) => void;
  worldViewId: number;
  onClose: () => void;
  onConfirm: (result: AddChildrenResult) => void;
  isPending: boolean;
}

export function AddChildrenDialog({
  member,
  selectedRegion,
  inheritColor,
  onInheritColorChange,
  worldViewId,
  onClose,
  onConfirm,
  isPending,
}: AddChildrenDialogProps) {
  // Internal state — previously lifted to parent
  const [childrenToAdd, setChildrenToAdd] = useState<ChildToAdd[]>([]);
  const [loading, setLoading] = useState(false);
  const [asSubregions, setAsSubregions] = useState(true);
  const [usageCounts, setUsageCounts] = useState<Record<number, number>>({});

  // Fetch subdivisions when dialog opens (member changes from null to a value)
  useEffect(() => {
    if (!member) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const children = await fetchSubdivisions(member.id);
        if (cancelled) return;
        setChildrenToAdd(children.map(c => ({ id: c.id, name: c.name, selected: true })));

        const childIds = children.map(c => c.id);
        if (childIds.length > 0) {
          const counts = await fetchDivisionUsageCounts(worldViewId, childIds);
          if (!cancelled) setUsageCounts(counts);
        }
      } catch (e) {
        console.error('Failed to fetch children:', e);
        if (!cancelled) setChildrenToAdd([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [member, worldViewId]);

  // Confirm handler — build result and pass to parent
  const handleConfirm = useCallback(() => {
    if (!member) return;

    const selectedChildIds = childrenToAdd.filter(c => c.selected).map(c => c.id);
    if (selectedChildIds.length === 0) {
      onClose();
      return;
    }

    onConfirm({
      divisionId: member.id,
      childIds: selectedChildIds.length === childrenToAdd.length ? undefined : selectedChildIds,
      asSubregions,
      inheritColor: asSubregions && inheritColor,
    });
  }, [member, childrenToAdd, asSubregions, inheritColor, onClose, onConfirm]);

  const selectedCount = childrenToAdd.filter(c => c.selected).length;

  return (
    <Dialog
      open={!!member}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {asSubregions ? 'Add Children as Subregions' : 'Split into Divisions'}
        <Typography variant="body2" color="text.secondary">
          {asSubregions
            ? `Select which children of "${member?.name}" to add as subregions`
            : `Replace "${member?.name}" with selected divisions`}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : childrenToAdd.length === 0 ? (
          <Alert severity="info">No children found for this division.</Alert>
        ) : (
          <>
            {/* Mode selection */}
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={asSubregions}
                    onChange={(e) => setAsSubregions(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2">
                    Create as subregions (with hierarchy structure)
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                {asSubregions
                  ? 'Each child will become a subregion that can have its own members'
                  : 'Children will be added as simple division members (flat structure)'}
              </Typography>
            </Box>

            <Divider sx={{ mb: 2 }} />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {selectedCount} of {childrenToAdd.length} selected
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title="Copy full paths to clipboard">
                  <IconButton
                    size="small"
                    onClick={() => {
                      const basePath = [
                        selectedRegion?.name,
                        member?.name,
                      ].filter(Boolean).join(' > ');
                      const text = childrenToAdd
                        .map(c => `${basePath} > ${c.name}${c.selected ? ' ✓' : ''}`)
                        .join('\n');
                      navigator.clipboard.writeText(text);
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Copy created subregion paths to clipboard (selected only)">
                  <IconButton
                    size="small"
                    onClick={() => {
                      const basePath = selectedRegion?.name || '';
                      const text = childrenToAdd
                        .filter(c => c.selected)
                        .map(c => `${basePath} > ${c.name}`)
                        .join('\n');
                      navigator.clipboard.writeText(text);
                    }}
                  >
                    <FolderCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Button
                  size="small"
                  onClick={() => setChildrenToAdd(prev => prev.map(c => ({ ...c, selected: true })))}
                >
                  Select All
                </Button>
                <Button
                  size="small"
                  onClick={() => setChildrenToAdd(prev => prev.map(c => ({ ...c, selected: false })))}
                >
                  Deselect All
                </Button>
              </Box>
            </Box>
            <Paper variant="outlined" sx={{ maxHeight: 250, overflow: 'auto' }}>
              <List dense>
                {childrenToAdd.map((child) => {
                  const usageCount = usageCounts[child.id] || 0;
                  const isUsed = usageCount > 0;

                  return (
                    <ListItem key={child.id} disablePadding>
                      <ListItemButton
                        onClick={() => setChildrenToAdd(prev =>
                          prev.map(c => c.id === child.id ? { ...c, selected: !c.selected } : c)
                        )}
                      >
                        <Checkbox
                          edge="start"
                          checked={child.selected}
                          tabIndex={-1}
                          disableRipple
                        />
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography
                                component="span"
                                variant="body2"
                                sx={{ color: isUsed ? 'text.secondary' : 'text.primary' }}
                              >
                                {child.name}
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
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
            {asSubregions && (
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
                sx={{ mt: 1 }}
              />
            )}
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
            ? 'Processing...'
            : asSubregions
              ? `Add ${selectedCount} Subregions`
              : `Split into ${selectedCount} Divisions`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

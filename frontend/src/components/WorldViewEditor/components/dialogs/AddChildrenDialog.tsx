import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Alert,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { LoadingSpinner } from '../../../shared/LoadingSpinner';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import type { RegionMember, Region } from '../../../../types';
import { fetchSubdivisions, fetchDivisionUsageCounts, fetchRegionMembers } from '../../../../api';

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
  assignments?: Array<{ gadmChildId: number; existingRegionId: number }>;
}

interface AddChildrenDialogProps {
  member: RegionMember | null;
  selectedRegion: Region | null;
  existingChildren: Region[];
  inheritColor: boolean;
  onInheritColorChange: (value: boolean) => void;
  worldViewId: number;
  onClose: () => void;
  onConfirm: (result: AddChildrenResult) => void;
  isPending: boolean;
}

const NEW_REGION_VALUE = '__new__';

export function AddChildrenDialog({
  member,
  selectedRegion,
  existingChildren,
  inheritColor,
  onInheritColorChange,
  worldViewId,
  onClose,
  onConfirm,
  isPending,
}: AddChildrenDialogProps) {
  const [childrenToAdd, setChildrenToAdd] = useState<ChildToAdd[]>([]);
  const [loading, setLoading] = useState(false);
  const [asSubregions, setAsSubregions] = useState(true);
  const [usageCounts, setUsageCounts] = useState<Record<number, number>>({});
  // Maps GADM child ID → existing region ID (or NEW_REGION_VALUE for new region)
  const [assignments, setAssignments] = useState<Record<number, string>>({});

  const hasExistingChildren = existingChildren.length > 0;

  // Fetch subdivisions + existing region members when dialog opens
  useEffect(() => {
    if (!member) return;

    let cancelled = false;
    setLoading(true);
    setAssignments({});

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

        // If there are existing child regions, fetch their members to find pre-existing assignments
        if (existingChildren.length > 0) {
          const childIdSet = new Set(childIds);
          const memberResults = await Promise.all(
            existingChildren.map(async (region) => {
              const members = await fetchRegionMembers(region.id);
              return { regionId: region.id, members };
            })
          );
          if (cancelled) return;

          // Build pre-assignment map: divisionId → regionId
          const preAssignments: Record<number, string> = {};
          for (const { regionId, members } of memberResults) {
            for (const m of members) {
              if (!m.isSubregion && childIdSet.has(m.id)) {
                preAssignments[m.id] = String(regionId);
              }
            }
          }
          setAssignments(preAssignments);
        }
      } catch (e) {
        console.error('Failed to fetch children:', e);
        if (!cancelled) setChildrenToAdd([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [member, worldViewId, existingChildren]);

  // Track which existing regions are already used in assignments
  const usedRegionIds = useMemo(() => {
    const used = new Set<string>();
    for (const regionId of Object.values(assignments)) {
      if (regionId !== NEW_REGION_VALUE) used.add(regionId);
    }
    return used;
  }, [assignments]);

  // Count unassigned existing regions
  const unassignedExistingRegions = useMemo(() => {
    return existingChildren.filter(r => !usedRegionIds.has(String(r.id)));
  }, [existingChildren, usedRegionIds]);

  const handleAssignmentChange = useCallback((childId: number, value: string) => {
    setAssignments(prev => ({ ...prev, [childId]: value }));
  }, []);

  // Confirm handler — build result and pass to parent
  const handleConfirm = useCallback(() => {
    if (!member) return;

    const selectedChildIds = childrenToAdd.filter(c => c.selected).map(c => c.id);
    if (selectedChildIds.length === 0) {
      onClose();
      return;
    }

    // Build explicit assignments array (only for selected children assigned to existing regions)
    const explicitAssignments: Array<{ gadmChildId: number; existingRegionId: number }> = [];
    if (hasExistingChildren && asSubregions) {
      for (const childId of selectedChildIds) {
        const regionId = assignments[childId];
        if (regionId && regionId !== NEW_REGION_VALUE) {
          explicitAssignments.push({ gadmChildId: childId, existingRegionId: parseInt(regionId) });
        }
      }
    }

    onConfirm({
      divisionId: member.id,
      childIds: selectedChildIds.length === childrenToAdd.length ? undefined : selectedChildIds,
      asSubregions,
      inheritColor: asSubregions && inheritColor,
      assignments: explicitAssignments.length > 0 ? explicitAssignments : undefined,
    });
  }, [member, childrenToAdd, asSubregions, inheritColor, assignments, hasExistingChildren, onClose, onConfirm]);

  const selectedCount = childrenToAdd.filter(c => c.selected).length;
  const showAssignments = hasExistingChildren && asSubregions;

  return (
    <Dialog
      open={!!member}
      onClose={onClose}
      maxWidth={showAssignments ? 'md' : 'sm'}
      fullWidth
    >
      <DialogTitle>
        {asSubregions ? 'Add Children as Subregions' : 'Split into Divisions'}
        <Typography variant="body2" color="text.secondary">
          {asSubregions
            ? showAssignments
              ? `Assign children of "${member?.name}" to existing regions or create new ones`
              : `Select which children of "${member?.name}" to add as subregions`
            : `Replace "${member?.name}" with selected divisions`}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <LoadingSpinner />
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
            <Paper variant="outlined" sx={{ maxHeight: 350, overflow: 'auto' }}>
              <List dense>
                {childrenToAdd.map((child) => {
                  const usageCount = usageCounts[child.id] || 0;
                  const isUsed = usageCount > 0;
                  const assignedTo = assignments[child.id] || NEW_REGION_VALUE;

                  return (
                    <ListItem key={child.id} disablePadding>
                      <ListItemButton
                        onClick={() => setChildrenToAdd(prev =>
                          prev.map(c => c.id === child.id ? { ...c, selected: !c.selected } : c)
                        )}
                        sx={{ gap: 0.5 }}
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
                        {/* Region assignment dropdown */}
                        {showAssignments && child.selected && (
                          <Select
                            size="small"
                            value={assignedTo}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleAssignmentChange(child.id, e.target.value);
                            }}
                            sx={{ minWidth: 180, fontSize: '0.8rem', height: 30 }}
                          >
                            <MenuItem value={NEW_REGION_VALUE}>
                              <Typography variant="body2" color="text.secondary" fontStyle="italic">
                                new region
                              </Typography>
                            </MenuItem>
                            {existingChildren.map((region) => {
                              const isUsedElsewhere = usedRegionIds.has(String(region.id)) && assignedTo !== String(region.id);
                              return (
                                <MenuItem
                                  key={region.id}
                                  value={String(region.id)}
                                  disabled={isUsedElsewhere}
                                >
                                  {region.name}
                                </MenuItem>
                              );
                            })}
                          </Select>
                        )}
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>

            {/* Unassigned existing regions info */}
            {showAssignments && unassignedExistingRegions.length > 0 && (
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="caption">
                  {unassignedExistingRegions.length} existing region{unassignedExistingRegions.length > 1 ? 's' : ''} without assignment:{' '}
                  {unassignedExistingRegions.map(r => r.name).join(', ')}
                </Typography>
              </Alert>
            )}

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

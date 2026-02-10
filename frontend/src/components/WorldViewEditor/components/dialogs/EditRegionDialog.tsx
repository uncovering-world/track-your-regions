import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Chip,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import type { Region } from '../../../../types';

interface EditRegionDialogProps {
  region: Region | null;
  regions: Region[];
  onClose: () => void;
  onSave: (data: {
    name: string;
    color?: string;
    parentRegionId: number | null;
    isArchipelago?: boolean;
  }) => void;
}

export function EditRegionDialog({
  region,
  regions,
  onClose,
  onSave,
}: EditRegionDialogProps) {
  // Local state for editing
  const [editedRegion, setEditedRegion] = useState<Region | null>(null);
  const [parentRegionSearch, setParentRegionSearch] = useState('');
  const [showParentSearchResults, setShowParentSearchResults] = useState(false);
  const [inheritParentColor, setInheritParentColor] = useState(false);

  // Initialize local state when region prop changes
  if (region && (!editedRegion || editedRegion.id !== region.id)) {
    setEditedRegion({ ...region });
    setParentRegionSearch('');
    setShowParentSearchResults(false);
    setInheritParentColor(false);
  }

  // Clear local state when dialog closes
  if (!region && editedRegion) {
    setEditedRegion(null);
  }

  const handleClose = () => {
    setEditedRegion(null);
    setParentRegionSearch('');
    setShowParentSearchResults(false);
    onClose();
  };

  const handleSave = () => {
    if (editedRegion) {
      onSave({
        name: editedRegion.name,
        color: editedRegion.color || undefined,
        parentRegionId: editedRegion.parentRegionId,
        isArchipelago: editedRegion.isArchipelago,
      });
    }
  };

  return (
    <Dialog open={!!region} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Region</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label="Name"
          value={editedRegion?.name || ''}
          onChange={(e) =>
            setEditedRegion((prev) => (prev ? { ...prev, name: e.target.value } : null))
          }
          sx={{ mt: 1, mb: 2 }}
        />

        {/* Parent region selector with search */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Parent Region
          </Typography>
          {editedRegion?.parentRegionId ? (
            <Chip
              label={regions.find(r => r.id === editedRegion.parentRegionId)?.name || 'Unknown'}
              onDelete={() => setEditedRegion(prev => prev ? { ...prev, parentRegionId: null } : null)}
              sx={{ mb: 1 }}
            />
          ) : (
            <Chip label="None (Root Level)" variant="outlined" sx={{ mb: 1 }} />
          )}
          <TextField
            fullWidth
            size="small"
            placeholder="Search for a parent region..."
            value={parentRegionSearch}
            onChange={(e) => {
              setParentRegionSearch(e.target.value);
              setShowParentSearchResults(true);
            }}
            onFocus={() => setShowParentSearchResults(true)}
          />
          {showParentSearchResults && parentRegionSearch && (
            <Paper variant="outlined" sx={{ mt: 1, maxHeight: 150, overflow: 'auto' }}>
              <List dense>
                <ListItem disablePadding>
                  <ListItemButton
                    onClick={() => {
                      setEditedRegion(prev => prev ? { ...prev, parentRegionId: null } : null);
                      setParentRegionSearch('');
                      setShowParentSearchResults(false);
                    }}
                  >
                    <ListItemText primary="None (Root Level)" />
                  </ListItemButton>
                </ListItem>
                {regions
                  .filter(r =>
                    r.id !== editedRegion?.id && // Can't be its own parent
                    r.name.toLowerCase().includes(parentRegionSearch.toLowerCase())
                  )
                  .slice(0, 10)
                  .map(r => (
                    <ListItem key={r.id} disablePadding>
                      <ListItemButton
                        onClick={() => {
                          const newParent = r;
                          setEditedRegion(prev => prev ? {
                            ...prev,
                            parentRegionId: newParent.id,
                            // Inherit color from new parent by default
                            color: inheritParentColor ? newParent.color : prev.color,
                          } : null);
                          setParentRegionSearch('');
                          setShowParentSearchResults(false);
                          setInheritParentColor(true); // Reset for next selection
                        }}
                      >
                        <ListItemText
                          primary={r.name}
                          secondary={r.parentRegionId ? `in ${regions.find(p => p.id === r.parentRegionId)?.name}` : 'Root level'}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))
                }
                {regions.filter(r =>
                  r.id !== editedRegion?.id &&
                  r.name.toLowerCase().includes(parentRegionSearch.toLowerCase())
                ).length === 0 && (
                  <ListItem>
                    <ListItemText primary="No matching regions" secondary="Try a different search" />
                  </ListItem>
                )}
              </List>
            </Paper>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography>Color:</Typography>
          <input
            type="color"
            value={editedRegion?.color || '#3388ff'}
            onChange={(e) =>
              setEditedRegion((prev) => (prev ? { ...prev, color: e.target.value } : null))
            }
            style={{ width: 50, height: 30 }}
          />
          {editedRegion?.parentRegionId && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={inheritParentColor}
                  onChange={(e) => {
                    setInheritParentColor(e.target.checked);
                    if (e.target.checked) {
                      const parent = regions.find(r => r.id === editedRegion?.parentRegionId);
                      if (parent?.color) {
                        setEditedRegion(prev => prev ? { ...prev, color: parent.color } : null);
                      }
                    }
                  }}
                />
              }
              label={<Typography variant="body2">Use parent's color</Typography>}
            />
          )}
        </Box>

        {/* Archipelago toggle */}
        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={editedRegion?.isArchipelago || false}
                onChange={(e) =>
                  setEditedRegion((prev) => (prev ? { ...prev, isArchipelago: e.target.checked } : null))
                }
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2">Archipelago (island group)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Uses extent box for map display
                </Typography>
              </Box>
            }
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

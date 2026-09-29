import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
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
import type { UpdateRegionBody } from '../../../../api/regions';
import { useEditForm } from '../../../../hooks/useEditForm';

/** The fields this dialog edits, named by the request body's keys (ADR-0076). */
type RegionFields = Required<Pick<UpdateRegionBody, 'name' | 'parentRegionId' | 'color' | 'usesHull'>>;

const REQUIRED = ['name'] as const;

interface EditRegionDialogProps {
  region: Region | null;
  regions: Region[];
  onClose: () => void;
  /** Sends the changed fields; a rejection is shown in the dialog, which stays open. */
  onSave: (changes: UpdateRegionBody) => Promise<unknown>;
}

export function EditRegionDialog({
  region,
  regions,
  onClose,
  onSave,
}: EditRegionDialogProps) {
  const form = useEditForm<RegionFields>({
    initial: {
      name: region?.name ?? '',
      parentRegionId: region?.parentRegionId ?? null,
      color: region?.color ?? null,
      usesHull: region?.usesHull ?? false,
    },
    resetKey: region?.id ?? null,
    required: REQUIRED,
  });
  const { parentRegionId, color, usesHull } = form.values;
  const [pending, setPending] = useState(false);
  const [parentRegionSearch, setParentRegionSearch] = useState('');
  const [showParentSearchResults, setShowParentSearchResults] = useState(false);
  const [inheritParentColor, setInheritParentColor] = useState(false);

  const handleClose = () => {
    setParentRegionSearch('');
    setShowParentSearchResults(false);
    setInheritParentColor(false);
    onClose();
  };

  const handleSave = async () => {
    setPending(true);
    const saved = await form.submit(onSave);
    setPending(false);
    if (saved) handleClose();
  };

  return (
    <Dialog open={!!region} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Region</DialogTitle>
      <DialogContent>
        {form.formError && <Alert severity="error" sx={{ mb: 1 }}>{form.formError}</Alert>}
        <TextField
          fullWidth
          label="Name"
          {...form.field('name')}
          sx={{ mt: 1, mb: 2 }}
        />

        {/* Parent region selector with search */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Parent Region
          </Typography>
          {parentRegionId ? (
            <Chip
              label={regions.find(r => r.id === parentRegionId)?.name || 'Unknown'}
              onDelete={() => form.set('parentRegionId', null)}
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
                      form.set('parentRegionId', null);
                      setParentRegionSearch('');
                      setShowParentSearchResults(false);
                    }}
                  >
                    <ListItemText primary="None (Root Level)" />
                  </ListItemButton>
                </ListItem>
                {regions
                  .filter(r =>
                    r.id !== region?.id && // Can't be its own parent
                    r.name.toLowerCase().includes(parentRegionSearch.toLowerCase())
                  )
                  .slice(0, 10)
                  .map(r => (
                    <ListItem key={r.id} disablePadding>
                      <ListItemButton
                        onClick={() => {
                          form.set('parentRegionId', r.id);
                          // Inherit color from new parent by default
                          if (inheritParentColor && r.color) form.set('color', r.color);
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
                  r.id !== region?.id &&
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
            value={color || '#3388ff'}
            onChange={(e) => form.set('color', e.target.value)}
            style={{ width: 50, height: 30 }}
          />
          {parentRegionId && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={inheritParentColor}
                  onChange={(e) => {
                    setInheritParentColor(e.target.checked);
                    if (e.target.checked) {
                      const parent = regions.find(r => r.id === parentRegionId);
                      if (parent?.color) form.set('color', parent.color);
                    }
                  }}
                />
              }
              label={<Typography variant="body2">Use parent's color</Typography>}
            />
          )}
        </Box>

        {/* Hull toggle */}
        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={usesHull}
                onChange={(e) => form.set('usesHull', e.target.checked)}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2">Uses Hull</Typography>
                <Typography variant="caption" color="text.secondary">
                  Uses hull envelope for map display
                </Typography>
              </Box>
            }
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!form.dirty || form.missing || pending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

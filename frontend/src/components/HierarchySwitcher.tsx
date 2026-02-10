import { useState, useEffect } from 'react';
import {
  Box,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Menu,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsIcon from '@mui/icons-material/Settings';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '../hooks/useNavigation';
import { useAuth } from '../hooks/useAuth';
import { WorldViewEditor } from './WorldViewEditor';
import { createWorldView, updateWorldView, deleteWorldView } from '../api';

export function HierarchySwitcher() {
  const { worldViews, selectedWorldView, setSelectedWorldView, invalidateTileCache } = useNavigation();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newWorldViewName, setNewWorldViewName] = useState('');
  const [newWorldViewDescription, setNewWorldViewDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [adminMenuEl, setAdminMenuEl] = useState<HTMLElement | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => createWorldView(data),
    onSuccess: (newWorldView) => {
      queryClient.invalidateQueries({ queryKey: ['worldViews'] });
      setCreateDialogOpen(false);
      setNewWorldViewName('');
      setNewWorldViewDescription('');
      // Auto-select the new world view
      setSelectedWorldView(newWorldView);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      updateWorldView(selectedWorldView!.id, data),
    onSuccess: (updatedWorldView) => {
      queryClient.invalidateQueries({ queryKey: ['worldViews'] });
      setSettingsDialogOpen(false);
      setSelectedWorldView(updatedWorldView);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteWorldView(selectedWorldView!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worldViews'] });
      setDeleteDialogOpen(false);
      // Switch to default world view
      const defaultWorldView = worldViews.find(w => w.isDefault);
      if (defaultWorldView) {
        setSelectedWorldView(defaultWorldView);
      }
    },
  });

  const handleCreateWorldView = () => {
    if (newWorldViewName.trim()) {
      createMutation.mutate({
        name: newWorldViewName.trim(),
        description: newWorldViewDescription.trim() || undefined,
      });
    }
  };

  const handleOpenSettings = () => {
    if (selectedWorldView) {
      setEditName(selectedWorldView.name);
      setEditDescription(selectedWorldView.description || '');
      setSettingsDialogOpen(true);
    }
  };

  const handleUpdateWorldView = () => {
    if (editName.trim()) {
      updateMutation.mutate({
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      });
    }
  };

  const handleDeleteWorldView = () => {
    deleteMutation.mutate();
  };

  // Check if selected world view is custom (not GADM)
  const isCustomWorldView = selectedWorldView && !selectedWorldView.isDefault;

  // Filter world views - non-admin users can't see GADM (default) world view
  const visibleWorldViews = isAdmin
    ? worldViews
    : worldViews.filter(w => !w.isDefault);

  // Auto-select a valid world view when auth state changes and current selection is invalid
  useEffect(() => {
    if (visibleWorldViews.length > 0 && selectedWorldView) {
      const isCurrentValid = visibleWorldViews.some(w => w.id === selectedWorldView.id);
      if (!isCurrentValid) {
        // Current selection is not visible (e.g., GADM selected but user is not admin)
        // Select the first available world view
        setSelectedWorldView(visibleWorldViews[0]);
      }
    }
  }, [isAdmin, visibleWorldViews, selectedWorldView, setSelectedWorldView]);

  // Don't render until we have world views loaded and a valid selection
  // Also ensure the selected value exists in the worldViews array
  const selectedValueExists = selectedWorldView && visibleWorldViews.some(w => w.id === selectedWorldView.id);
  if (visibleWorldViews.length === 0 || !selectedWorldView || !selectedValueExists) {
    return null;
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', pr: 4.5 }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel id="world-view-select-label">World View</InputLabel>
          <Select
            labelId="world-view-select-label"
            id="world-view-select"
            value={selectedWorldView.id}
            label="World View"
            onChange={(e) => {
              const worldView = visibleWorldViews.find(w => w.id === Number(e.target.value));
              if (worldView) {
                setSelectedWorldView(worldView);
              }
            }}
          >
            {visibleWorldViews.map((worldView) => (
              <MenuItem key={worldView.id} value={worldView.id}>
                {worldView.name}
                {worldView.isDefault && ' (Default)'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Admin-only: actions menu */}
        {isAdmin && (
          <>
            <IconButton onClick={(e) => setAdminMenuEl(e.currentTarget)} size="small">
              <MoreVertIcon />
            </IconButton>
            <Menu
              anchorEl={adminMenuEl}
              open={Boolean(adminMenuEl)}
              onClose={() => setAdminMenuEl(null)}
            >
              <MenuItem onClick={() => { setAdminMenuEl(null); setCreateDialogOpen(true); }}>
                <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Create world view</ListItemText>
              </MenuItem>
              {isCustomWorldView && (
                <MenuItem onClick={() => { setAdminMenuEl(null); setEditorOpen(true); }}>
                  <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>Edit regions</ListItemText>
                </MenuItem>
              )}
              {isCustomWorldView && (
                <MenuItem onClick={() => { setAdminMenuEl(null); handleOpenSettings(); }}>
                  <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>Settings</ListItemText>
                </MenuItem>
              )}
            </Menu>
          </>
        )}
      </Box>

      {/* World View Editor Dialog */}
      {selectedWorldView && isCustomWorldView && (
        <WorldViewEditor
          open={editorOpen}
          onClose={() => {
            setEditorOpen(false);
            invalidateTileCache();
          }}
          worldView={selectedWorldView}
        />
      )}

      {/* Create New World View Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>Create New World View</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={newWorldViewName}
            onChange={(e) => setNewWorldViewName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            placeholder="e.g., Cultural Regions"
          />
          <TextField
            fullWidth
            label="Description (optional)"
            value={newWorldViewDescription}
            onChange={(e) => setNewWorldViewDescription(e.target.value)}
            multiline
            rows={2}
            placeholder="e.g., Regions grouped by cultural similarities"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateWorldView}
            disabled={!newWorldViewName.trim() || createMutation.isPending}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* World View Settings Dialog */}
      <Dialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>World View Settings</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            fullWidth
            label="Description (optional)"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            multiline
            rows={3}
          />

          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" color="error" gutterBottom>
              Danger Zone
            </Typography>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => {
                setSettingsDialogOpen(false);
                setDeleteDialogOpen(true);
              }}
            >
              Delete World View
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUpdateWorldView}
            disabled={!editName.trim() || updateMutation.isPending}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete World View?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{selectedWorldView?.name}"?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This will permanently delete this world view and all its custom regions. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteWorldView}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

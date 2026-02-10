import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Alert,
} from '@mui/material';
import type { Region } from '../../../../types';

interface DeleteConfirmDialogProps {
  region: Region | null;
  childCount: number;
  onClose: () => void;
  onDeleteWithChildren: () => void;
  onDeleteMoveChildren: () => void;
}

export function DeleteConfirmDialog({
  region,
  childCount,
  onClose,
  onDeleteWithChildren,
  onDeleteMoveChildren,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={!!region} onClose={onClose} maxWidth="sm">
      <DialogTitle>Delete Region: {region?.name}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          This region has {childCount} subregion(s).
          What would you like to do with them?
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Deleting with children will remove all nested subregions and their configurations.
        </Alert>
      </DialogContent>
      <DialogActions sx={{ flexDirection: 'column', gap: 1, p: 2, alignItems: 'stretch' }}>
        <Button
          variant="outlined"
          onClick={onDeleteMoveChildren}
          fullWidth
        >
          Move children to parent, then delete
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={onDeleteWithChildren}
          fullWidth
        >
          Delete with all children
        </Button>
        <Button onClick={onClose} fullWidth>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

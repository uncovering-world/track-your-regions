import { Alert, Snackbar } from '@mui/material';

interface EditRefusedSnackbarProps {
  /** The failed edit's error, whose message is the server's sentence for the curator. */
  error: Error | null;
  /** What had already happened before the refusal, said first — a run of edits that stopped part way. */
  lead?: string | null;
  onClose: () => void;
}

/**
 * Says why a hierarchy edit did not happen. A delete, flatten, merge,
 * dismiss or prune that would take a traveller's visit is refused with 409
 * (#764), and without this the World View Editor and the import review would
 * simply leave the region where it was.
 */
export function EditRefusedSnackbar({ error, lead, onClose }: EditRefusedSnackbarProps) {
  return (
    <Snackbar open={error !== null} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert severity="error" onClose={onClose} sx={{ maxWidth: 560 }}>
        {lead ? `${lead} ${error?.message ?? ''}` : error?.message}
      </Alert>
    </Snackbar>
  );
}

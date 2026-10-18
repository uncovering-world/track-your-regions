/**
 * A world view's running re-match on the review panel, with the way to stop
 * it: since the spatial pass (#622) a re-match can take hours (#1613).
 */

import { Alert, Button } from '@mui/material';
import type { RematchStatus } from '../../api/admin/worldViewImport';
import { OperationProgressView } from './OperationProgressView';

export function RematchProgress({ status, onCancel, cancelling }: {
  status: RematchStatus;
  onCancel: () => void;
  /** Whether a stop was asked for: the run ends at its next check, so the button waits. */
  cancelling: boolean;
}) {
  return (
    <Alert severity="info" sx={{ mb: 2 }}
      action={<Button color="inherit" size="small" onClick={onCancel} disabled={cancelling}>
        {cancelling ? 'Stopping...' : 'Cancel'}
      </Button>}>
      {status.operation
        ? <OperationProgressView operation={status.operation} starting={status.statusMessage ?? ''} detail={status.statusMessage} />
        : status.statusMessage}
    </Alert>
  );
}

import { Box, Typography, Button, Alert, Stack } from '@mui/material';
import { respondToIcpAdjustment } from '../../api/adminWorldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';

export interface CvIcpAdjustmentSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
}

export function CvIcpAdjustmentSection({ cvMatchDialog, setCVMatchDialog }: CvIcpAdjustmentSectionProps) {
  const adj = cvMatchDialog.icpAdjustment;
  if (!adj) return null;

  const handleDecision = async (action: 'adjust' | 'continue') => {
    setCVMatchDialog(prev => prev ? {
      ...prev,
      icpAdjustment: undefined,
      progressText: action === 'adjust' ? 'Adjusting alignment...' : 'Continuing with original alignment...',
      progressColor: '#1565c0',
    } : prev);
    try {
      await respondToIcpAdjustment(adj.reviewId, { action });
    } catch (e) {
      console.error('[ICP Adjustment] POST failed:', e);
    }
  };

  return (
    <Box sx={{ my: 2 }}>
      <Alert severity="warning" sx={{ mb: 1.5 }}>
        <Typography variant="body2">{adj.message}</Typography>
      </Alert>
      <Stack direction="row" spacing={1.5}>
        <Button
          size="small"
          variant="contained"
          color="warning"
          onClick={() => handleDecision('adjust')}
        >
          Adjust alignment
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => handleDecision('continue')}
        >
          Continue anyway
        </Button>
      </Stack>
    </Box>
  );
}

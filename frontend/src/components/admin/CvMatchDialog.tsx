/**
 * CvMatchDialog — Full-screen dialog for CV color-match / mapshape-match workflow.
 *
 * Orchestrates water review, cluster review, ICP adjustment, geo preview,
 * cluster suggestions, and debug images. Each major review section is
 * extracted into its own component file.
 */

import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import {
  respondToWaterReview,
  respondToClusterReview,
} from '../../api/adminWorldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';
import { CvWaterReviewSection } from './CvWaterReviewSection';
import { CvIcpAdjustmentSection } from './CvIcpAdjustmentSection';

export interface CvMatchDialogProps {
  cvMatchDialog: CvMatchDialogState | null;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  /** Called when user clicks Close to dismiss the dialog */
  onClose: () => void;
}

export function CvMatchDialog({
  cvMatchDialog,
  setCVMatchDialog,
  onClose,
}: CvMatchDialogProps) {
  return (
    <Dialog
      open={cvMatchDialog != null}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { maxHeight: '90vh' } } }}
    >
      {cvMatchDialog && (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {cvMatchDialog.title}
          </DialogTitle>
          <DialogContent dividers sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
              {!cvMatchDialog.done && <CircularProgress size={18} />}
              <Typography
                variant="body2"
                sx={{ color: cvMatchDialog.progressColor, fontWeight: cvMatchDialog.done ? 600 : 400 }}
              >
                {cvMatchDialog.progressText}
              </Typography>
            </Box>
            {/* Interactive per-component water review — pipeline paused waiting for user approval */}
            {cvMatchDialog.waterReview && (
              <CvWaterReviewSection cvMatchDialog={cvMatchDialog} setCVMatchDialog={setCVMatchDialog} />
            )}
            {/* Cluster review — merge small artifact clusters before final assignment */}
            {cvMatchDialog.clusterReview && (
              <Box sx={{ mb: 2, p: 2, bgcolor: 'info.50', borderRadius: 1, border: '1px solid', borderColor: 'info.200' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Cluster review — reviewId: {cvMatchDialog.clusterReview.reviewId}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {cvMatchDialog.clusterReview.clusters.length} clusters detected.
                  Full cluster review UI is available in the feat branch.
                </Typography>
              </Box>
            )}
            {cvMatchDialog.icpAdjustment && (
              <CvIcpAdjustmentSection
                cvMatchDialog={cvMatchDialog}
                setCVMatchDialog={setCVMatchDialog}
              />
            )}
            {/* Latest pipeline image — always visible */}
            {(() => {
              const publicImages = cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__'));
              const latest = publicImages[publicImages.length - 1];
              if (!latest) return null;
              return (
                <Box sx={{ mt: 2, p: 1, border: '1px solid', borderColor: 'primary.main', borderRadius: 1 }}>
                  <Typography variant="subtitle2" color="primary" sx={{ mb: 0.5, fontWeight: 'bold' }}>
                    Current pipeline image: {latest.label}
                  </Typography>
                  <img src={latest.dataUrl} style={{ maxWidth: '100%', display: 'block' }} />
                </Box>
              );
            })()}
            {/* Full debug image history — collapsible */}
            {cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).length > 1 && (
              <Accordion sx={{ mt: 2, '&:before': { display: 'none' } }} disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'grey.50' }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    All debug images ({cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 1 }}>
                  {cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).map((img, i) => (
                    <Box key={i} sx={{ mb: 3 }}>
                      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>{img.label}</Typography>
                      <img src={img.dataUrl} style={{ maxWidth: '100%', border: '1px solid #ccc' }} />
                    </Box>
                  ))}
                </AccordionDetails>
              </Accordion>
            )}
          </DialogContent>
          <DialogActions>
            {cvMatchDialog.waterReview && !cvMatchDialog.done && (
              <Button
                color="warning"
                onClick={async () => {
                  const wr = cvMatchDialog.waterReview!;
                  // Show in-flight feedback but DON'T clear `waterReview` yet —
                  // if the POST fails we need the panel + button still mounted
                  // so the operator can retry. Otherwise the pipeline stays
                  // paused server-side with no UI to recover.
                  setCVMatchDialog(prev => prev ? { ...prev, progressText: 'Approving all water (skipped)...' } : prev);
                  try {
                    await respondToWaterReview(wr.reviewId, { approvedIds: wr.components.map(c => c.id), mixDecisions: [] });
                    setCVMatchDialog(prev => prev ? { ...prev, waterReview: undefined } : prev);
                  } catch (err) {
                    console.error('[CvMatchDialog] Skip water review failed:', err);
                    setCVMatchDialog(prev => prev ? { ...prev, progressText: 'Skip failed — try again' } : prev);
                  }
                }}
              >
                Skip Water Review
              </Button>
            )}
            {cvMatchDialog.clusterReview && !cvMatchDialog.done && (
              <Button
                color="warning"
                onClick={async () => {
                  const cr = cvMatchDialog.clusterReview!;
                  // Same pattern: don't clear clusterReview before the POST
                  // resolves so a failed skip doesn't strand the pipeline.
                  setCVMatchDialog(prev => prev ? { ...prev, progressText: 'Skipping cluster review...' } : prev);
                  try {
                    await respondToClusterReview(cr.reviewId, { merges: {} });
                    setCVMatchDialog(prev => prev ? { ...prev, clusterReview: undefined } : prev);
                  } catch (err) {
                    console.error('[CvMatchDialog] Skip cluster review failed:', err);
                    setCVMatchDialog(prev => prev ? { ...prev, progressText: 'Skip failed — try again' } : prev);
                  }
                }}
              >
                Skip Cluster Review
              </Button>
            )}
            <Button onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

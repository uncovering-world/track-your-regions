/**
 * CvMatchDialog — Full-screen dialog for CV color-match / mapshape-match workflow.
 *
 * Orchestrates water review, park review, cluster review, geo preview,
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
} from '../../api/admin/worldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';
import { CvWaterReviewSection } from './CvWaterReviewSection';
import { CvClusterReviewSection } from './CvClusterReviewSection';
import { CvGeoPreviewSection, CvClusterSuggestionsSection } from './CvGeoPreviewSection';
import { CvIcpAdjustmentSection } from './CvIcpAdjustmentSection';

export interface CvMatchDialogProps {
  cvMatchDialog: CvMatchDialogState | null;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  /** Called when user clicks Close to dismiss the dialog */
  onClose: () => void;
  highlightClusterId: number | null;
  setHighlightClusterId: React.Dispatch<React.SetStateAction<number | null>>;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;

  // Settings
  aiModelOverride: string | null;
  setAiModelOverride: React.Dispatch<React.SetStateAction<string | null>>;
  modelPickerOpen: boolean;
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modelPickerModels: Array<{ id: string }>;
  setModelPickerModels: React.Dispatch<React.SetStateAction<Array<{ id: string }>>>;
  modelPickerGlobal: string;
  setModelPickerGlobal: React.Dispatch<React.SetStateAction<string>>;
  modelPickerSelected: string;
  setModelPickerSelected: React.Dispatch<React.SetStateAction<string>>;
}

export function CvMatchDialog({
  cvMatchDialog,
  setCVMatchDialog,
  onClose,
  highlightClusterId,
  setHighlightClusterId,
  worldViewId,
  invalidateTree,
  aiModelOverride,
  setAiModelOverride,
  modelPickerOpen,
  setModelPickerOpen,
  modelPickerModels,
  setModelPickerModels,
  modelPickerGlobal,
  setModelPickerGlobal,
  modelPickerSelected,
  setModelPickerSelected,
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
            {cvMatchDialog.waterReview && <CvWaterReviewSection cvMatchDialog={cvMatchDialog} setCVMatchDialog={setCVMatchDialog} />}
            {cvMatchDialog.clusterReview && (
              <CvClusterReviewSection cvMatchDialog={cvMatchDialog} setCVMatchDialog={setCVMatchDialog} />
            )}
            {cvMatchDialog.icpAdjustment && (
              <CvIcpAdjustmentSection
                cvMatchDialog={cvMatchDialog}
                setCVMatchDialog={setCVMatchDialog}
              />
            )}
            {/* Interactive geo preview: side-by-side source map + MapLibre division map */}
            {cvMatchDialog.done && (
              <CvGeoPreviewSection
                cvMatchDialog={cvMatchDialog}
                setCVMatchDialog={setCVMatchDialog}
                highlightClusterId={highlightClusterId}
                worldViewId={worldViewId}
                invalidateTree={invalidateTree}
              />
            )}
            {/* Cluster suggestions (shown when complete) */}
            {cvMatchDialog.done && cvMatchDialog.clusters.length > 0 && (
              <CvClusterSuggestionsSection
                cvMatchDialog={cvMatchDialog}
                setCVMatchDialog={setCVMatchDialog}
                highlightClusterId={highlightClusterId}
                setHighlightClusterId={setHighlightClusterId}
                worldViewId={worldViewId}
                invalidateTree={invalidateTree}
                aiModelOverride={aiModelOverride}
                setAiModelOverride={setAiModelOverride}
                modelPickerOpen={modelPickerOpen}
                setModelPickerOpen={setModelPickerOpen}
                modelPickerModels={modelPickerModels}
                setModelPickerModels={setModelPickerModels}
                modelPickerGlobal={modelPickerGlobal}
                setModelPickerGlobal={setModelPickerGlobal}
                modelPickerSelected={modelPickerSelected}
                setModelPickerSelected={setModelPickerSelected}
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

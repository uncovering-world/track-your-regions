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
  respondToParkReview,
  respondToClusterReview,
} from '../../api/adminWorldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';
import { CvWaterReviewSection } from './CvWaterReviewSection';
import { CvParkReviewSection } from './CvParkReviewSection';
import { CvClusterReviewSection } from './CvClusterReviewSection';
import { CvGeoPreviewSection, CvClusterSuggestionsSection } from './CvGeoPreviewSection';

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
            {/* Interactive park review — pipeline paused waiting for user confirmation */}
            {cvMatchDialog.parkReview && <CvParkReviewSection cvMatchDialog={cvMatchDialog} setCVMatchDialog={setCVMatchDialog} />}
            {cvMatchDialog.clusterReview && (
              <CvClusterReviewSection cvMatchDialog={cvMatchDialog} setCVMatchDialog={setCVMatchDialog} />
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
            {/* Debug images — collapsible */}
            {cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).length > 0 && (
              <Accordion sx={{ mt: 2, '&:before': { display: 'none' } }} disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'grey.50' }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Debug images ({cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).length})
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
                  setCVMatchDialog(prev => prev ? { ...prev, waterReview: undefined, progressText: 'Approving all water (cancelled)...' } : prev);
                  try { await respondToWaterReview(wr.reviewId, { approvedIds: wr.components.map(c => c.id), mixDecisions: [] }); } catch { /* ignore */ }
                }}
              >
                Skip Water Review
              </Button>
            )}
            {cvMatchDialog.parkReview && !cvMatchDialog.done && (
              <Button
                color="warning"
                onClick={async () => {
                  const pr = cvMatchDialog.parkReview!;
                  setCVMatchDialog(prev => prev ? { ...prev, parkReview: undefined, progressText: 'Confirming all parks (skipped)...' } : prev);
                  try { await respondToParkReview(pr.reviewId, { confirmedIds: pr.components.map(c => c.id) }); } catch { /* ignore */ }
                }}
              >
                Skip Park Review
              </Button>
            )}
            {cvMatchDialog.clusterReview && !cvMatchDialog.done && (
              <Button
                color="warning"
                onClick={async () => {
                  setCVMatchDialog(prev => prev ? { ...prev, clusterReview: undefined, progressText: 'Skipping cluster review...' } : prev);
                  try { await respondToClusterReview(cvMatchDialog.clusterReview!.reviewId, { merges: {} }); } catch { /* ignore */ }
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

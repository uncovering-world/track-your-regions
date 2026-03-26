/**
 * CvParkReviewSection — Park review sub-section of CvMatchDialog.
 *
 * Shows park component images with toggle (remove/keep) classification.
 * Renders when cvMatchDialog.parkReview is present.
 */

import { Box, Typography, Button } from '@mui/material';
import { respondToParkReview } from '../../api/adminWorldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';

export interface CvParkReviewSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
}

export function CvParkReviewSection({ cvMatchDialog, setCVMatchDialog }: CvParkReviewSectionProps) {
  const pr = cvMatchDialog.parkReview!;
  const togglePark = (id: number) => {
    setCVMatchDialog(prev => {
      if (!prev?.parkReview) return prev;
      const next = new Map(prev.parkReview.decisions);
      next.set(id, !next.get(id));
      return { ...prev, parkReview: { ...prev.parkReview, decisions: next } };
    });
  };
  return (
    <Box sx={{ p: 1.5, mb: 2, border: '2px solid', borderColor: 'success.main', borderRadius: 1, bgcolor: 'success.50' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'success.dark' }}>
        Park Overlay Detection ({pr.totalParkPct}% of image)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Click to toggle: green border = remove (park), red border = keep (not a park).
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        {pr.components.map(comp => {
          const isPark = pr.decisions.get(comp.id) ?? true;
          return (
            <Box
              key={comp.id}
              onClick={() => togglePark(comp.id)}
              sx={{
                cursor: 'pointer', borderRadius: 1, overflow: 'hidden',
                border: '3px solid', borderColor: isPark ? 'success.main' : 'error.main',
                opacity: isPark ? 1 : 0.6,
                transition: 'all 0.2s',
                '&:hover': { transform: 'scale(1.05)' },
              }}
            >
              <img src={comp.cropUrl} style={{ display: 'block', maxWidth: 180, maxHeight: 120 }} />
              <Box sx={{ px: 0.5, py: 0.25, bgcolor: isPark ? 'success.light' : 'error.light', textAlign: 'center' }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {comp.pct}% — {isPark ? 'Remove' : 'Keep'}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Button
        size="small" variant="contained" color="success"
        onClick={async () => {
          const confirmedIds: number[] = [];
          for (const comp of pr.components) {
            if (pr.decisions.get(comp.id)) confirmedIds.push(comp.id);
          }
          console.log(`[Park Review] Submitting: reviewId=${pr.reviewId} confirmed=[${confirmedIds}]`);
          setCVMatchDialog(prev => prev ? { ...prev, parkReview: undefined, progressText: 'Removing park overlays...' } : prev);
          try {
            await respondToParkReview(pr.reviewId, { confirmedIds });
            console.log('[Park Review] POST succeeded');
          } catch (e) {
            console.error('[Park Review] POST failed:', e);
          }
        }}
      >
        Confirm park removal
      </Button>
    </Box>
  );
}

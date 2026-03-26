/**
 * CvWaterReviewSection — Water review sub-section of CvMatchDialog.
 *
 * Shows water component images with cycle-through classification (Water/Region/Mix)
 * and sub-cluster approval for mix decisions. Renders when cvMatchDialog.waterReview is present.
 */

import { Box, Typography, Button } from '@mui/material';
import { respondToWaterReview } from '../../api/adminWorldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';

export interface CvWaterReviewSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
}

export function CvWaterReviewSection({ cvMatchDialog, setCVMatchDialog }: CvWaterReviewSectionProps) {
  const wr = cvMatchDialog.waterReview!;
  const cycleDecision = (id: number) => {
    setCVMatchDialog(prev => {
      if (!prev?.waterReview) return prev;
      const next = new Map(prev.waterReview.decisions);
      const cur = next.get(id) ?? 'water';
      const comp = prev.waterReview.components.find(c => c.id === id);
      const hasSubs = comp && comp.subClusters.length >= 2;
      // Cycle: water -> region -> mix (if sub-clusters available) -> water
      next.set(id, cur === 'water' ? 'region' : cur === 'region' && hasSubs ? 'mix' : 'water');
      // Initialize sub-cluster approvals when entering mix
      const mixApproved = new Map(prev.waterReview.mixApproved);
      if (next.get(id) === 'mix' && !mixApproved.has(id) && comp) {
        mixApproved.set(id, new Set(comp.subClusters.map(s => s.idx)));
      }
      return { ...prev, waterReview: { ...prev.waterReview, decisions: next, mixApproved } };
    });
  };
  const toggleSubCluster = (compId: number, subIdx: number) => {
    setCVMatchDialog(prev => {
      if (!prev?.waterReview) return prev;
      const mixApproved = new Map(prev.waterReview.mixApproved);
      const subs = new Set(mixApproved.get(compId) ?? []);
      if (subs.has(subIdx)) subs.delete(subIdx); else subs.add(subIdx);
      mixApproved.set(compId, subs);
      return { ...prev, waterReview: { ...prev.waterReview, mixApproved } };
    });
  };
  const borderColor = (d: string) => d === 'water' ? 'info.main' : d === 'region' ? 'error.main' : 'warning.main';
  const bgColor = (d: string) => d === 'water' ? 'info.50' : d === 'region' ? 'error.50' : 'warning.50';
  const label = (d: string) => d === 'water' ? 'Water' : d === 'region' ? 'Region' : 'Mix';
  return (
    <Box sx={{ mb: 2, p: 2, bgcolor: 'warning.50', borderRadius: 1, border: '1px solid', borderColor: 'warning.200' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        Water detection — classify each area
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Click to cycle: Water → Region → Mix (split into sub-clusters). {wr.waterPxPercent}% of image detected.
      </Typography>
      {wr.waterMaskImage && (
        <Box sx={{ mb: 1.5 }}>
          <img src={wr.waterMaskImage} style={{ maxWidth: '100%', maxHeight: 350, borderRadius: 4, border: '1px solid #ccc' }} />
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1.5 }}>
        {wr.components.map(comp => {
          const dec = wr.decisions.get(comp.id) ?? 'water';
          return (
            <Box key={comp.id}>
              <Box sx={{
                border: '2px solid', borderColor: borderColor(dec),
                borderRadius: 1, p: 0.5, display: 'inline-block', textAlign: 'center', cursor: 'pointer',
                bgcolor: bgColor(dec), '&:hover': { opacity: 0.85 },
              }} onClick={() => cycleDecision(comp.id)}>
                <img src={comp.cropDataUrl} style={{ maxWidth: 400, maxHeight: 250, borderRadius: 2 }} />
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontWeight: 600, color: borderColor(dec) }}>
                  {label(dec)} ({comp.pct}%)
                </Typography>
              </Box>
              {/* Sub-cluster crops when "Mix" is selected */}
              {dec === 'mix' && comp.subClusters.length >= 2 && (
                <Box sx={{ ml: 3, mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {comp.subClusters.map(sc => {
                    const approved = wr.mixApproved.get(comp.id)?.has(sc.idx) ?? false;
                    return (
                      <Box key={sc.idx} sx={{
                        border: '2px solid', borderColor: approved ? 'info.main' : 'error.main',
                        borderRadius: 1, p: 0.5, textAlign: 'center', cursor: 'pointer',
                        bgcolor: approved ? 'info.50' : 'error.50', '&:hover': { opacity: 0.85 },
                      }} onClick={() => toggleSubCluster(comp.id, sc.idx)}>
                        <img src={sc.cropDataUrl} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 2 }} />
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.3, fontWeight: 600, color: approved ? 'info.main' : 'error.main' }}>
                          {approved ? 'Water' : 'Region'} ({sc.pct}%)
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Button
        size="small" variant="contained" color="primary"
        onClick={async () => {
          const approvedIds: number[] = [];
          const mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }> = [];
          for (const comp of wr.components) {
            const dec = wr.decisions.get(comp.id) ?? 'water';
            if (dec === 'water') approvedIds.push(comp.id);
            else if (dec === 'mix') {
              const subs = wr.mixApproved.get(comp.id);
              mixDecisions.push({ componentId: comp.id, approvedSubClusters: subs ? [...subs] : [] });
            }
          }
          console.log(`[Water Review] Submitting: reviewId=${wr.reviewId} approved=[${approvedIds}] mix=[${mixDecisions.map(m => `${m.componentId}:[${m.approvedSubClusters}]`)}] all_components=[${wr.components.map(c => c.id)}]`);
          setCVMatchDialog(prev => prev ? { ...prev, waterReview: undefined, progressText: 'Applying water decisions...' } : prev);
          try {
            await respondToWaterReview(wr.reviewId, { approvedIds, mixDecisions });
            console.log('[Water Review] POST succeeded');
          } catch (e) {
            console.error('[Water Review] POST failed:', e);
          }
        }}
      >
        Confirm selection
      </Button>
    </Box>
  );
}

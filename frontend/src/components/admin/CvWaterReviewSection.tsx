/**
 * CvWaterReviewSection — Water review sub-section of CvMatchDialog.
 *
 * Shows water component images with cycle-through classification (Water/Region/Mix)
 * and sub-cluster approval for mix decisions. Renders when cvMatchDialog.waterReview is present.
 */

import { Box, Typography, Button } from '@mui/material';
import { respondToWaterReview } from '../../api/adminWorldViewImport';
import { AuthImage } from '../shared/AuthImage';
import type { CvMatchDialogState } from './useCvMatchPipeline';

export interface CvWaterReviewSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
}

type WaterDecision = 'water' | 'region' | 'mix';

/** Next state in the water → region → mix → water cycle */
function nextDecision(current: WaterDecision, hasSubs: boolean): WaterDecision {
  if (current === 'water') return 'region';
  if (current === 'region' && hasSubs) return 'mix';
  return 'water';
}

const DECISION_BORDER: Record<WaterDecision, string> = {
  water: 'info.main',
  region: 'error.main',
  mix: 'warning.main',
};
const DECISION_BG: Record<WaterDecision, string> = {
  water: 'info.50',
  region: 'error.50',
  mix: 'warning.50',
};
const DECISION_LABEL: Record<WaterDecision, string> = {
  water: 'Water',
  region: 'Region',
  mix: 'Mix',
};

export function CvWaterReviewSection({ cvMatchDialog, setCVMatchDialog }: CvWaterReviewSectionProps) {
  const wr = cvMatchDialog.waterReview!;
  const cycleDecision = (id: number) => {
    setCVMatchDialog(prev => {
      if (!prev?.waterReview) return prev;
      const next = new Map(prev.waterReview.decisions);
      const cur = (next.get(id) ?? 'water') as WaterDecision;
      const comp = prev.waterReview.components.find(c => c.id === id);
      const hasSubs = !!comp && comp.subClusters.length >= 2;
      next.set(id, nextDecision(cur, hasSubs));
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
  const borderColor = (d: string) => DECISION_BORDER[d as WaterDecision] ?? DECISION_BORDER.mix;
  const bgColor = (d: string) => DECISION_BG[d as WaterDecision] ?? DECISION_BG.mix;
  const label = (d: string) => DECISION_LABEL[d as WaterDecision] ?? DECISION_LABEL.mix;
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
                <AuthImage src={comp.cropDataUrl} style={{ maxWidth: 400, maxHeight: 250, borderRadius: 2 }} />
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
                        <AuthImage src={sc.cropDataUrl} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 2 }} />
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
          // Show in-flight feedback but DON'T clear `waterReview` yet — if
          // the POST fails the panel needs to stay mounted so the operator
          // can resubmit. Otherwise the pipeline stays paused server-side
          // with no UI to recover.
          setCVMatchDialog(prev => prev ? { ...prev, progressText: 'Applying water decisions...' } : prev);
          try {
            await respondToWaterReview(wr.reviewId, { approvedIds, mixDecisions });
            setCVMatchDialog(prev => prev ? { ...prev, waterReview: undefined } : prev);
          } catch (e) {
            console.error('[Water Review] POST failed:', e);
            setCVMatchDialog(prev => prev ? { ...prev, progressText: 'Confirm failed — try again' } : prev);
          }
        }}
      >
        Confirm selection
      </Button>
    </Box>
  );
}

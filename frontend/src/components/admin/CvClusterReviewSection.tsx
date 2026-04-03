/**
 * CvClusterReviewSection — Cluster review sub-section of CvMatchDialog.
 *
 * Shows detected color clusters with merge/exclude/keep controls, split buttons,
 * re-cluster presets, and cluster highlight overlay. Renders when
 * cvMatchDialog.clusterReview is present.
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Select,
  MenuItem,
} from '@mui/material';
import {
  CallSplit as SplitIcon,
  Block as BlockIcon,
  Brush as BrushIcon,
  FormatPaint as FormatPaintIcon,
} from '@mui/icons-material';
import {
  respondToClusterReview,
  clusterHighlightUrl,
} from '../../api/adminWorldViewImport';
import { clusterOverlayUrl } from '../../api/adminWvImportCvMatch';
import ClusterPaintEditor from './ClusterPaintEditor';
import type { CvMatchDialogState } from './useCvMatchPipeline';

export interface CvClusterReviewSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
}

export function CvClusterReviewSection({ cvMatchDialog, setCVMatchDialog }: CvClusterReviewSectionProps) {
  const cr = cvMatchDialog.clusterReview!;
  // __source_map__ is pushed after ICP (post-cluster-review), so fall back to last non-special debug image
  const sourceImg = cvMatchDialog.debugImages.find(img => img.label === '__source_map__')
    ?? [...cvMatchDialog.debugImages].reverse().find(img => !img.label.startsWith('__'));
  const originalImg = cvMatchDialog.debugImages.find(img => img.label === '__original_map__');
  const sorted = [...cr.clusters].sort((a, b) => b.pct - a.pct);
  const [paintMode, setPaintMode] = useState<'off' | 'fix' | 'scratch'>('off');
  // Targets for "merge into" = any non-excluded cluster
  // Merge targets: only clusters that are "kept" (not excluded or merged into something else)
  const mergeTargets = sorted.filter(c => !cr.excludes.has(c.label) && !cr.merges.has(c.label));
  // Helper: look up assigned region name for a cluster label
  const regionNameForLabel = (label: number): string | null => {
    const regionId = cr.regionAssignments.get(label);
    if (regionId == null) return null;
    return cvMatchDialog.childRegions.find(r => r.id === regionId)?.name ?? null;
  };
  const setAction = (label: number, value: string) => {
    setCVMatchDialog(prev => {
      if (!prev?.clusterReview) return prev;
      const nextMerges = new Map(prev.clusterReview.merges);
      const nextExcludes = new Set(prev.clusterReview.excludes);
      nextMerges.delete(label);
      nextExcludes.delete(label);
      if (value === 'exclude') {
        nextExcludes.add(label);
      } else if (value !== '' && value !== 'keep') {
        nextMerges.set(label, Number(value));
      }
      return { ...prev, clusterReview: { ...prev.clusterReview, merges: nextMerges, excludes: nextExcludes } };
    });
  };
  const getAction = (label: number): string => {
    if (cr.excludes.has(label)) return 'exclude';
    const m = cr.merges.get(label);
    return m !== undefined ? String(m) : 'keep';
  };
  if (paintMode !== 'off') {
    return (
      <ClusterPaintEditor
        sourceImageUrl={sourceImg?.dataUrl ?? ''}
        originalImageUrl={originalImg?.dataUrl}
        overlayImageUrl={paintMode === 'fix' ? clusterOverlayUrl(cr.reviewId) : undefined}
        initialClusters={paintMode === 'fix' ? cr.clusters : undefined}
        borderPaths={cr.borderPaths}
        pipelineSize={cr.pipelineSize}
        onConfirm={async (response) => {
          setCVMatchDialog(prev => prev ? {
            ...prev,
            clusterReview: undefined,
            savedRegionAssignments: cr.regionAssignments.size > 0 ? new Map(cr.regionAssignments) : undefined,
            progressText: 'Applying manually painted clusters...',
          } : prev);
          try {
            await respondToClusterReview(cr.reviewId, response);
          } catch (e) {
            console.error('[Manual Clusters] POST failed:', e);
          }
        }}
        onCancel={() => setPaintMode('off')}
      />
    );
  }

  return (
    <Box sx={{ p: 1.5, mb: 2, border: '2px solid', borderColor: 'info.main', borderRadius: 1, bgcolor: 'info.50' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'info.dark' }}>
        Cluster Review
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Review detected color clusters. Exclude artifacts (gray/noise), merge small leftovers into real regions, or keep as-is.
      </Typography>
      {/* Side-by-side: region map + cluster preview — sticky, max 40vh so cluster list is always visible */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, position: 'sticky', top: 0, zIndex: 10, bgcolor: 'info.50', pb: 1 }}>
        {cvMatchDialog.regionMapUrl && (
          <Box sx={{ flex: '1 1 45%', textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="caption" color="text.secondary">Region map</Typography>
            <img src={cvMatchDialog.regionMapUrl} style={{ maxWidth: '100%', maxHeight: '35vh', objectFit: 'contain', borderRadius: 4 }} />
          </Box>
        )}
        {cr.previewImage && (
          <Box sx={{ flex: '1 1 45%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">Detected clusters {cr.highlightedLabel != null ? '(click color circle to highlight)' : '(click a color circle to highlight)'}</Typography>
            <Box sx={{ position: 'relative', display: 'inline-flex', maxHeight: '35vh' }}>
              <img src={cr.previewImage} style={{ maxWidth: '100%', maxHeight: '35vh', objectFit: 'contain', borderRadius: 4, display: 'block' }} />
              {cr.highlightOverlay && (
                <img src={cr.highlightOverlay} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', borderRadius: 4, pointerEvents: 'none' }} />
              )}
            </Box>
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {sorted.map(c => {
          const action = getAction(c.label);
          const isExcluded = action === 'exclude';
          const isMerged = action !== 'keep' && action !== 'exclude';
          const isKept = action === 'keep';
          // Already-assigned region IDs (by other clusters)
          const usedRegionIds = new Set<number>();
          for (const [lbl, rid] of cr.regionAssignments) {
            if (lbl !== c.label) usedRegionIds.add(rid);
          }
          return (
            <Box key={c.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: isExcluded || isMerged ? 0.5 : 1 }}>
              <Box
                sx={{
                  width: 20, height: 20, bgcolor: c.color, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                  border: cr.highlightedLabel === c.label ? '3px solid red' : '1px solid #999',
                }}
                onClick={() => {
                  const isDeselect = cr.highlightedLabel === c.label;
                  setCVMatchDialog(prev => {
                    if (!prev?.clusterReview) return prev;
                    if (isDeselect) return { ...prev, clusterReview: { ...prev.clusterReview, highlightedLabel: undefined, highlightOverlay: undefined } };
                    return { ...prev, clusterReview: { ...prev.clusterReview, highlightedLabel: c.label, highlightOverlay: undefined } };
                  });
                  if (!isDeselect) {
                    const hlUrl = clusterHighlightUrl(cr.reviewId, c.label);
                    fetch(hlUrl).then(r => r.ok ? r.blob() : null).then(blob => {
                      if (blob) {
                        const objUrl = URL.createObjectURL(blob);
                        setCVMatchDialog(prev => {
                          if (!prev?.clusterReview || prev.clusterReview.highlightedLabel !== c.label) return prev;
                          return { ...prev, clusterReview: { ...prev.clusterReview, highlightOverlay: objUrl } };
                        });
                      }
                    }).catch(() => {});
                  }
                }}
                title="Click to highlight this cluster on the map"
              />
              <Typography variant="body2" sx={{ minWidth: 55, fontWeight: c.isSmall ? 400 : 600 }}>
                {c.pct.toFixed(1)}%
              </Typography>
              <Select
                size="small"
                value={action}
                onChange={(e) => setAction(c.label, e.target.value)}
                sx={{ minWidth: 160, fontSize: '0.8rem', height: 30 }}
              >
                <MenuItem value="keep">Keep as region</MenuItem>
                <MenuItem value="exclude" sx={{ color: 'error.main' }}>Exclude (not a region)</MenuItem>
                {mergeTargets.filter(t => t.label !== c.label).map(t => {
                  const rName = regionNameForLabel(t.label);
                  return (
                    <MenuItem key={t.label} value={String(t.label)}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Box sx={{ width: 12, height: 12, bgcolor: t.color, borderRadius: '50%', border: '1px solid #ccc' }} />
                        <span>Merge into {rName ?? `${t.pct.toFixed(1)}%`}</span>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
              {!isExcluded && (
                <IconButton
                  size="small"
                  title="Exclude (not a region)"
                  color="error"
                  onClick={() => setAction(c.label, 'exclude')}
                  sx={{ p: 0.25 }}
                >
                  <BlockIcon fontSize="small" />
                </IconButton>
              )}
              {isKept && cvMatchDialog.childRegions.length > 0 && (
                <Select
                  size="small"
                  displayEmpty
                  value={cr.regionAssignments.get(c.label) ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCVMatchDialog(prev => {
                      if (!prev?.clusterReview) return prev;
                      const next = new Map(prev.clusterReview.regionAssignments);
                      if (val === '') next.delete(c.label);
                      else next.set(c.label, Number(val));
                      return { ...prev, clusterReview: { ...prev.clusterReview, regionAssignments: next } };
                    });
                  }}
                  sx={{ minWidth: 140, flex: 1, fontSize: '0.8rem', height: 30 }}
                >
                  <MenuItem value=""><em>Region...</em></MenuItem>
                  {cvMatchDialog.childRegions.map(r => (
                    <MenuItem key={r.id} value={r.id} disabled={usedRegionIds.has(r.id)}>
                      {r.name}
                    </MenuItem>
                  ))}
                </Select>
              )}
              {isKept && c.componentCount > 1 && (
                <IconButton
                  size="small"
                  title={`Split into ${c.componentCount} disconnected parts`}
                  color="warning"
                  onClick={async () => {
                    setCVMatchDialog(prev => prev ? {
                      ...prev,
                      clusterReview: undefined,
                      savedRegionAssignments: cr.regionAssignments.size > 0 ? new Map(cr.regionAssignments) : undefined,
                      savedMerges: cr.merges.size > 0 ? new Map(cr.merges) : undefined,
                      savedExcludes: cr.excludes.size > 0 ? new Set(cr.excludes) : undefined,
                      progressText: `Splitting cluster into ${c.componentCount} parts...`,
                    } : prev);
                    try {
                      await respondToClusterReview(cr.reviewId, {
                        merges: {},
                        split: [c.label],
                      });
                    } catch (e) {
                      console.error('[Split] POST failed:', e);
                    }
                  }}
                >
                  <SplitIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          );
        })}
      </Box>
      <Button
        size="small" variant="contained" color="info"
        sx={{ mt: 1.5 }}
        onClick={async () => {
          const merges: Record<number, number> = {};
          for (const [from, to] of cr.merges) merges[from] = to;
          const excludes = [...cr.excludes];
          console.log(`[Cluster Review] Submitting: reviewId=${cr.reviewId} merges=`, merges, 'excludes=', excludes);
          setCVMatchDialog(prev => prev ? {
            ...prev,
            clusterReview: undefined,
            savedRegionAssignments: cr.regionAssignments.size > 0 ? new Map(cr.regionAssignments) : undefined,
            progressText: 'Applying cluster decisions...',
          } : prev);
          try {
            await respondToClusterReview(cr.reviewId, { merges, excludes });
            console.log('[Cluster Review] POST succeeded');
          } catch (e) {
            console.error('[Cluster Review] POST failed:', e);
          }
        }}
      >
        Confirm clusters
      </Button>
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
        <Button
          size="small" variant="outlined" color="secondary"
          startIcon={<BrushIcon />}
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
          onClick={() => setPaintMode('fix')}
        >
          Edit manually
        </Button>
        <Button
          size="small" variant="outlined" color="secondary"
          startIcon={<FormatPaintIcon />}
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
          onClick={() => setPaintMode('scratch')}
        >
          Draw from scratch
        </Button>
      </Box>
      {/* Split all disconnected + Re-cluster options */}
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
        {sorted.some(c => c.componentCount > 1 && getAction(c.label) === 'keep' && !cr.regionAssignments.has(c.label)) && (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<SplitIcon />}
            sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
            title="Split unhandled clusters that have disconnected parts"
            onClick={async () => {
              const splitLabels = sorted.filter(c => c.componentCount > 1 && getAction(c.label) === 'keep' && !cr.regionAssignments.has(c.label)).map(c => c.label);
              setCVMatchDialog(prev => prev ? {
                ...prev,
                clusterReview: undefined,
                savedRegionAssignments: cr.regionAssignments.size > 0 ? new Map(cr.regionAssignments) : undefined,
                savedMerges: cr.merges.size > 0 ? new Map(cr.merges) : undefined,
                savedExcludes: cr.excludes.size > 0 ? new Set(cr.excludes) : undefined,
                progressText: `Splitting ${splitLabels.length} cluster(s) into components...`,
              } : prev);
              try {
                await respondToClusterReview(cr.reviewId, { merges: {}, split: splitLabels });
              } catch (e) {
                console.error('[Split All] POST failed:', e);
              }
            }}
          >
            Split disconnected
          </Button>
        )}
        {([
          { preset: 'more_clusters' as const, label: 'More clusters' },
          { preset: 'different_seed' as const, label: 'Different seed' },
          { preset: 'boost_chroma' as const, label: 'Boost colors' },
          { preset: 'remove_roads' as const, label: 'Remove roads' },
          { preset: 'fill_holes' as const, label: 'Fill holes' },
          { preset: 'clean_light' as const, label: 'Clean noise' },
          { preset: 'clean_heavy' as const, label: 'Clean noise+' },
        ]).map(opt => (
          <Button
            key={opt.preset}
            size="small"
            variant="outlined"
            color="warning"
            sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
            title={opt.label}
            onClick={async () => {
              setCVMatchDialog(prev => prev ? {
                ...prev,
                clusterReview: undefined,
                progressText: `Re-clustering (${opt.label.toLowerCase()})...`,
              } : prev);
              try {
                await respondToClusterReview(cr.reviewId, {
                  merges: {},
                  recluster: { preset: opt.preset },
                });
              } catch (e) {
                console.error('[Recluster] POST failed:', e);
              }
            }}
          >
            {opt.label}
          </Button>
        ))}
      </Box>
    </Box>
  );
}

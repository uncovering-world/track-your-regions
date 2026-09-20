/**
 * What the cluster review offers a curator, under the maps: each cluster the
 * pipeline found against the region it suggests, the AI pass that proposes the
 * rest and the model it runs under, the child regions no cluster matched and
 * the divisions that fell outside the source map's own coverage — and the two
 * buttons that accept: every matched division, or only those the pipeline is
 * at least 95% sure of.
 *
 * Its own file beside `CvGeoPreviewSection.tsx`, which had reached the length
 * the lint draws the line at (#933); the maps stay there.
 */

import { useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import {
  acceptBatchMatches,
  aiSuggestClusterRegions,
  type ColorMatchCluster,
  type ClusterGeoInfo,
} from '../../api/admin/worldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';
import { ClusterCard } from './CvClusterCard';
import { safeHref } from '../../utils/safeHref';

// ─── Cluster Suggestions ────────────────────────────────────────────────────

export interface CvClusterSuggestionsSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  highlightClusterId: number | null;
  setHighlightClusterId: React.Dispatch<React.SetStateAction<number | null>>;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
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

// Apply AI cluster-to-region match results to the dialog state.
function applyAISuggestionsToState(
  prev: CvMatchDialogState,
  matches: Array<{ clusterId: number; regionId: number | null }>,
  totalCost: number,
): CvMatchDialogState {
  const matchMap = new Map<number, number>();
  for (const m of matches) {
    if (m.regionId) matchMap.set(m.clusterId, m.regionId);
  }
  const findRegionForCluster = (clusterId: number) => {
    const regionId = matchMap.get(clusterId);
    if (!regionId) return null;
    return prev.childRegions.find(r => r.id === regionId) ?? null;
  };
  const applyToCluster = (c: ColorMatchCluster): ColorMatchCluster => {
    const region = findRegionForCluster(c.clusterId);
    return region ? { ...c, suggestedRegion: region } : c;
  };
  const applyToClusterInfo = (ci: ClusterGeoInfo): ClusterGeoInfo => {
    const region = findRegionForCluster(ci.clusterId);
    return region ? { ...ci, regionId: region.id, regionName: region.name } : ci;
  };
  const applyToFeature = (f: GeoJSON.Feature): GeoJSON.Feature => {
    if (!f.properties?.clusterId) return f;
    const region = findRegionForCluster(f.properties.clusterId);
    if (!region) return f;
    return { ...f, properties: { ...f.properties, regionId: region.id, regionName: region.name } };
  };
  const newClusters = prev.clusters.map(applyToCluster);
  const newGeo = prev.geoPreview ? {
    ...prev.geoPreview,
    clusterInfos: prev.geoPreview.clusterInfos.map(applyToClusterInfo),
    featureCollection: {
      ...prev.geoPreview.featureCollection,
      features: prev.geoPreview.featureCollection.features.map(applyToFeature),
    },
  } : prev.geoPreview;
  return {
    ...prev,
    clusters: newClusters,
    geoPreview: newGeo,
    progressText: `AI matched ${matchMap.size}/${prev.clusters.length} clusters ($${totalCost.toFixed(3)})`,
  };
}

export function CvClusterSuggestionsSection({
  cvMatchDialog, setCVMatchDialog,
  highlightClusterId, setHighlightClusterId,
  worldViewId, invalidateTree,
  aiModelOverride, setAiModelOverride,
  modelPickerOpen, setModelPickerOpen,
  modelPickerModels, setModelPickerModels,
  modelPickerGlobal, setModelPickerGlobal,
  modelPickerSelected, setModelPickerSelected,
}: CvClusterSuggestionsSectionProps) {
  const handleAISuggest = useCallback(async () => {
    const prevText = cvMatchDialog.progressText;
    setCVMatchDialog(prev => prev ? { ...prev, progressText: 'AI suggesting region matches...' } : prev);
    try {
      const clusterData = cvMatchDialog.clusters.map(c => ({
        clusterId: c.clusterId,
        color: c.color,
        pixelShare: c.pixelShare,
        divisionNames: [
          ...c.divisions.map(d => d.name),
          ...c.unsplittable.map(d => d.name),
        ],
      }));
      const result = await aiSuggestClusterRegions(
        worldViewId, clusterData, cvMatchDialog.childRegions, aiModelOverride || undefined,
      );
      setCVMatchDialog(prev => prev ? applyAISuggestionsToState(prev, result.matches, result.stats.cost) : prev);
    } catch (err) {
      console.error('AI suggest failed:', err);
      setCVMatchDialog(prev => prev ? { ...prev, progressText: prevText } : prev);
    }
  }, [cvMatchDialog, worldViewId, aiModelOverride, setCVMatchDialog]);

  const handleOpenModelPicker = useCallback(async () => {
    try {
      const { getAISettings } = await import('../../api/admin/ai');
      const { settings, models } = await getAISettings();
      const current = settings['model.cv_cluster_match'] || 'o4-mini';
      setModelPickerModels(models);
      setModelPickerGlobal(current);
      setModelPickerSelected(aiModelOverride || current);
      setModelPickerOpen(true);
    } catch (err) {
      console.error('Failed to load AI models:', err);
    }
  }, [aiModelOverride, setModelPickerModels, setModelPickerGlobal, setModelPickerSelected, setModelPickerOpen]);

  const handleSaveGlobalModel = useCallback(async () => {
    try {
      const { updateAISetting } = await import('../../api/admin/ai');
      await updateAISetting('model.cv_cluster_match', modelPickerSelected);
      setAiModelOverride(null);
      setModelPickerOpen(false);
      setCVMatchDialog(prev => prev ? { ...prev, progressText: `Global model → ${modelPickerSelected}` } : prev);
    } catch (err) {
      console.error('Failed to save:', err);
    }
  }, [modelPickerSelected, setAiModelOverride, setModelPickerOpen, setCVMatchDialog]);

  // The stored source page, opened only where it is a page a reader may be
  // sent to (#703). `window.open` is the one sink React does not guard: a
  // `javascript:` url handed to it runs in this origin, on every browser.
  const sourceHref = safeHref(cvMatchDialog.sourceUrl);

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Suggested Assignments ({cvMatchDialog.clusters.reduce((s, c) => s + c.divisions.length, 0)} divisions → {cvMatchDialog.clusters.length} regions)
        </Typography>
        <Button
          size="small"
          variant="outlined"
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75, textTransform: 'none' }}
          disabled={!sourceHref}
          onClick={() => sourceHref && window.open(sourceHref, '_blank', 'noopener,noreferrer')}
          title={sourceHref ? 'Open Wikivoyage page to see region names' : 'No source URL available'}
        >
          View source page
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="primary"
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75, textTransform: 'none' }}
          disabled={cvMatchDialog.clusters.length === 0 || cvMatchDialog.childRegions.length === 0}
          title="Use AI to match clusters to region names based on division geography"
          onClick={handleAISuggest}
        >
          AI Suggest
        </Button>
        <IconButton
          size="small"
          title={aiModelOverride ? `Model: ${aiModelOverride} (local override)` : 'Change AI model'}
          sx={{ width: 24, height: 24 }}
          onClick={handleOpenModelPicker}
        >
          <SettingsIcon sx={{ fontSize: 14, color: aiModelOverride ? 'primary.main' : 'text.secondary' }} />
        </IconButton>
        <Dialog open={modelPickerOpen} onClose={() => setModelPickerOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ pb: 1, fontSize: '1rem' }}>AI Model — Cluster Match</DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Global: {modelPickerGlobal}{aiModelOverride ? ` · Local override: ${aiModelOverride}` : ''}
            </Typography>
            <Select
              size="small"
              fullWidth
              value={modelPickerSelected}
              onChange={e => setModelPickerSelected(e.target.value)}
              sx={{ fontSize: '0.85rem' }}
            >
              {modelPickerModels.map(m => (
                <MenuItem key={m.id} value={m.id}>{m.id}</MenuItem>
              ))}
            </Select>
          </DialogContent>
          <DialogActions>
            {aiModelOverride && (
              <Button size="small" color="warning" onClick={() => { setAiModelOverride(null); setModelPickerOpen(false); }}>
                Clear override
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setModelPickerOpen(false)}>Cancel</Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => { setAiModelOverride(modelPickerSelected); setModelPickerOpen(false); }}
            >
              Use locally
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleSaveGlobalModel}
            >
              Save global
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
      {cvMatchDialog.clusters.map(cluster => (
        <ClusterCard
          key={cluster.clusterId}
          cluster={cluster}
          cvMatchDialog={cvMatchDialog}
          setCVMatchDialog={setCVMatchDialog}
          highlightClusterId={highlightClusterId}
          setHighlightClusterId={setHighlightClusterId}
          worldViewId={worldViewId}
          invalidateTree={invalidateTree}
        />
      ))}
      {/* Unmatched child regions — no cluster found for these */}
      {(() => {
        const matchedRegionIds = new Set(cvMatchDialog.clusters.map(c => c.suggestedRegion?.id).filter(Boolean));
        const unmatched = cvMatchDialog.childRegions.filter(r => !matchedRegionIds.has(r.id));
        if (unmatched.length === 0) return null;
        return (
          <Box sx={{ mb: 2, p: 1.5, border: '1px dashed', borderColor: 'warning.main', borderRadius: 1, bgcolor: 'warning.50' }}>
            <Typography variant="subtitle2" color="warning.main" sx={{ mb: 0.5 }}>
              Unmatched regions ({unmatched.length}) — reassign a cluster above using its dropdown
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              Each cluster has a region dropdown — pick one of these unmatched regions to assign its divisions.
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {unmatched.map(r => (
                <Chip key={r.id} label={r.name} size="small" variant="outlined" color="warning" />
              ))}
            </Box>
          </Box>
        );
      })()}
      {/* Out-of-bounds divisions — centroids outside source map coverage */}
      {(cvMatchDialog.outOfBounds?.length ?? 0) > 0 && (
        <Box sx={{ mb: 2, p: 1.5, border: '1px dashed', borderColor: 'info.main', borderRadius: 1, bgcolor: 'info.50' }}>
          <Typography variant="subtitle2" color="info.main" sx={{ mb: 0.5 }}>
            Outside map coverage ({cvMatchDialog.outOfBounds.length} divisions)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            These divisions fall outside the source map image. Assign them manually in the tree.
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {cvMatchDialog.outOfBounds.map(d => (
              <Chip key={d.id} label={d.name} size="small" variant="outlined" color="info" />
            ))}
          </Box>
        </Box>
      )}
      {/* Action buttons */}
      <AcceptActionButtons
        cvMatchDialog={cvMatchDialog}
        setCVMatchDialog={setCVMatchDialog}
        worldViewId={worldViewId}
        invalidateTree={invalidateTree}
      />
    </Box>
  );
}

// ─── Accept Action Buttons ──────────────────────────────────────────────────

function AcceptActionButtons({
  cvMatchDialog, setCVMatchDialog,
  worldViewId, invalidateTree,
}: {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
}) {
  const MIN_CONFIDENCE = 0.95;

  const wellFittingDivs = useMemo(() => {
    return cvMatchDialog.clusters
      .filter(c => c.suggestedRegion && c.divisions.length > 0)
      .flatMap(c => c.divisions
        .filter(d => d.confidence >= MIN_CONFIDENCE)
        .map(d => ({ regionId: c.suggestedRegion!.id, divisionId: d.id })));
  }, [cvMatchDialog.clusters]);

  const totalMatchedCount = useMemo(() => {
    return cvMatchDialog.clusters
      .filter(c => c.suggestedRegion)
      .reduce((s, c) => s + c.divisions.length + c.unsplittable.length, 0);
  }, [cvMatchDialog.clusters]);

  const hasAnyMatched = cvMatchDialog.clusters.some(
    c => c.suggestedRegion && (c.divisions.length > 0 || c.unsplittable.length > 0),
  );
  const showWellFittingButton = wellFittingDivs.length > 0 && wellFittingDivs.length !== totalMatchedCount;

  const handleAcceptWellFitting = useCallback(async () => {
    if (wellFittingDivs.length === 0) return;
    try {
      const acceptedIds = new Set(wellFittingDivs.map(a => a.divisionId));
      await acceptBatchMatches(worldViewId, wellFittingDivs);
      const stripAccepted = (c: ColorMatchCluster): ColorMatchCluster => ({
        ...c,
        divisions: c.divisions.filter(d => !acceptedIds.has(d.id)),
      });
      const hasMembers = (c: ColorMatchCluster) => c.divisions.length > 0 || c.unsplittable.length > 0;
      setCVMatchDialog(prev => prev ? {
        ...prev,
        clusters: prev.clusters.map(stripAccepted).filter(hasMembers),
      } : prev);
      invalidateTree(cvMatchDialog.regionId);
    } catch (err) {
      console.error('Accept well-fitting failed:', err);
    }
  }, [wellFittingDivs, worldViewId, setCVMatchDialog, invalidateTree, cvMatchDialog.regionId]);

  const handleAcceptAllMatched = useCallback(async () => {
    const allAssignments: Array<{ regionId: number; divisionId: number }> = [];
    for (const cluster of cvMatchDialog.clusters) {
      if (!cluster.suggestedRegion) continue;
      for (const div of cluster.divisions) {
        allAssignments.push({ regionId: cluster.suggestedRegion.id, divisionId: div.id });
      }
      for (const div of cluster.unsplittable) {
        allAssignments.push({ regionId: cluster.suggestedRegion.id, divisionId: div.id });
      }
    }
    if (allAssignments.length === 0) return;
    try {
      await acceptBatchMatches(worldViewId, allAssignments);
      setCVMatchDialog(prev => prev ? {
        ...prev,
        clusters: prev.clusters.filter(c => !c.suggestedRegion),
      } : prev);
      invalidateTree(cvMatchDialog.regionId);
    } catch (err) {
      console.error('Accept all failed:', err);
    }
  }, [cvMatchDialog.clusters, cvMatchDialog.regionId, worldViewId, setCVMatchDialog, invalidateTree]);

  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
      {showWellFittingButton && (
        <Button
          variant="contained"
          color="success"
          sx={{ flex: 1 }}
          onClick={handleAcceptWellFitting}
        >
          Accept well-fitting ({wellFittingDivs.length} divisions, &gt;95%)
        </Button>
      )}
      {hasAnyMatched && (
        <Button
          variant="contained"
          color="success"
          sx={{ flex: 1 }}
          onClick={handleAcceptAllMatched}
        >
          Accept all matched ({totalMatchedCount} divisions)
        </Button>
      )}
    </Box>
  );
}

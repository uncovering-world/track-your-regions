/**
 * One cluster as the review draws it: its colour and size, the region it is
 * assigned or suggested to, the divisions it covers, and the ways to reassign
 * it, light it up on the map, or accept every division it holds.
 *
 * Its own file beside `CvClusterSuggestionsSection.tsx`, which lists them
 * (#933).
 */

import { Box, Typography, Button, IconButton, Select, MenuItem } from '@mui/material';
import { Visibility } from '@mui/icons-material';
import { acceptBatchMatches, type ColorMatchCluster } from '../../api/admin/worldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';

// ─── ClusterCard ────────────────────────────────────────────────────────────

export function ClusterCard({
  cluster, cvMatchDialog, setCVMatchDialog,
  highlightClusterId, setHighlightClusterId,
  worldViewId, invalidateTree,
}: {
  cluster: ColorMatchCluster;
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  highlightClusterId: number | null;
  setHighlightClusterId: React.Dispatch<React.SetStateAction<number | null>>;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
}) {
  return (
    <Box
      sx={{ mb: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, borderLeft: `4px solid ${cluster.color}` }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 16, height: 16, bgcolor: cluster.color, borderRadius: '2px', border: '1px solid rgba(0,0,0,0.2)', flexShrink: 0 }} />
          <Select
            size="small"
            displayEmpty
            value={cluster.suggestedRegion?.id ?? ''}
            sx={{ minWidth: 150, fontSize: '0.85rem', height: 28 }}
            onChange={(e) => {
              const rid = Number(e.target.value);
              const region = cvMatchDialog.childRegions.find(r => r.id === rid);
              if (!region) return;
              const cid = cluster.clusterId;
              setCVMatchDialog(prev => {
                if (!prev) return prev;
                const newClusters = prev.clusters.map(c =>
                  c.clusterId === cid ? { ...c, suggestedRegion: region } : c
                );
                // Propagate mapping to geoPreview so the map reflects it immediately
                const newGeo = prev.geoPreview ? {
                  ...prev.geoPreview,
                  clusterInfos: prev.geoPreview.clusterInfos.map(ci =>
                    ci.clusterId === cid ? { ...ci, regionId: rid, regionName: region.name } : ci
                  ),
                  featureCollection: {
                    ...prev.geoPreview.featureCollection,
                    features: prev.geoPreview.featureCollection.features.map(f =>
                      f.properties?.clusterId === cid
                        ? { ...f, properties: { ...f.properties, regionId: rid, regionName: region.name } }
                        : f
                    ),
                  },
                } : prev.geoPreview;
                return { ...prev, clusters: newClusters, geoPreview: newGeo };
              });
            }}
          >
            <MenuItem value="" disabled>
              Assign to region...
            </MenuItem>
            {(cvMatchDialog.childRegions ?? []).map(r => (
              <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
            ))}
          </Select>
          <Typography variant="body2" color="text.secondary">
            {Math.round(cluster.pixelShare * 100)}% · {cluster.divisions.length} div
            {cluster.unsplittable.length > 0 && ` · ${cluster.unsplittable.length} unsplittable`}
          </Typography>
          <IconButton
            size="small"
            title="Highlight on map"
            onClick={() => setHighlightClusterId(prev => prev === cluster.clusterId ? null : cluster.clusterId)}
            sx={{
              bgcolor: highlightClusterId === cluster.clusterId ? cluster.color : 'transparent',
              color: highlightClusterId === cluster.clusterId ? '#fff' : 'text.secondary',
              border: '1px solid',
              borderColor: highlightClusterId === cluster.clusterId ? cluster.color : 'divider',
              width: 26, height: 26,
              '&:hover': { bgcolor: cluster.color, color: '#fff' },
            }}
          >
            <Visibility sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        {(cluster.divisions.length > 0 || cluster.unsplittable.length > 0) && (
          <Button
            size="small"
            variant="contained"
            color="success"
            disabled={!cluster.suggestedRegion}
            title={!cluster.suggestedRegion ? 'Select a region from the dropdown first' : `Accept all ${cluster.divisions.length + cluster.unsplittable.length} divisions into ${cluster.suggestedRegion.name}`}
            onClick={async () => {
              if (!cluster.suggestedRegion) return;
              const regionId = cluster.suggestedRegion!.id;
              const assignments = [
                ...cluster.divisions.map(d => ({ regionId, divisionId: d.id })),
                ...cluster.unsplittable.map(d => ({ regionId, divisionId: d.id })),
              ];
              try {
                await acceptBatchMatches(worldViewId, assignments);
                setCVMatchDialog(prev => prev ? {
                  ...prev,
                  clusters: prev.clusters.filter(c => c.clusterId !== cluster.clusterId),
                } : prev);
                invalidateTree(cvMatchDialog.regionId);
              } catch (err) {
                console.error('Accept batch failed:', err);
              }
            }}
          >
            Accept all ({cluster.divisions.length + cluster.unsplittable.length})
          </Button>
        )}
      </Box>
      {/* Division list */}
      <Box sx={{ pl: 1 }}>
        {cluster.divisions.map(div => (
          <Typography key={div.id} variant="body2" sx={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
            {div.name || `#${div.id}`}
            <Typography component="span" variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              {' '}({Math.round(div.confidence * 100)}%{div.depth > 0 ? `, depth ${div.depth}` : ''})
            </Typography>
          </Typography>
        ))}
        {cluster.unsplittable.map(div => (
          <Typography key={div.id} variant="body2" sx={{ fontSize: '0.8rem', lineHeight: 1.6, color: 'warning.main' }}>
            {div.name || `#${div.id}`}
            <Typography component="span" variant="body2" sx={{ fontSize: '0.75rem' }}>
              {' '}({Math.round(div.confidence * 100)}%, unsplittable)
            </Typography>
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

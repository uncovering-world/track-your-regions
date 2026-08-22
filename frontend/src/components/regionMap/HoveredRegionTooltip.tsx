/**
 * Names the region under the pointer, over the map.
 *
 * Its own component and its own subscriber to the region hover store, the same
 * shape as `HoverPreviewCard`: the hovered id changes on every mouse move, and
 * when `RegionMapVT` read it to render this inline, each move re-rendered the
 * map — every source and layer react-map-gl holds (#573). Here a move
 * re-renders one small box.
 *
 * The name resolution moved with it from `useMapInteractions`: metadata first,
 * then the loaded tiles — `metadataById` only holds the current level's
 * children, so an ancestor or sibling from a context layer is answered by
 * querying the tile features it was drawn from.
 */

import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import type { MapRef } from 'react-map-gl/maplibre';
import { useRegionHoverSelector } from '../../hooks/useRegionHover';

const REGIONS_SOURCE_LAYER = 'regions';

interface HoveredRegionTooltipProps {
  mapRef: React.RefObject<MapRef | null>;
  metadataById: Record<number, { name: string }>;
  sourceLayerName: string;
  contextLayerCount: number;
}

export function HoveredRegionTooltip({
  mapRef,
  metadataById,
  sourceLayerName,
  contextLayerCount,
}: HoveredRegionTooltipProps) {
  const hoveredRegionId = useRegionHoverSelector(id => id);

  // Get hovered region name from metadata, falling back to tile feature
  // properties (for siblings not in current-level metadata)
  const hoveredRegionName = useMemo(() => {
    if (!hoveredRegionId) return null;
    if (metadataById[hoveredRegionId]?.name) return metadataById[hoveredRegionId].name;
    // Fall back: query tile features for the name
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      // Check context sources, main source, and root overlay
      const sourceIds = [
        ...Array.from({ length: contextLayerCount }, (_, i) => `context-${i}-vt`),
        'regions-vt',
        'root-regions-vt',
      ];
      for (const sourceId of sourceIds) {
        if (!map.getSource(sourceId)) continue;
        const sourceLayer = sourceId === 'regions-vt' ? sourceLayerName : REGIONS_SOURCE_LAYER;
        // Filter by promoted feature ID to avoid scanning all loaded tile features
        const features = map.querySourceFeatures(sourceId, {
          sourceLayer,
          filter: ['==', ['id'], hoveredRegionId],
        });
        if (features.length > 0 && features[0].properties?.name) {
          return features[0].properties.name as string;
        }
      }
    }
    return null;
  }, [hoveredRegionId, metadataById, mapRef, sourceLayerName, contextLayerCount]);

  if (!hoveredRegionId || !hoveredRegionName) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(8px)',
        p: 1.5,
        px: 2,
        borderRadius: 2,
        maxWidth: 300,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
        {hoveredRegionName}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Click to explore
      </Typography>
    </Box>
  );
}

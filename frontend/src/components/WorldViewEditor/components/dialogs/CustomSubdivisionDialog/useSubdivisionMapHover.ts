/**
 * What the pointer is over on the subdivision map, and what the cursor says
 * about what a click would do there.
 *
 * The hovered division drives the tooltip; the hovered group chip and the
 * hovered "unassigned" chip drive the map's highlight, and are set from the
 * chips rather than from the map. Split out of `MapViewTab.tsx`, which had
 * reached the length the lint draws the line at (#933).
 */

import { useState, useCallback, useMemo } from 'react';
import type { RefObject } from 'react';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { SubdivisionGroup, MapTool } from './types';

function pickHoverCursor(
  activeTool: MapTool,
  featureProps: Record<string, unknown> | null | undefined,
  selectedGroupIdx: number | 'unassigned' | null,
): string {
  if (activeTool === 'split') {
    return featureProps?.hasChildren ? 'crosshair' : 'not-allowed';
  }
  if (activeTool === 'cut') return 'crosshair';
  if (activeTool === 'moveToParent') return 'pointer';
  return selectedGroupIdx !== null ? 'pointer' : 'default';
}

export function useSubdivisionMapHover({
  mapRef, activeTool, selectedGroupIdx, mapGeometries, subdivisionGroups, getDivisionGroupIdx,
}: {
  mapRef: RefObject<MapRef | null>;
  activeTool: MapTool;
  selectedGroupIdx: number | 'unassigned' | null;
  mapGeometries: GeoJSON.FeatureCollection | null;
  subdivisionGroups: SubdivisionGroup[];
  getDivisionGroupIdx: (divisionId: number, memberRowId?: number) => number | null;
}) {
  const [hoveredDivisionId, setHoveredDivisionId] = useState<number | null>(null);
  // Set from the group chips, not from the map: hovering a chip lights its
  // divisions up.
  const [hoveredGroupIdx, setHoveredGroupIdx] = useState<number | null>(null);
  const [hoveredUnassigned, setHoveredUnassigned] = useState(false);

  const handleMapMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const features = event.features;
    if (!features || features.length === 0) {
      setHoveredDivisionId(null);
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
      return;
    }

    const featureProps = features[0].properties as Record<string, unknown> | null | undefined;
    const hoveredId = (featureProps?.memberRowId ?? featureProps?.id) as number | null | undefined;
    setHoveredDivisionId(hoveredId ?? null);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = pickHoverCursor(
        activeTool,
        featureProps,
        selectedGroupIdx,
      );
    }
  }, [mapRef, activeTool, selectedGroupIdx]);

  const handleMapMouseLeave = useCallback(() => {
    setHoveredDivisionId(null);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = '';
    }
  }, [mapRef]);

  const hoveredInfo = useMemo(() => {
    if (!hoveredDivisionId || !mapGeometries) return null;

    const feature = mapGeometries.features.find(f =>
      f.properties?.memberRowId === hoveredDivisionId || f.properties?.id === hoveredDivisionId
    );
    if (!feature) return null;

    const groupIdx = getDivisionGroupIdx(feature.properties?.id, feature.properties?.memberRowId);

    return {
      name: feature.properties?.name,
      path: feature.properties?.path,
      hasChildren: feature.properties?.hasChildren,
      groupIdx,
      groupName: groupIdx !== null ? subdivisionGroups[groupIdx]?.name : null,
    };
  }, [hoveredDivisionId, mapGeometries, getDivisionGroupIdx, subdivisionGroups]);

  return {
    hoveredDivisionId,
    hoveredGroupIdx,
    setHoveredGroupIdx,
    hoveredUnassigned,
    setHoveredUnassigned,
    handleMapMouseMove,
    handleMapMouseLeave,
    hoveredInfo,
  };
}

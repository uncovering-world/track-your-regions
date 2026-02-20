import { useState, useCallback, useEffect, useMemo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import type { Region, RegionMember } from '../../../../../types';
import type { SubdivisionGroup } from './types';
import { fetchDivisionGeometry, fetchRegionMemberGeometries, fetchDescendantMemberGeometries } from '../../../../../api';
import { smartFitBounds } from '../../../../../utils/mapUtils';

interface UseGeometryLoadingParams {
  selectedRegion: Region | null;
  unassignedDivisions: RegionMember[];
  subdivisionGroups: SubdivisionGroup[];
  mapRef: React.RefObject<MapRef | null>;
}

function buildDivisionFeature(div: RegionMember, geometry: GeoJSON.Geometry): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      id: div.id,
      memberRowId: div.memberRowId,
      name: div.name,
      path: div.path,
      hasChildren: div.hasChildren,
      hasCustomGeometry: div.hasCustomGeometry ?? false,
    },
    geometry,
  };
}

export function useGeometryLoading({
  selectedRegion,
  unassignedDivisions,
  subdivisionGroups,
  mapRef,
}: UseGeometryLoadingParams) {
  const [mapGeometries, setMapGeometries] = useState<GeoJSON.FeatureCollection | null>(null);
  const [descendantGeometries, setDescendantGeometries] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadingGeometries, setLoadingGeometries] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Get all divisions (both assigned and unassigned)
  const getAllDivisions = useCallback(() => {
    return [
      ...unassignedDivisions,
      ...subdivisionGroups.flatMap(g => g.members),
    ];
  }, [unassignedDivisions, subdivisionGroups]);

  // Calculate map center from geometries (for image overlay dialog)
  const getMapCenter = useCallback((): [number, number] => {
    if (mapGeometries && mapGeometries.features.length > 0) {
      try {
        const bbox = turf.bbox(mapGeometries);
        return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
      } catch {
        return [0, 20];
      }
    }
    return [0, 20];
  }, [mapGeometries]);

  const fetchDivisionGeometryFeatures = async (divisions: RegionMember[]): Promise<GeoJSON.Feature[]> => {
    if (divisions.length === 0) return [];

    // Avoid long sequential fetches when splitting large countries (e.g. England)
    const worldViewId = selectedRegion?.worldViewId ?? 1;
    const batchSize = 12;
    const features: GeoJSON.Feature[] = [];

    for (let i = 0; i < divisions.length; i += batchSize) {
      const batch = divisions.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async div => {
        try {
          const geom = await fetchDivisionGeometry(div.id, worldViewId);
          if (!geom?.geometry) return null;
          return buildDivisionFeature(div, geom.geometry as GeoJSON.Geometry);
        } catch (e) {
          console.error(`Failed to load geometry for division ${div.id}:`, e);
          return null;
        }
      }));

      features.push(...batchResults.filter((f): f is GeoJSON.Feature => f !== null));
    }

    return features;
  };

  const loadGeometries = async () => {
    if (!selectedRegion) return;

    setLoadingGeometries(true);
    try {
      // Get all divisions from local state (includes group assignments)
      const allDivisions = getAllDivisions();

      // Fetch direct member geometries AND descendant geometries in parallel
      const [memberGeoms, descendantGeoms] = await Promise.all([
        allDivisions.length > 0
          ? fetchRegionMemberGeometries(selectedRegion.id)
          : Promise.resolve(null),
        fetchDescendantMemberGeometries(selectedRegion.id),
      ]);

      // Store descendant geometries for context layer
      setDescendantGeometries(descendantGeoms);

      if (memberGeoms && memberGeoms.features.length > 0) {
        // Create a lookup of memberRowId -> geometry from API
        const geomByMemberRowId: Record<number, GeoJSON.Geometry> = {};
        const geomByDivisionId: Record<number, GeoJSON.Geometry> = {};

        for (const f of memberGeoms.features) {
          const memberRowId = f.properties?.memberRowId;
          const divisionId = f.properties?.divisionId;
          if (memberRowId && f.geometry) {
            geomByMemberRowId[memberRowId] = f.geometry;
          }
          // Also store by divisionId as fallback (for members without memberRowId match)
          if (divisionId && f.geometry && !f.properties?.hasCustomGeom) {
            // Only use divisionId for non-custom geometries (they're unique per division)
            if (!geomByDivisionId[divisionId]) {
              geomByDivisionId[divisionId] = f.geometry;
            }
          }
        }

        // Build features from our local divisions, using API geometries
        const features: GeoJSON.Feature[] = [];
        const missingDivisions: RegionMember[] = [];

        for (const div of allDivisions) {
          // Try to find geometry by memberRowId first, then by divisionId
          let geometry: GeoJSON.Geometry | undefined;

          if (div.memberRowId && geomByMemberRowId[div.memberRowId]) {
            geometry = geomByMemberRowId[div.memberRowId];
          } else if (geomByDivisionId[div.id]) {
            geometry = geomByDivisionId[div.id];
          }

          if (geometry) {
            features.push(buildDivisionFeature(div, geometry));
          } else {
            missingDivisions.push(div);
          }
        }

        if (missingDivisions.length > 0) {
          const missingFeatures = await fetchDivisionGeometryFeatures(missingDivisions);
          features.push(...missingFeatures);
        }

        setMapGeometries({ type: 'FeatureCollection', features });
      } else {
        const features = await fetchDivisionGeometryFeatures(allDivisions);
        setMapGeometries({ type: 'FeatureCollection', features });
      }
    } catch (e) {
      console.error('Failed to load geometries:', e);
    } finally {
      setLoadingGeometries(false);
    }
  };

  // Load geometries for specific divisions (used after splitting)
  const loadGeometriesForDivisions = async (divisions: RegionMember[], parentIdToRemove?: number) => {
    const newFeatures = await fetchDivisionGeometryFeatures(divisions);

    // Remove parent geometry and add children
    setMapGeometries(prev => {
      if (!prev) return { type: 'FeatureCollection', features: newFeatures };

      // Remove the parent (which we just split)
      const filtered = parentIdToRemove
        ? prev.features.filter(f => f.properties?.id !== parentIdToRemove)
        : prev.features;

      return {
        type: 'FeatureCollection',
        features: [...filtered, ...newFeatures],
      };
    });
  };

  // Load geometries on mount
  useEffect(() => {
    if (!mapGeometries && !loadingGeometries) {
      loadGeometries();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run only on mount
  }, []);

  // Stable key derived from division IDs — only changes when the actual set of divisions changes
  const divisionKey = useMemo(() => {
    const allDivisions = getAllDivisions();
    return allDivisions.map(d => `${d.id}-${d.memberRowId ?? 'null'}`).sort().join(',');
  }, [getAllDivisions]);

  // Reload geometries when divisions change (e.g., after cuts from List View)
  useEffect(() => {
    if (!mapGeometries || loadingGeometries) return;

    const mapDivisionKeys = new Set(
      mapGeometries.features.map(f => `${f.properties?.id}-${f.properties?.memberRowId ?? 'null'}`)
    );
    const currentKeys = divisionKey.split(',').filter(Boolean);
    const currentKeySet = new Set(currentKeys);

    const hasNewDivisions = currentKeys.some(key => !mapDivisionKeys.has(key));
    const hasRemovedDivisions = mapGeometries.features.some(f => {
      const key = `${f.properties?.id}-${f.properties?.memberRowId ?? 'null'}`;
      return !currentKeySet.has(key);
    });

    if (hasNewDivisions || hasRemovedDivisions) {
      loadGeometries();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- divisionKey is the stable trigger
  }, [divisionKey]);

  // Fit map to bounds when both map is loaded and geometries are available
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const directHasFeatures = mapGeometries && mapGeometries.features.length > 0;
    const descendantHasFeatures = descendantGeometries && descendantGeometries.features.length > 0;
    if (!directHasFeatures && !descendantHasFeatures) return;

    // Merge all features for bounding box calculation
    const allFeatures = [
      ...(directHasFeatures ? mapGeometries.features : []),
      ...(descendantHasFeatures ? descendantGeometries.features : []),
    ];
    const combined: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allFeatures };

    try {
      const bbox = turf.bbox(combined) as [number, number, number, number];
      smartFitBounds(mapRef.current, bbox, { padding: 50, duration: 500, geojson: combined });
    } catch (e) {
      console.error('Failed to fit bounds:', e);
    }
  }, [mapLoaded, mapGeometries, descendantGeometries, mapRef]);

  return {
    mapGeometries,
    setMapGeometries,
    descendantGeometries,
    loadingGeometries,
    mapLoaded,
    setMapLoaded,
    getAllDivisions,
    getMapCenter,
    loadGeometriesForDivisions,
  };
}

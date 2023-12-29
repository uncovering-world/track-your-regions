import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { useNavigation } from './NavigationContext';
import { fetchRegionGeometry, fetchSiblings, fetchSubregions } from '../api';

/**
 * MapComponent initializes and displays a map using MapLibre for the currently selected region.
 *
 * It fetches the selected region's geometry and displays it on the map.
 * This function does not take any parameters.
 *
 * @return {JSX.Element} A div that contains either an error message or the map container.
 */
function MapComponent() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const { selectedRegion, selectedHierarchy } = useNavigation();
  const regionGeometryCache = useRef([]);
  const [error, setError] = useState(null);

  const getRegionGeometry = async (regionId, hierarchyId) => {
    try {
      const cacheIndex = regionGeometryCache.current.findIndex(
        (item) => item.id === regionId
          && item.hierarchyId === hierarchyId,
      );

      // Check if the geometry for the selected region is already in the cache
      if (cacheIndex !== -1) {
        return regionGeometryCache.current[cacheIndex].geometry;
      }

      if (regionId !== null && regionId !== 0) {
        const response = await fetchRegionGeometry(
          regionId,
          hierarchyId,
        );
        if (response) {
          // Add new geometry to the cache, managing the cache size
          if (regionGeometryCache.current.length >= 10) {
            regionGeometryCache.current.shift(); // Remove the oldest item
          }
          regionGeometryCache.current.push({
            id: regionId,
            hierarchyId,
            geometry: response.geometry,
          });
          return response.geometry;
        }
        return null;
      }
      return null;
    } catch (fetchError) {
      console.error('Error fetching region geometry: ', fetchError);
      setError('An error occurred while fetching region geometry.');
      return null;
    }
  };

  const fetchSelectedRegionGeometry = async () => {
    if (selectedRegion && selectedHierarchy) {
      const geometry = await getRegionGeometry(
        selectedRegion.id,
        selectedHierarchy.hierarchyId,
      );
      return geometry;
    }
    return null;
  };

  // TODO, remove eslint disable once unsed in the following commits, issue #185
  // eslint-disable-next-line no-unused-vars
  const getVisibleRegions = async () => {
    try {
      // If region has subregions, fetch the subregions
      if (selectedRegion.hasSubregions) {
        const subregions = await fetchSubregions(selectedRegion.id, selectedHierarchy.hierarchyId);
        if (subregions === null) {
          return [];
        }
        return subregions;
      }
      // If region does not have subregions, fetch the siblings
      const siblings = await fetchSiblings(selectedRegion.id, selectedHierarchy.hierarchyId);
      return siblings;
    } catch (fetchError) {
      console.error('Error fetching visible regions: ', fetchError);
      setError('An error occurred while fetching visible regions.');
      return [];
    }
  };

  const initializeMap = async () => {
    if (!mapContainer.current) return; // wait for map container to load

    const polygonData = await fetchSelectedRegionGeometry();

    if (!polygonData || !polygonData.coordinates) {
      console.log('No geometry data available for the selected region.');
      return;
    }

    const bounds = turf.bbox(polygonData);
    const mapBounds = new maplibregl.LngLatBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]);

    if (map.current) {
      // Map already exists, update the source and fit bounds
      map.current.getSource('polygon').setData({
        type: 'Feature',
        properties: {},
        geometry: polygonData,
      });
      map.current.fitBounds(mapBounds, { padding: 50 });
    } else {
      // Map does not exist, create a new instance
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://demotiles.maplibre.org/style.json',
        bounds: mapBounds,
        fitBoundsOptions: {
          padding: 50,
        },
      });

      map.current.on('load', () => {
        map.current.addSource('polygon', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: polygonData,
          },
        });

        map.current.addLayer({
          id: 'polygon',
          type: 'fill',
          source: 'polygon',
          layout: {},
          paint: {
            'fill-color': '#088',
            'fill-opacity': 0.8,
          },
        });
      });
    }
  };

  useEffect(() => {
    if (!map.current) {
      initializeMap().then((r) => console.log(r));
    }

    // Always set the cleanup function to remove the map
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [selectedRegion, selectedHierarchy]);

  return (
    <div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div ref={mapContainer} style={{ width: '100%', height: '400px' }} />
    </div>
  );
}

export default MapComponent;

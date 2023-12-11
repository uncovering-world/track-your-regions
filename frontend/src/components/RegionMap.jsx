import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { useNavigation } from './NavigationContext';
import { fetchRegionGeometry } from '../api';

/**
 * MapComponent is a React functional component that generates a map visualizing the selected region's geometry.
 * It utilizes the useNavigation context to listen for changes in the selected region or hierarchy and updates the map accordingly.
 * @returns {React.ReactElement} The map container element.
 */
/**
 * MapComponent is a React functional component that generates a map visualizing the selected region's geometry.
 * It utilizes the useNavigation context to listen for changes in the selected region or hierarchy and updates the map accordingly.
 * @returns {React.ReactElement} The map container element.
 */
function MapComponent() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const { selectedRegion, selectedHierarchy } = useNavigation();
  const regionGeometryCache = useRef([]);

  const fetchSelectedRegionGeometry = async () => {
    const cacheIndex = regionGeometryCache.current.findIndex(
      (item) => item.id === selectedRegion.id && item.hierarchyId === selectedHierarchy.hierarchyId,
    );

    // Check if the geometry for the selected region is already in the cache
    if (cacheIndex !== -1) {
      return regionGeometryCache.current[cacheIndex].geometry;
    }

    if (selectedRegion.id !== null && selectedRegion.id !== 0) {
      const response = await fetchRegionGeometry(selectedRegion.id, selectedHierarchy.hierarchyId);
      if (response) {
        // Add new geometry to the cache, managing the cache size
        if (regionGeometryCache.current.length >= 10) {
          regionGeometryCache.current.shift(); // Remove the oldest item
        }
        regionGeometryCache.current.push({
          id: selectedRegion.id,
          hierarchyId: selectedHierarchy.hierarchyId,
          geometry: response.geometry,
        });
        return response.geometry;
      }
      return null;
    }
    return null;
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

  return <div ref={mapContainer} style={{ width: '100%', height: '400px' }} />;
}

export default MapComponent;

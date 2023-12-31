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
  const [renderedFeatures, setRenderedFeatures] = useState([]);

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

  const getVisibleRegions = async () => {
    try {
      // If region has subregions, fetch the subregions
      if (selectedRegion.hasSubregions) {
        const subregions = await fetchSubregions(selectedRegion.id, selectedHierarchy.hierarchyId);
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

  const updateSelectedRegionStyle = (newSelectedRegionId) => {
    const updatedFeatures = renderedFeatures.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        isSelected: feature.properties.id === newSelectedRegionId,
      },
    }));

    const featureCollection = {
      type: 'FeatureCollection',
      features: updatedFeatures,
    };
    const bounds = turf.bbox(featureCollection);
    const mapBounds = new maplibregl.LngLatBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]);

    if (map.current.getSource('polygon')) {
      map.current.getSource('polygon').setData(featureCollection);
      map.current.fitBounds(mapBounds, { padding: 50 });
    }
  };

  const initializeMap = async () => {
    if (!mapContainer.current) return; // wait for map container to load

    const visibleRegions = await getVisibleRegions();

    const features = await Promise.all(visibleRegions.map(async (region) => {
      const geometry = await getRegionGeometry(
        region.id,
        selectedHierarchy.hierarchyId,
      );
      if (geometry && geometry.coordinates) { // Ensure geometry data is valid
        return ({
          type: 'Feature',
          properties: {
            id: region.id,
            name: region.name,
            isSelected: region.id === selectedRegion.id,
          },
          geometry,
        });
      }
      // Nothing to render, clean up the map
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      return null;
    }));

    // Filter out any null features due to failed geometry fetches
    const validFeatures = features.filter((feature) => feature !== null);

    if (validFeatures.length === 0) {
      return;
    }

    setRenderedFeatures(validFeatures);

    // Compute the bounding box for the valid features
    const featureCollection = {
      type: 'FeatureCollection',
      features: validFeatures,
    };
    const bounds = turf.bbox(featureCollection);
    const mapBounds = new maplibregl.LngLatBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]);

    if (map.current) {
      // Map already exists, update the source and fit bounds
      map.current.getSource('polygon').setData(featureCollection);
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
          data: featureCollection,
        });

        map.current.addLayer({
          id: 'polygon',
          type: 'fill',
          source: 'polygon',
          layout: {},
          paint: {
            'fill-color': ['case',
              ['==', ['get', 'isSelected'], true], '#090', // Selected region color
              '#088', // Other region color
            ],
            'fill-opacity': 0.8,
          },
        });
        // Outline Layer for the regions
        map.current.addLayer({
          id: 'region-outline',
          type: 'line',
          source: 'polygon',
          layout: {},
          paint: {
            'line-color': '#000', // Border color
            'line-width': 2, // Border width
          },
        });
      });
    }
  };

  useEffect(() => {
    if (map.current) {
      const renederedIds = renderedFeatures.map((feature) => feature.properties.id);
      if (renederedIds.includes(selectedRegion.id)) {
        updateSelectedRegionStyle(selectedRegion.id);
        return;
      }
    }
    initializeMap();
  }, [selectedRegion, selectedHierarchy]);

  return (
    <div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div ref={mapContainer} style={{ width: '100%', height: '400px' }} />
    </div>
  );
}

export default MapComponent;

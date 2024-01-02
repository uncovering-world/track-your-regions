/**
 * This file contains the MapComponent which initializes and displays
 * a map using MapLibre for the currently selected region.
 *
 * The functions within help manage map interactions such as selecting a region, fetching
 * and displaying region data, and handling visual updates.
 */
import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import Tooltip from '@mui/material/Tooltip';
import * as turf from '@turf/turf';
import { useNavigation } from './NavigationContext';
import {
  fetchRegionGeometry, fetchSiblings, fetchSubregions, fetchRootRegions, fetchRegion,
} from '../api';

/**
 * MapComponent initializes and displays a map using MapLibre for the currently selected region.
 *
 * It fetches the selected region's geometry and displays it on the map.
 * This function does not take any parameters.
 *
 * @return {JSX.Element} A div that contains either an error message or the map container.
 */
/**
 * Initializes and displays a map using MapLibre for the currently selected region.
 * It does not take any parameters and does not return any value.
 *
 * @function
 */
function MapComponent() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const { selectedRegion, selectedHierarchy, setSelectedRegion } = useNavigation();
  const regionGeometryCache = useRef([]);
  const [error, setError] = useState(null);
  const [renderedFeatures, setRenderedFeatures] = useState([]);
  const selectedRegionRef = useRef(selectedRegion);
  const [tooltipContent, setTooltipContent] = useState('');
  const [tooltipOpen, setTooltipOpen] = useState(false);

  // Function to handle region click on the map
  const handleRegionClick = (e) => {
    const features = map.current.queryRenderedFeatures(e.point, {
      layers: ['polygon'],
    });

    if (features.length > 0) {
      const clickedRegion = features[0].properties;

      if (clickedRegion.id === selectedRegionRef.current.id) {
        return;
      }

      const newRegion = fetchRegion(clickedRegion.id, selectedHierarchy.hierarchyId);

      const newSelectedRegion = {
        id: clickedRegion.id,
        name: clickedRegion.name,
        info: null, // TODO: Add info to the region object, do in a scope of Issue  #196
        hasSubregions: newRegion.hasSubregions,
      };

      setSelectedRegion(newSelectedRegion);
    }
  };

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
    if (!selectedRegion.id) {
      return fetchRootRegions(selectedHierarchy.hierarchyId);
    }
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
    const seletctedRegionFeature = updatedFeatures.find(
      (feature) => feature.properties.id === newSelectedRegionId,
    );
    let bounds;
    if (seletctedRegionFeature) {
      bounds = turf.bbox(seletctedRegionFeature);
    } else {
      bounds = turf.bbox(featureCollection);
    }
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

    const seletctedRegionFeature = validFeatures.find(
      (feature) => feature.properties.id === selectedRegion.id,
    );
    let bounds;
    if (seletctedRegionFeature) {
      bounds = turf.bbox(seletctedRegionFeature);
    } else {
      bounds = turf.bbox(featureCollection);
    }
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

      // Set up click event handler for selecting regions
      map.current.on('click', 'polygon', handleRegionClick);

      // Show a tooltip with the region name when hovering over regions
      map.current.on('mousemove', 'polygon', (e) => {
        const featuresUnder = map.current.queryRenderedFeatures(e.point, {
          layers: ['polygon'],
        });
        if (featuresUnder.length > 0) {
          const hoveredRegion = featuresUnder[0].properties;
          map.current.getCanvas().style.cursor = 'pointer';
          setTooltipContent(hoveredRegion.name);
          setTooltipOpen(true);
        } else {
          setTooltipOpen(false);
        }
      });

      map.current.on('mouseleave', 'polygon', () => {
        map.current.getCanvas().style.cursor = '';
        setTooltipOpen(false);
      });
    }
  };

  useEffect(() => {
    selectedRegionRef.current = selectedRegion;
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
      <Tooltip title={tooltipContent} open={tooltipOpen} placement="right" followCursor>
        <div ref={mapContainer} style={{ width: '100%', height: '400px' }} />
      </Tooltip>
    </div>
  );
}

export default MapComponent;

import React, {useEffect, useRef} from 'react';
import maplibregl from 'maplibre-gl';
import {useNavigation} from "./NavigationContext";
import {fetchRegionGeometry} from "../api";

const MapComponent = () => {
    const mapContainer = useRef(null);
    const map = useRef(null);
    const { selectedRegion, selectedHierarchy } = useNavigation();

    const fetchSelectedRegionGeometry = async () => {
        if (selectedRegion.id !== null && selectedRegion.id !== 0) {
            const response = await fetchRegionGeometry(selectedRegion.id, selectedHierarchy.hierarchyId);
            if (response) {
                return response.geometry;
            } else {
                return null;
            }
        }
    }

    useEffect(() => {
        if (map.current) return;

        const initializeMap = async () => {
            const polygonData = await fetchSelectedRegionGeometry();

            if (!polygonData || !polygonData.coordinates) {
                // Handle the case where there is no geometry data, perhaps set a default view?
                console.log('No geometry data available for the selected region.');
                return;
            }

            map.current = new maplibregl.Map({
                container: mapContainer.current,
                style: 'https://demotiles.maplibre.org/style.json', // specify the base map style
                center: [
                    polygonData.coordinates[0][0][0][0],
                    polygonData.coordinates[0][0][0][1]
                ], // center the map on the first coordinate of the polygon
                zoom: 9
            });

            map.current.on('load', () => {
                map.current.addSource('polygon', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: polygonData // use the geometry from the API response
                    }
                });

                map.current.addLayer({
                    id: 'polygon',
                    type: 'fill',
                    source: 'polygon',
                    layout: {},
                    paint: {
                        'fill-color': '#088', // fill color of the polygon
                        'fill-opacity': 0.8
                    }
                });
            });
        };

        initializeMap().then(r => console.log(r));

        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, [selectedRegion]);

    return <div ref={mapContainer} style={{ width: '100%', height: '400px' }} />;
};

export default MapComponent;

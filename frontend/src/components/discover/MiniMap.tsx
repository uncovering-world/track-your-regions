/**
 * MiniMap — Lightweight MapLibre GL instance for showing experience locations.
 * Supports single and multiple markers with auto-fitting bounds.
 */

import { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Marker {
  lng: number;
  lat: number;
  name?: string;
}

interface MiniMapProps {
  markers: Marker[];
  height?: number;
  interactive?: boolean;
}

export function MiniMap({ markers, height = 180, interactive = true }: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
          },
        },
        layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
      },
      center: [markers[0]?.lng || 0, markers[0]?.lat || 0],
      zoom: 4,
      interactive,
      attributionControl: false,
    });

    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // Update markers when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || markers.length === 0) return;

    // Wait for map to be ready
    const updateMarkers = () => {
      // Remove old markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // Add new markers
      for (const marker of markers) {
        const el = document.createElement('div');
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = '#ef4444';
        el.style.border = '2px solid white';
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';

        const m = new maplibregl.Marker({ element: el })
          .setLngLat([marker.lng, marker.lat]);

        if (marker.name) {
          m.setPopup(new maplibregl.Popup({ offset: 8, closeButton: false }).setText(marker.name));
        }

        m.addTo(map);
        markersRef.current.push(m);
      }

      // Fit bounds
      if (markers.length === 1) {
        map.setCenter([markers[0].lng, markers[0].lat]);
        map.setZoom(6);
      } else {
        const bounds = new maplibregl.LngLatBounds();
        for (const marker of markers) {
          bounds.extend([marker.lng, marker.lat]);
        }
        map.fitBounds(bounds, { padding: 30, maxZoom: 12 });
      }
    };

    if (map.loaded()) {
      updateMarkers();
    } else {
      map.on('load', updateMarkers);
    }
  }, [markers]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
      }}
    />
  );
}

/**
 * LocationPicker — Shared component for picking geographic coordinates.
 *
 * Four input modes:
 * 1. Map — click to place / drag marker
 * 2. Search — Nominatim place search
 * 3. Coordinates — paste multi-format coordinate string
 * 4. AI — natural language geocoding via OpenAI
 *
 * Always shows a preview map with draggable marker when coords are set.
 * Modes sync with each other: the experience name pre-populates search/AI,
 * and coordinates obtained from any mode show in the Coordinates tab.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Chip,
  TextField,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Button,
  CircularProgress,
  Alert,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { parseCoordinates, formatCoordinates } from '../../utils/coordinateParser';
import { searchPlaces, aiGeocode, type PlaceResult } from '../../api/geocode';

type Mode = 'map' | 'search' | 'coords' | 'ai';

interface LocationPickerProps {
  value: { lat: number; lng: number } | null;
  onChange: (coords: { lat: number; lng: number } | null) => void;
  /** Experience name — used to pre-populate Search and AI fields */
  name?: string;
  /** Called when a place is selected from Search or AI, with optional metadata */
  onPlaceSelect?: (place: { wikidataId?: string; displayName?: string }) => void;
}

const MODES: { key: Mode; label: string; icon: React.ReactNode }[] = [
  { key: 'map', label: 'Map', icon: <MapIcon fontSize="small" /> },
  { key: 'search', label: 'Search', icon: <SearchIcon fontSize="small" /> },
  { key: 'coords', label: 'Coordinates', icon: <EditIcon fontSize="small" /> },
  { key: 'ai', label: 'AI', icon: <AutoFixHighIcon fontSize="small" /> },
];

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
};

export function LocationPicker({ value, onChange, name, onPlaceSelect }: LocationPickerProps) {
  const [mode, setMode] = useState<Mode>('map');

  // --- Search state ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInitialized = useRef(false);

  // --- Coordinates state ---
  const [coordText, setCoordText] = useState('');
  const [coordError, setCoordError] = useState('');
  // Track whether the user is actively editing the coord field
  const coordUserEditing = useRef(false);

  // --- AI state ---
  const [aiDescription, setAiDescription] = useState('');
  const [aiResult, setAiResult] = useState<{ lat: number; lng: number; name: string; confidence: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiInitialized = useRef(false);

  // --- Map refs ---
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // --- Pre-populate Search/AI from name when switching to those modes ---
  const handleModeChange = useCallback((newMode: Mode) => {
    if (newMode === 'search' && !searchInitialized.current && name) {
      setSearchQuery(name);
      searchInitialized.current = true;
    }
    if (newMode === 'ai' && !aiInitialized.current && name) {
      setAiDescription(name);
      aiInitialized.current = true;
    }
    if (newMode === 'coords') {
      coordUserEditing.current = false;
    }
    setMode(newMode);
  }, [name]);

  // --- Sync coordText when value changes from external source ---
  useEffect(() => {
    // Don't overwrite while the user is typing in the coords field
    if (coordUserEditing.current) return;
    if (value) {
      setCoordText(formatCoordinates(value.lat, value.lng));
      setCoordError('');
    } else {
      setCoordText('');
    }
  }, [value]);

  // Update or create the map marker
  const updateMarker = useCallback((coords: { lat: number; lng: number }) => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) {
      markerRef.current.setLngLat([coords.lng, coords.lat]);
    } else {
      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = '#ef4444';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
      el.style.cursor = 'grab';

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);

      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        onChange({ lat: lngLat.lat, lng: lngLat.lng });
      });

      markerRef.current = marker;
    }
  }, [onChange]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: value ? [value.lng, value.lat] : [0, 20],
      zoom: value ? 6 : 1.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('click', (e) => {
      onChange({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    mapRef.current = map;

    // Resize after dialog animation settles (MUI Dialog has a CSS transition)
    const resizeTimer = setTimeout(() => map.resize(), 300);

    // Place initial marker if value exists
    if (value) {
      map.on('load', () => {
        updateMarker(value);
      });
    }

    return () => {
      clearTimeout(resizeTimer);
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker with value changes
  useEffect(() => {
    if (!mapRef.current) return;

    if (value) {
      const doUpdate = () => {
        updateMarker(value);
        mapRef.current?.flyTo({ center: [value.lng, value.lat], zoom: Math.max(mapRef.current.getZoom(), 4) });
      };
      if (mapRef.current.loaded()) {
        doUpdate();
      } else {
        mapRef.current.on('load', doUpdate);
      }
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [value, updateMarker]);

  // --- Search with debounce ---
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchPlaces(searchQuery, 5);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // --- Coordinate paste handler ---
  const handleCoordChange = (text: string) => {
    coordUserEditing.current = true;
    setCoordText(text);
    if (!text.trim()) {
      setCoordError('');
      return;
    }
    const parsed = parseCoordinates(text);
    if (parsed) {
      setCoordError('');
      onChange(parsed);
      // After successful parse, allow external sync again
      coordUserEditing.current = false;
    } else {
      setCoordError('Could not parse coordinates. Try "48.8566, 2.3522" or DMS format.');
    }
  };

  // --- AI geocode handler ---
  const handleAIGeocode = async () => {
    if (!aiDescription.trim()) return;
    setAiLoading(true);
    setAiError('');
    setAiResult(null);
    try {
      const result = await aiGeocode(aiDescription.trim());
      setAiResult(result);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI geocoding failed');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Mode selector chips */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {MODES.map((m) => (
          <Chip
            key={m.key}
            icon={m.icon as React.ReactElement}
            label={m.label}
            size="small"
            variant={mode === m.key ? 'filled' : 'outlined'}
            color={mode === m.key ? 'primary' : 'default'}
            onClick={() => handleModeChange(m.key)}
            sx={{ fontSize: '0.75rem' }}
          />
        ))}
      </Box>

      {/* Map — always visible, fixed height, clips marker overflow */}
      <Box
        ref={mapContainerRef}
        sx={{
          width: '100%',
          height: 200,
          borderRadius: 1,
          overflow: 'hidden',
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider',
          // Clip MapLibre markers that extend beyond the map viewport
          '& .maplibregl-canvas-container': { overflow: 'hidden' },
        }}
      />

      {/* Mode-specific input below map — stable layout */}
      {mode === 'map' && (
        <Typography variant="caption" color="text.secondary">
          Click on the map to place a marker. Drag to adjust.
        </Typography>
      )}

      {mode === 'search' && (
        <Box>
          <TextField
            placeholder="Search for a place..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            slotProps={{
              input: {
                startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
                endAdornment: searchLoading ? <CircularProgress size={16} /> : null,
              },
            }}
          />
          {searchResults.length > 0 && (
            <List dense disablePadding sx={{ maxHeight: 160, overflowY: 'auto', mt: 0.5 }}>
              {searchResults.map((place, i) => (
                <ListItemButton
                  key={i}
                  dense
                  onClick={() => {
                    onChange({ lat: place.lat, lng: place.lng });
                    setSearchResults([]);
                    setSearchQuery(place.display_name.split(',')[0]);
                    onPlaceSelect?.({ wikidataId: place.wikidataId ?? undefined, displayName: place.display_name });
                  }}
                  sx={{ py: 0.5, borderRadius: 0.5 }}
                >
                  <ListItemText
                    primary={place.display_name}
                    primaryTypographyProps={{ variant: 'caption', noWrap: true }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      )}

      {mode === 'coords' && (
        <TextField
          placeholder={'e.g. 48.8566, 2.3522 or 48°51\'24"N, 2°21\'8"E'}
          value={coordText}
          onChange={(e) => handleCoordChange(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          error={!!coordError}
          helperText={coordError || 'Paste decimal, DMS, or Google Maps URL'}
        />
      )}

      {mode === 'ai' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              placeholder="Describe the place..."
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              fullWidth
              size="small"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleAIGeocode(); }}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={handleAIGeocode}
              disabled={aiLoading || !aiDescription.trim()}
              sx={{ minWidth: 80 }}
            >
              {aiLoading ? <CircularProgress size={16} /> : 'Locate'}
            </Button>
          </Box>
          {aiError && <Alert severity="error" sx={{ py: 0 }}>{aiError}</Alert>}
          {aiResult && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ flex: 1 }}>
                {aiResult.name} ({aiResult.confidence})
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  onChange({ lat: aiResult.lat, lng: aiResult.lng });
                  onPlaceSelect?.({ displayName: aiResult.name });
                }}
              >
                Use
              </Button>
            </Box>
          )}
        </Box>
      )}

      {/* Coordinate display */}
      {value && (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          {formatCoordinates(value.lat, value.lng)}
        </Typography>
      )}
    </Box>
  );
}

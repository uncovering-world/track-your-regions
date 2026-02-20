import { useState, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import ImageIcon from '@mui/icons-material/Image';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import ColorizeIcon from '@mui/icons-material/Colorize';
import LayersIcon from '@mui/icons-material/Layers';
import VerticalSplitIcon from '@mui/icons-material/VerticalSplit';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import Map, { Source, Layer, NavigationControl, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { Region, RegionMember } from '../../../../../types';
import { MAP_STYLE } from '../../../../../constants/mapStyles';
import type { SubdivisionGroup } from './types';
import { getGroupColor } from './types';
import { ImageOverlayDialog, type ImageOverlaySettings } from './ImageOverlayDialog';
import { CutDivisionDialog } from '../CutDivisionDialog';
import { useGeometryLoading } from './useGeometryLoading';
import { useDivisionOperations } from './useDivisionOperations';
import { useImageColorPicker } from './useImageColorPicker';

interface MapViewTabProps {
  selectedRegion: Region | null;
  unassignedDivisions: RegionMember[];
  setUnassignedDivisions: React.Dispatch<React.SetStateAction<RegionMember[]>>;
  subdivisionGroups: SubdivisionGroup[];
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
  editingGroupName: string;
  setEditingGroupName: (name: string) => void;
  onSplitsApplied?: () => void;
  imageOverlaySettings: ImageOverlaySettings | null;
  setImageOverlaySettings: React.Dispatch<React.SetStateAction<ImageOverlaySettings | null>>;
  /** Region map URL for one-click overlay loading */
  regionMapUrl?: string | null;
}

export function MapViewTab({
  selectedRegion,
  unassignedDivisions,
  setUnassignedDivisions,
  subdivisionGroups,
  setSubdivisionGroups,
  editingGroupName,
  setEditingGroupName,
  onSplitsApplied,
  imageOverlaySettings,
  setImageOverlaySettings,
  regionMapUrl,
}: MapViewTabProps) {
  const mapRef = useRef<MapRef>(null);
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | 'unassigned' | null>(null);
  const [hoveredDivisionId, setHoveredDivisionId] = useState<number | null>(null);
  const [editingGroupNameInMap, setEditingGroupNameInMap] = useState<number | null>(null);
  const [newGroupNameInMap, setNewGroupNameInMap] = useState('');

  // Hover state for highlighting groups/unassigned in the map
  const [hoveredGroupIdx, setHoveredGroupIdx] = useState<number | null>(null);
  const [hoveredUnassigned, setHoveredUnassigned] = useState(false);

  // Image overlay state
  const [imageOverlayDialogOpen, setImageOverlayDialogOpen] = useState(false);
  const [imageDisplayMode, setImageDisplayMode] = useState<'overlay' | 'sideBySide'>('overlay');

  // Side-by-side image panel container ref
  const imgContainerRef = useRef<HTMLDivElement>(null);

  // --- Hooks ---
  const {
    mapGeometries,
    setMapGeometries,
    descendantGeometries,
    loadingGeometries,
    setMapLoaded,
    getAllDivisions,
    getMapCenter,
    loadGeometriesForDivisions,
  } = useGeometryLoading({ selectedRegion, unassignedDivisions, subdivisionGroups, mapRef });

  const {
    activeTool,
    setActiveTool,
    splittingDivisionId,
    cutDialogOpen,
    setCutDialogOpen,
    cuttingDivision,
    setCuttingDivision,
    cuttingDivisionGeometry,
    setCuttingDivisionGeometry,
    movingToParent,
    getDivisionGroupIdx,
    handleMapClick,
    handleCutConfirm,
    handleMoveAllUnassignedToParent,
  } = useDivisionOperations({
    selectedRegion,
    mapGeometries,
    setMapGeometries,
    subdivisionGroups,
    setSubdivisionGroups,
    unassignedDivisions,
    setUnassignedDivisions,
    onSplitsApplied,
    getAllDivisions,
    loadGeometriesForDivisions,
    selectedGroupIdx,
  });

  const {
    sideImageRef,
    eyedropperActive,
    handleSideImageClick,
    activateEyedropper,
  } = useImageColorPicker({
    imageOverlaySettings,
    selectedGroupIdx,
    subdivisionGroups,
    setSubdivisionGroups,
  });

  // Handle mouse move for hover effects
  const handleMapMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const features = event.features;
    if (features && features.length > 0) {
      const id = features[0].properties?.memberRowId || features[0].properties?.id;
      setHoveredDivisionId(id);
      if (mapRef.current) {
        // Show different cursor based on tool
        if (activeTool === 'split') {
          const hasChildren = features[0].properties?.hasChildren;
          mapRef.current.getCanvas().style.cursor = hasChildren ? 'crosshair' : 'not-allowed';
        } else if (activeTool === 'cut') {
          mapRef.current.getCanvas().style.cursor = 'crosshair';
        } else if (activeTool === 'moveToParent') {
          mapRef.current.getCanvas().style.cursor = 'pointer';
        } else {
          mapRef.current.getCanvas().style.cursor = selectedGroupIdx !== null ? 'pointer' : 'default';
        }
      }
    } else {
      setHoveredDivisionId(null);
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = '';
      }
    }
  }, [activeTool, selectedGroupIdx]);

  const handleMapMouseLeave = useCallback(() => {
    setHoveredDivisionId(null);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = '';
    }
  }, []);

  // Create a new group from the map tab
  const handleCreateGroupFromMap = useCallback(() => {
    const name = newGroupNameInMap.trim();
    if (name && !subdivisionGroups.some(g => g.name === name)) {
      setSubdivisionGroups(prev => [...prev, { name, members: [] }]);
      setNewGroupNameInMap('');
      // Auto-select the newly created group
      setSelectedGroupIdx(subdivisionGroups.length);
    }
  }, [newGroupNameInMap, subdivisionGroups, setSubdivisionGroups]);

  // Build GeoJSON with group colors for map display
  const getMapDataWithColors = useCallback((): GeoJSON.FeatureCollection => {
    if (!mapGeometries) return { type: 'FeatureCollection', features: [] };

    const features = mapGeometries.features.map(f => {
      const divId = f.properties?.id;
      const memberRowId = f.properties?.memberRowId;
      const groupIdx = getDivisionGroupIdx(divId, memberRowId);

      return {
        ...f,
        properties: {
          ...f.properties,
          groupIdx: groupIdx ?? -1, // Use -1 for unassigned to avoid null in MapLibre expressions
          groupColor: groupIdx !== null ? getGroupColor(subdivisionGroups[groupIdx], groupIdx) : '#cccccc',
          groupName: groupIdx !== null ? subdivisionGroups[groupIdx]?.name : 'Unassigned',
        },
      };
    });

    return { type: 'FeatureCollection', features };
  }, [mapGeometries, getDivisionGroupIdx, subdivisionGroups]);

  // Build GeoJSON with group colors for descendant context layer
  const getDescendantDataWithColors = useCallback((): GeoJSON.FeatureCollection => {
    if (!descendantGeometries) return { type: 'FeatureCollection', features: [] };

    // Build lookup: existingRegionId -> groupIdx
    const regionIdToGroupIdx: Record<number, number> = {};
    for (let i = 0; i < subdivisionGroups.length; i++) {
      const rid = subdivisionGroups[i].existingRegionId;
      if (rid != null) regionIdToGroupIdx[rid] = i;
    }

    const features = descendantGeometries.features.map(f => {
      const rootAncestorId = f.properties?.rootAncestorId as number | undefined;
      const groupIdx = rootAncestorId != null ? (regionIdToGroupIdx[rootAncestorId] ?? -1) : -1;

      return {
        ...f,
        properties: {
          ...f.properties,
          groupIdx,
          groupColor: groupIdx >= 0 ? getGroupColor(subdivisionGroups[groupIdx], groupIdx) : '#9e9e9e',
        },
      };
    });

    return { type: 'FeatureCollection', features };
  }, [descendantGeometries, subdivisionGroups]);

  // Get hovered feature info
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 550 }}>
      {/* Controls bar */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Tool selector */}
        <ToggleButtonGroup
          value={activeTool}
          exclusive
          onChange={(_, value) => value && setActiveTool(value)}
          size="small"
        >
          <ToggleButton value="assign">
            <Tooltip title="Assign tool: Click regions to assign to selected group">
              <TouchAppIcon fontSize="small" />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="split">
            <Tooltip title="Split tool: Click regions to split into children (uses GADM subdivisions)">
              <CallSplitIcon fontSize="small" />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="cut">
            <Tooltip title="Cut tool: Draw polygon to cut a piece from a region (custom geometry)">
              <ContentCutIcon fontSize="small" />
            </Tooltip>
          </ToggleButton>
          {selectedRegion?.parentRegionId && (
            <ToggleButton value="moveToParent">
              <Tooltip title="Move to parent: Click regions to move them to the parent region">
                <VerticalAlignTopIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          )}
        </ToggleButtonGroup>

        {/* Group selector (only relevant for assign tool) */}
        {activeTool === 'assign' && (
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Select group to assign</InputLabel>
            <Select
              value={selectedGroupIdx ?? ''}
              label="Select group to assign"
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') setSelectedGroupIdx(null);
                else if (val === 'unassigned') setSelectedGroupIdx('unassigned');
                else setSelectedGroupIdx(Number(val));
              }}
            >
              <MenuItem value="">
                <em>— Click to view only —</em>
              </MenuItem>
              <MenuItem value="unassigned">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      backgroundColor: '#999',
                      border: '2px dashed #666',
                    }}
                  />
                  📥 Unassigned ({unassignedDivisions.length})
                </Box>
              </MenuItem>
              {subdivisionGroups.map((group, idx) => (
                <MenuItem key={idx} value={idx}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: getGroupColor(group, idx),
                      }}
                    />
                    {group.name} ({group.members.length})
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {/* Create new group */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="New group name"
            value={newGroupNameInMap}
            onChange={(e) => setNewGroupNameInMap(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCreateGroupFromMap();
              }
            }}
            sx={{ width: 180 }}
          />
          <Tooltip title="Add new group">
            <span>
              <IconButton
                size="small"
                onClick={handleCreateGroupFromMap}
                disabled={!newGroupNameInMap.trim() || subdivisionGroups.some(g => g.name === newGroupNameInMap.trim())}
                color="primary"
              >
                <AddIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {/* Region link + Image overlay button + display mode toggle */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {selectedRegion?.sourceUrl && (
            <Tooltip title="Open source page">
              <IconButton
                size="small"
                component="a"
                href={selectedRegion.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title={
            imageOverlaySettings
              ? "Edit reference image overlay"
              : regionMapUrl
                ? "Load region map overlay"
                : "Add reference image overlay"
          }>
            <IconButton
              size="small"
              onClick={() => setImageOverlayDialogOpen(true)}
              color={imageOverlaySettings ? "primary" : regionMapUrl ? "secondary" : "default"}
            >
              <ImageIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {imageOverlaySettings && (
            <ToggleButtonGroup
              value={imageDisplayMode}
              exclusive
              onChange={(_, value) => {
                if (value) setImageDisplayMode(value);
              }}
              size="small"
              sx={{ height: 28 }}
            >
              <ToggleButton value="overlay" sx={{ px: 0.75, py: 0.25 }}>
                <Tooltip title="Image as map overlay">
                  <LayersIcon sx={{ fontSize: 16 }} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="sideBySide" sx={{ px: 0.75, py: 0.25 }}>
                <Tooltip title="Image side by side with map">
                  <VerticalSplitIcon sx={{ fontSize: 16 }} />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          {/* Eyedropper — pick color from side-by-side image for the selected group */}
          {imageOverlaySettings && imageDisplayMode === 'sideBySide' && (
            <Tooltip title={
              typeof selectedGroupIdx !== 'number'
                ? 'Select a group first, then pick color'
                : eyedropperActive
                  ? 'Click on the image to pick color (Esc to cancel)'
                  : `Pick color for "${subdivisionGroups[selectedGroupIdx]?.name}" from image`
            }>
              <span>
                <IconButton
                  size="small"
                  color={eyedropperActive ? 'primary' : 'default'}
                  onClick={activateEyedropper}
                  disabled={typeof selectedGroupIdx !== 'number'}
                >
                  <ColorizeIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>

        {/* Instructions */}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {activeTool === 'moveToParent'
            ? 'Click divisions to move them to the parent region'
            : activeTool === 'split'
              ? 'Click regions with children to split them'
              : activeTool === 'cut'
                ? 'Click a region to draw a polygon to cut pieces from it'
                : selectedGroupIdx === 'unassigned'
                  ? 'Click regions to move them to Unassigned'
                  : selectedGroupIdx !== null
                    ? `Click regions to assign to "${subdivisionGroups[selectedGroupIdx]?.name}"`
                    : 'Select a group first, then click regions to assign'}
        </Typography>
      </Box>

      {/* Group chips for quick selection and management */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {subdivisionGroups.map((group, idx) => {
          const color = getGroupColor(group, idx);
          return (
            <Chip
              key={idx}
              label={
                editingGroupNameInMap === idx ? (
                  <TextField
                    size="small"
                    value={editingGroupName}
                    onChange={(e) => setEditingGroupName(e.target.value)}
                    onBlur={() => {
                      if (editingGroupName.trim()) {
                        setSubdivisionGroups(prev => prev.map((g, i) =>
                          i === idx ? { ...g, name: editingGroupName.trim() } : g
                        ));
                      }
                      setEditingGroupNameInMap(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingGroupName.trim()) {
                          setSubdivisionGroups(prev => prev.map((g, i) =>
                            i === idx ? { ...g, name: editingGroupName.trim() } : g
                          ));
                        }
                        setEditingGroupNameInMap(null);
                      } else if (e.key === 'Escape') {
                        setEditingGroupNameInMap(null);
                      }
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    sx={{ width: 100 }}
                    inputProps={{ style: { fontSize: '0.8rem', padding: '2px 4px' } }}
                  />
                ) : (
                  `${group.name} (${group.members.length})`
                )
              }
              onClick={() => {
                setSelectedGroupIdx(idx);
                setActiveTool('assign');
              }}
              onMouseEnter={() => setHoveredGroupIdx(idx)}
              onMouseLeave={() => setHoveredGroupIdx(null)}
              onDoubleClick={() => {
                setEditingGroupNameInMap(idx);
                setEditingGroupName(group.name);
              }}
              onDelete={() => {
                // Return members to unassigned
                setUnassignedDivisions(prev => [...prev, ...group.members]);
                setSubdivisionGroups(prev => prev.filter((_, i) => i !== idx));
                if (selectedGroupIdx === idx) setSelectedGroupIdx(null);
              }}
              sx={{
                backgroundColor: selectedGroupIdx === idx ? color : `${color}40`,
                color: selectedGroupIdx === idx ? '#fff' : 'inherit',
                borderWidth: 2,
                borderStyle: 'solid',
                borderColor: color,
                '&:hover': {
                  backgroundColor: `${color}80`,
                },
              }}
            />
          );
        })}
        <Chip
          label={`Unassigned (${unassignedDivisions.length})`}
          variant="outlined"
          onMouseEnter={() => setHoveredUnassigned(true)}
          onMouseLeave={() => setHoveredUnassigned(false)}
          sx={{
            borderStyle: 'dashed',
            cursor: 'pointer',
            backgroundColor: hoveredUnassigned ? 'rgba(128, 128, 128, 0.2)' : 'transparent',
          }}
        />
        {selectedRegion?.parentRegionId && unassignedDivisions.length > 0 && (
          <Tooltip title="Move all unassigned divisions to parent region">
            <span>
              <Chip
                icon={movingToParent ? <CircularProgress size={14} /> : <VerticalAlignTopIcon sx={{ fontSize: '16px !important' }} />}
                label={movingToParent ? 'Moving...' : 'All to parent'}
                variant="outlined"
                onClick={handleMoveAllUnassignedToParent}
                disabled={movingToParent}
                size="small"
                sx={{
                  cursor: 'pointer',
                  borderColor: 'warning.main',
                  color: 'warning.dark',
                  '&:hover': { backgroundColor: 'rgba(237, 108, 2, 0.08)' },
                }}
              />
            </span>
          </Tooltip>
        )}
      </Box>

      {/* Map + optional side-by-side image */}
      <Box sx={{ display: 'flex', gap: 1, flex: 1, overflow: 'hidden' }}>
        <Paper variant="outlined" sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {loadingGeometries ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <CircularProgress />
              <Typography sx={{ ml: 2 }}>Loading geometries...</Typography>
            </Box>
          ) : (
            <Map
              ref={mapRef}
              initialViewState={{
                longitude: 0,
                latitude: 20,
                zoom: 2,
              }}
              style={{ width: '100%', height: '100%' }}
              mapStyle={MAP_STYLE}
              onLoad={() => setMapLoaded(true)}
              onClick={handleMapClick}
              onMouseMove={handleMapMouseMove}
              onMouseLeave={handleMapMouseLeave}
              interactiveLayerIds={['divisions-fill']}
            >
              <NavigationControl position="top-right" showCompass={false} />

              {/* Reference image overlay (only in overlay mode) */}
              {imageOverlaySettings && imageDisplayMode === 'overlay' && (
                <Source
                  id="image-overlay"
                  type="image"
                  url={imageOverlaySettings.imageUrl}
                  coordinates={imageOverlaySettings.coordinates}
                >
                  <Layer
                    id="image-overlay-layer"
                    type="raster"
                    paint={{
                      'raster-opacity': imageOverlaySettings.opacity,
                      'raster-fade-duration': 0,
                    }}
                  />
                </Source>
              )}

              {/* Descendant context layer (read-only, colored by group, highlighted on hover) */}
              {descendantGeometries && descendantGeometries.features.length > 0 && (
                <Source id="descendant-context" type="geojson" data={getDescendantDataWithColors()}>
                  <Layer
                    id="descendant-context-fill"
                    type="fill"
                    paint={{
                      'fill-color': ['get', 'groupColor'],
                      'fill-opacity': [
                        'case',
                        // Highlight when group chip is hovered
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        0.35,
                        // Default: subtle
                        0.15,
                      ],
                    }}
                  />
                  <Layer
                    id="descendant-context-outline"
                    type="line"
                    paint={{
                      'line-color': [
                        'case',
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        ['get', 'groupColor'],
                        '#9e9e9e',
                      ],
                      'line-width': [
                        'case',
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        2,
                        1,
                      ],
                      'line-dasharray': [3, 2],
                      'line-opacity': [
                        'case',
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        0.8,
                        0.5,
                      ],
                    }}
                  />
                </Source>
              )}

              <Source id="divisions" type="geojson" data={getMapDataWithColors()}>
                <Layer
                  id="divisions-fill"
                  type="fill"
                  paint={{
                    'fill-color': ['get', 'groupColor'],
                    'fill-opacity': [
                      'case',
                      // Highlight when directly hovered
                      ['==', ['get', 'id'], hoveredDivisionId ?? -1],
                      0.8,
                      // Highlight when group chip is hovered
                      ['all',
                        ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                        ['!=', hoveredGroupIdx ?? -999, -999]
                      ],
                      0.75,
                      // Highlight unassigned when unassigned chip is hovered (groupIdx === -1)
                      ['all',
                        ['==', hoveredUnassigned, true],
                        ['==', ['get', 'groupIdx'], -1]
                      ],
                      0.75,
                      // Default opacity
                      0.4,
                    ],
                  }}
                />
                <Layer
                  id="divisions-outline"
                  type="line"
                  paint={{
                    'line-color': [
                      'case',
                      // Thicker outline when group is hovered
                      ['all',
                        ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                        ['!=', hoveredGroupIdx ?? -999, -999]
                      ],
                      '#000000',
                      // Thicker outline when unassigned is hovered (groupIdx === -1)
                      ['all',
                        ['==', hoveredUnassigned, true],
                        ['==', ['get', 'groupIdx'], -1]
                      ],
                      '#000000',
                      '#333333',
                    ],
                    'line-width': [
                      'case',
                      ['==', ['get', 'id'], hoveredDivisionId ?? -1],
                      4,
                      // Thicker when group is hovered
                      ['all',
                        ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                        ['!=', hoveredGroupIdx ?? -999, -999]
                      ],
                      3,
                      // Thicker when unassigned is hovered (groupIdx === -1)
                      ['all',
                        ['==', hoveredUnassigned, true],
                        ['==', ['get', 'groupIdx'], -1]
                      ],
                      3,
                      2,
                    ],
                    'line-opacity': 0.8,
                  }}
                />
              </Source>
            </Map>
          )}

          {/* Splitting indicator */}
          {splittingDivisionId && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 20,
                backgroundColor: 'rgba(255,255,255,0.9)',
                p: 2,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <CircularProgress size={20} />
              <Typography>Splitting...</Typography>
            </Box>
          )}

          {/* Hover info tooltip */}
          {hoveredInfo && (
            <Paper
              sx={{
                position: 'absolute',
                bottom: 10,
                left: 10,
                p: 1.5,
                maxWidth: 300,
                zIndex: 10,
              }}
            >
              <Typography variant="subtitle2">{hoveredInfo.name}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {hoveredInfo.path || 'No path'}
              </Typography>
              <Typography variant="caption" color={hoveredInfo.groupIdx !== null ? 'primary' : 'text.secondary'}>
                {hoveredInfo.groupName ? `Group: ${hoveredInfo.groupName}` : 'Unassigned'}
              </Typography>
              {activeTool === 'split' && (
                <Typography variant="caption" color={hoveredInfo.hasChildren ? 'success.main' : 'text.disabled'} sx={{ display: 'block', mt: 0.5 }}>
                  {hoveredInfo.hasChildren ? '✓ Click to split' : '✗ No children to split'}
                </Typography>
              )}
              {activeTool === 'cut' && (
                <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5 }}>
                  ✂ Click to cut pieces from this region
                </Typography>
              )}
              {activeTool === 'moveToParent' && (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                  Click to move to parent region
                </Typography>
              )}
            </Paper>
          )}
        </Paper>

        {/* Side-by-side image panel */}
        {imageOverlaySettings && imageDisplayMode === 'sideBySide' && (
          <Paper
            ref={imgContainerRef}
            variant="outlined"
            sx={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: '#f5f5f5',
              cursor: eyedropperActive ? 'crosshair' : 'default',
            }}
          >
            <img
              ref={sideImageRef}
              src={imageOverlaySettings.imageUrl}
              onClick={handleSideImageClick}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                cursor: eyedropperActive ? 'crosshair' : 'default',
              }}
            />
          </Paper>
        )}
      </Box>

      {/* Image Overlay Dialog */}
      <ImageOverlayDialog
        open={imageOverlayDialogOpen}
        onClose={() => setImageOverlayDialogOpen(false)}
        onApply={(settings) => setImageOverlaySettings(settings)}
        initialCenter={getMapCenter()}
        initialZoom={4}
        existingSettings={imageOverlaySettings}
        regionGeometries={mapGeometries}
        regionMapUrl={regionMapUrl}
      />

      {/* Cut Division Dialog */}
      <CutDivisionDialog
        open={cutDialogOpen}
        onClose={() => {
          setCutDialogOpen(false);
          setCuttingDivision(null);
          setCuttingDivisionGeometry(null);
        }}
        onConfirm={handleCutConfirm}
        divisionGeometry={cuttingDivisionGeometry}
        divisionName={cuttingDivision?.name ?? ''}
        imageOverlaySettings={imageOverlaySettings}
      />
    </Box>
  );
}

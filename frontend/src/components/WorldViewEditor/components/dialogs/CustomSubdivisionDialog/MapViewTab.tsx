import { useState, useCallback, useRef } from 'react';
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
import { NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import { GuardedMap as Map } from '../../../../shared/GuardedMap';
import type { Region } from '../../../../../types';
import type { RegionMember } from '../../../../../api/regions';
import { MAP_STYLE } from '../../../../../constants/mapStyles';
import type { SubdivisionGroup } from './types';
import { getGroupColor } from './types';
import { mapDataWithColors, descendantDataWithColors } from './subdivisionMapColors';
import { ImageOverlayDialog, type ImageOverlaySettings } from './ImageOverlayDialog';
import { CutDivisionDialog } from '../CutDivisionDialog';
import { extractImageUrl } from '../../../../../utils/imageUrl';
import { safeHref } from '../../../../../utils/safeHref';
import { useGeometryLoading } from './useGeometryLoading';

function renameGroupAtIndex(groups: SubdivisionGroup[], idx: number, name: string): SubdivisionGroup[] {
  return groups.map((g, i) => i === idx ? { ...g, name } : g);
}

function removeGroupAtIndex(groups: SubdivisionGroup[], idx: number): SubdivisionGroup[] {
  return groups.filter((_, i) => i !== idx);
}

import { useDivisionOperations } from './useDivisionOperations';
import { useSubdivisionMapHover } from './useSubdivisionMapHover';
import { SubdivisionMapLayers } from './SubdivisionMapLayers';
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
  // The stored map is wiki content, and the overlay wants it at full size, so it
  // is judged rather than sized: extractImageUrl answers with the url itself or
  // with nothing (#694). What the button promises is what the dialog can load.
  const regionMapSrc = regionMapUrl ? extractImageUrl(regionMapUrl) : null;
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | 'unassigned' | null>(null);
  const [editingGroupNameInMap, setEditingGroupNameInMap] = useState<number | null>(null);
  const [newGroupNameInMap, setNewGroupNameInMap] = useState('');

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

  // What the pointer is over, and what the cursor says a click would do.
  const {
    hoveredDivisionId, hoveredGroupIdx, setHoveredGroupIdx, hoveredUnassigned, setHoveredUnassigned,
    handleMapMouseMove, handleMapMouseLeave, hoveredInfo,
  } = useSubdivisionMapHover({
    mapRef, activeTool, selectedGroupIdx, mapGeometries, subdivisionGroups, getDivisionGroupIdx,
  });

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

  const getMapDataWithColors = useCallback(
    () => mapDataWithColors(mapGeometries, getDivisionGroupIdx, subdivisionGroups),
    [mapGeometries, getDivisionGroupIdx, subdivisionGroups],
  );

  const getDescendantDataWithColors = useCallback(
    () => descendantDataWithColors(descendantGeometries, subdivisionGroups),
    [descendantGeometries, subdivisionGroups],
  );

  // The stored source page, offered only where it is a page a reader may be
  // sent to (#703): the value is what an import tree posted, and a
  // `javascript:` href runs on click. Refused, the button is not shown.
  const sourceHref = safeHref(selectedRegion?.sourceUrl);

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
          {sourceHref && (
            <Tooltip title="Open source page">
              <IconButton
                size="small"
                component="a"
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {(() => {
            let overlayTooltip = "Add reference image overlay";
            if (imageOverlaySettings) overlayTooltip = "Edit reference image overlay";
            else if (regionMapSrc) overlayTooltip = "Load region map overlay";

            let overlayColor: 'primary' | 'secondary' | 'default' = 'default';
            if (imageOverlaySettings) overlayColor = 'primary';
            else if (regionMapSrc) overlayColor = 'secondary';
            return (
              <Tooltip title={overlayTooltip}>
                <IconButton
                  size="small"
                  onClick={() => setImageOverlayDialogOpen(true)}
                  color={overlayColor}
                >
                  <ImageIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            );
          })()}
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
          {imageOverlaySettings && imageDisplayMode === 'sideBySide' && (() => {
            let eyedropperTooltip: string;
            if (typeof selectedGroupIdx !== 'number') {
              eyedropperTooltip = 'Select a group first, then pick color';
            } else if (eyedropperActive) {
              eyedropperTooltip = 'Click on the image to pick color (Esc to cancel)';
            } else {
              eyedropperTooltip = `Pick color for "${subdivisionGroups[selectedGroupIdx]?.name}" from image`;
            }
            return (
            <Tooltip title={eyedropperTooltip}>
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
            );
          })()}
        </Box>

        {/* Instructions */}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {(() => {
            if (activeTool === 'moveToParent') return 'Click divisions to move them to the parent region';
            if (activeTool === 'split') return 'Click regions with children to split them';
            if (activeTool === 'cut') return 'Click a region to draw a polygon to cut pieces from it';
            if (selectedGroupIdx === 'unassigned') return 'Click regions to move them to Unassigned';
            if (selectedGroupIdx !== null) return `Click regions to assign to "${subdivisionGroups[selectedGroupIdx]?.name}"`;
            return 'Select a group first, then click regions to assign';
          })()}
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
                        setSubdivisionGroups(prev => renameGroupAtIndex(prev, idx, editingGroupName.trim()));
                      }
                      setEditingGroupNameInMap(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingGroupName.trim()) {
                          setSubdivisionGroups(prev => renameGroupAtIndex(prev, idx, editingGroupName.trim()));
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
                setSubdivisionGroups(prev => removeGroupAtIndex(prev, idx));
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

              <SubdivisionMapLayers
                imageOverlaySettings={imageOverlaySettings}
                imageDisplayMode={imageDisplayMode}
                descendantGeometries={descendantGeometries}
                getDescendantDataWithColors={getDescendantDataWithColors}
                getMapDataWithColors={getMapDataWithColors}
                hoveredGroupIdx={hoveredGroupIdx}
                hoveredUnassigned={hoveredUnassigned}
                hoveredDivisionId={hoveredDivisionId}
              />
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
        regionMapUrl={regionMapSrc}
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

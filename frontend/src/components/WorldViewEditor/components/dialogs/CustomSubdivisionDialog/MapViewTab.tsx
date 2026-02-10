import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
import Map, { Source, Layer, NavigationControl, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import type { Region, RegionMember } from '../../../../../types';
import { getMemberKey } from '../../../types';
import { MAP_STYLE } from '../../../../../constants/mapStyles';
import { fetchDivisionGeometry, fetchSubdivisions, removeDivisionsFromRegion, addDivisionsToRegion, fetchRegionMemberGeometries } from '../../../../../api';
import { smartFitBounds } from '../../../../../utils/mapUtils';
import type { SubdivisionGroup, MapTool } from './types';
import { GROUP_COLORS } from './types';
import { ImageOverlayDialog, type ImageOverlaySettings } from './ImageOverlayDialog';
import { CutDivisionDialog, type CutPart } from '../CutDivisionDialog';

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
}: MapViewTabProps) {
  const mapRef = useRef<MapRef>(null);
  const [mapGeometries, setMapGeometries] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadingGeometries, setLoadingGeometries] = useState(false);
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | 'unassigned' | null>(null);
  const [hoveredDivisionId, setHoveredDivisionId] = useState<number | null>(null);
  const [splittingDivisionId, setSplittingDivisionId] = useState<number | null>(null);
  const [editingGroupNameInMap, setEditingGroupNameInMap] = useState<number | null>(null);
  const [newGroupNameInMap, setNewGroupNameInMap] = useState('');
  const [activeTool, setActiveTool] = useState<MapTool>('assign');

  // Hover state for highlighting groups/unassigned in the map
  const [hoveredGroupIdx, setHoveredGroupIdx] = useState<number | null>(null);
  const [hoveredUnassigned, setHoveredUnassigned] = useState(false);

  // Cut division dialog state
  const [cutDialogOpen, setCutDialogOpen] = useState(false);
  const [cuttingDivision, setCuttingDivision] = useState<RegionMember | null>(null);
  const [cuttingDivisionGeometry, setCuttingDivisionGeometry] = useState<GeoJSON.FeatureCollection | null>(null);

  // Image overlay state
  const [imageOverlayDialogOpen, setImageOverlayDialogOpen] = useState(false);

  // Track when map is loaded
  const [mapLoaded, setMapLoaded] = useState(false);

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

  // Get all divisions (both assigned and unassigned)
  const getAllDivisions = useCallback(() => {
    return [
      ...unassignedDivisions,
      ...subdivisionGroups.flatMap(g => g.members),
    ];
  }, [unassignedDivisions, subdivisionGroups]);

  // Find which group a division belongs to (null if unassigned)
  const getDivisionGroupIdx = useCallback((divId: number, memberRowId?: number) => {
    for (let i = 0; i < subdivisionGroups.length; i++) {
      if (subdivisionGroups[i].members.some(m =>
        memberRowId ? m.memberRowId === memberRowId : m.id === divId
      )) {
        return i;
      }
    }
    return null;
  }, [subdivisionGroups]);

  const buildDivisionFeature = (div: RegionMember, geometry: GeoJSON.Geometry): GeoJSON.Feature => ({
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
  });

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
    if (mapLoaded && mapGeometries && mapGeometries.features.length > 0 && mapRef.current) {
      try {
        const bbox = turf.bbox(mapGeometries) as [number, number, number, number];
        smartFitBounds(mapRef.current, bbox, { padding: 50, duration: 500, geojson: mapGeometries });
      } catch (e) {
        console.error('Failed to fit bounds:', e);
      }
    }
  }, [mapLoaded, mapGeometries]);

  const loadGeometries = async () => {
    if (!selectedRegion) return;

    setLoadingGeometries(true);
    try {
      // Get all divisions from local state (includes group assignments)
      const allDivisions = getAllDivisions();

      // Fetch all member geometries from the API - this includes custom_geom if available
      const memberGeoms = await fetchRegionMemberGeometries(selectedRegion.id);

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

  // Handle clicking on a division in the map
  const handleMapClick = useCallback(async (event: MapLayerMouseEvent) => {
    const features = event.features;
    if (!features || features.length === 0) return;

    const clickedFeature = features[0];
    const divId = clickedFeature.properties?.id;
    const memberRowId = clickedFeature.properties?.memberRowId;
    if (!divId) return;

    // Find the division in our data
    const allDivisions = getAllDivisions();
    const div = allDivisions.find(d =>
      memberRowId ? d.memberRowId === memberRowId : d.id === divId
    );
    if (!div) return;

    // Handle based on active tool
    if (activeTool === 'split') {
      // Split tool: split the division into its children
      if (div.hasChildren) {
        await handleSplitDivision(div);
      }
    } else if (activeTool === 'cut') {
      // Cut tool: open the cut dialog to draw polygon to cut a piece
      setCuttingDivision(div);
      try {
        let geometry: GeoJSON.Geometry | null = null;

        // If division has custom geometry, use it from mapGeometries (already loaded with custom geom)
        if (div.hasCustomGeometry && div.memberRowId && mapGeometries) {
          const feature = mapGeometries.features.find(
            f => f.properties?.memberRowId === div.memberRowId
          );
          if (feature?.geometry) {
            geometry = feature.geometry;
          }
        }

        // Fallback to original GADM geometry
        if (!geometry) {
          const geom = await fetchDivisionGeometry(div.id, selectedRegion?.worldViewId ?? 1);
          if (geom?.geometry) {
            geometry = geom.geometry as GeoJSON.Geometry;
          }
        }

        if (geometry) {
          setCuttingDivisionGeometry({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: { id: div.id, name: div.name, memberRowId: div.memberRowId },
              geometry,
            }],
          });
          setCutDialogOpen(true);
        }
      } catch (e) {
        console.error('Failed to load division geometry for cutting:', e);
      }
    } else {
      // Assign tool: assign to selected group or unassigned
      if (selectedGroupIdx !== null) {
        const memberKey = getMemberKey(div);
        const currentGroupIdx = getDivisionGroupIdx(divId, memberRowId);

        // Check if already in the target location
        if (selectedGroupIdx === 'unassigned') {
          // Moving to unassigned
          if (currentGroupIdx === null) return; // Already unassigned

          // Remove from current group
          setSubdivisionGroups(prev => prev.map((g, i) =>
            i === currentGroupIdx
              ? { ...g, members: g.members.filter(m => getMemberKey(m) !== memberKey) }
              : g
          ));

          // Add to unassigned
          setUnassignedDivisions(prev => [...prev, div]);
        } else {
          // Moving to a group
          if (currentGroupIdx === selectedGroupIdx) return; // Already in this group

          // Remove from current location
          if (currentGroupIdx !== null) {
            setSubdivisionGroups(prev => prev.map((g, i) =>
              i === currentGroupIdx
                ? { ...g, members: g.members.filter(m => getMemberKey(m) !== memberKey) }
                : g
            ));
          } else {
            setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
          }

          // Add to selected group
          setSubdivisionGroups(prev => prev.map((g, i) =>
            i === selectedGroupIdx
              ? { ...g, members: [...g.members, div] }
              : g
          ));
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSplitDivision excluded to avoid re-creating on every render
  }, [activeTool, selectedGroupIdx, getAllDivisions, getDivisionGroupIdx, setSubdivisionGroups, setUnassignedDivisions]);

  // Handle splitting a division into its children
  const handleSplitDivision = async (div: RegionMember) => {
    if (!div.hasChildren || !selectedRegion) return;

    setSplittingDivisionId(div.id);
    try {
      // Fetch all direct children in pages to avoid truncating large parent divisions
      const pageSize = 1000;
      let offset = 0;
      const children: Awaited<ReturnType<typeof fetchSubdivisions>> = [];
      while (true) {
        const page = await fetchSubdivisions(div.id, selectedRegion.worldViewId, {
          limit: pageSize,
          offset,
        });
        children.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      if (children.length === 0) {
        console.log('No children found for division:', div.name);
        return;
      }

      // Apply split to backend immediately (same as cut)
      // Remove the parent division from the region
      await removeDivisionsFromRegion(selectedRegion.id, [div.id]);

      // Add the child divisions to the region
      await addDivisionsToRegion(selectedRegion.id, children.map(c => c.id), {
        createAsSubregions: false,
      });

      const memberKey = getMemberKey(div);
      const currentGroupIdx = getDivisionGroupIdx(div.id, div.memberRowId);

      // Remove the parent division from local state
      if (currentGroupIdx !== null) {
        setSubdivisionGroups(prev => prev.map((g, i) =>
          i === currentGroupIdx
            ? { ...g, members: g.members.filter(m => getMemberKey(m) !== memberKey) }
            : g
        ));
      } else {
        setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
      }

      // Add children as unassigned divisions
      const childMembers: RegionMember[] = children.map(child => ({
        id: child.id,
        name: child.name,
        parentId: div.id,
        hasChildren: child.hasChildren,
        memberType: 'division' as const,
        isSubregion: false,
        path: div.path ? `${div.path} > ${child.name}` : child.name,
      }));

      setUnassignedDivisions(prev => [...prev, ...childMembers]);

      // Reload geometries to include new children
      await loadGeometriesForDivisions(childMembers, div.id);

      // Notify parent that changes were made
      onSplitsApplied?.();

    } catch (e) {
      console.error('Failed to split division:', e);
      alert('Failed to split division');
    } finally {
      setSplittingDivisionId(null);
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

  // Handle cut dialog confirmation - save cut parts as members with custom geometry
  const handleCutConfirm = useCallback(async (cutParts: CutPart[]) => {
    if (!selectedRegion || !cuttingDivision || cutParts.length === 0) {
      setCutDialogOpen(false);
      setCuttingDivision(null);
      setCuttingDivisionGeometry(null);
      return;
    }

    try {
      // Remove the original division from the region
      await removeDivisionsFromRegion(selectedRegion.id, [cuttingDivision.id]);

      // Add each cut part as a member with custom geometry
      for (const part of cutParts) {
        await addDivisionsToRegion(selectedRegion.id, [cuttingDivision.id], {
          customGeometry: part.geometry,
          customName: part.name,
        });
      }

      // Remove original from local state
      const memberKey = getMemberKey(cuttingDivision);
      const currentGroupIdx = getDivisionGroupIdx(cuttingDivision.id, cuttingDivision.memberRowId);

      if (currentGroupIdx !== null) {
        setSubdivisionGroups(prev => prev.map((g, i) =>
          i === currentGroupIdx
            ? { ...g, members: g.members.filter(m => getMemberKey(m) !== memberKey) }
            : g
        ));
      } else {
        setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
      }

      // Add cut parts to unassigned (they'll be re-fetched with new memberRowIds later)
      // For now, add them locally with temporary negative IDs (small numbers to avoid DB overflow)
      // These will be replaced with real memberRowIds when data is refetched
      const tempIdBase = -(Math.floor(Math.random() * 1000000) + 1);
      const newMembers: RegionMember[] = cutParts.map((part, idx) => ({
        id: cuttingDivision.id,
        name: part.name,
        parentId: cuttingDivision.parentId,
        hasChildren: false, // Custom geometry parts don't have children
        memberType: 'division' as const,
        isSubregion: false,
        hasCustomGeometry: true,
        path: cuttingDivision.path,
        // Temporary memberRowId - will be corrected on next load
        // Using small negative numbers to avoid PostgreSQL integer overflow
        memberRowId: tempIdBase - idx,
      }));

      setUnassignedDivisions(prev => [...prev, ...newMembers]);

      // Update map geometries - remove original and add cut parts
      setMapGeometries(prev => {
        if (!prev) return null;

        // Remove the original division being cut (match by memberRowId if available, otherwise by id)
        const filtered = prev.features.filter(f => {
          const featureId = f.properties?.id;
          const featureMemberRowId = f.properties?.memberRowId;

          // If cutting a division with memberRowId, match exactly
          if (cuttingDivision.memberRowId) {
            return featureMemberRowId !== cuttingDivision.memberRowId;
          }

          // Otherwise, remove by division id (but only non-custom geometry ones)
          if (featureId === cuttingDivision.id && !f.properties?.hasCustomGeometry) {
            return false; // Remove this one
          }

          return true; // Keep everything else
        });

        // Add cut parts with their custom geometries
        const newFeatures = cutParts.map((part, idx) => ({
          type: 'Feature' as const,
          properties: {
            id: cuttingDivision.id,
            memberRowId: tempIdBase - idx,
            name: part.name,
            path: cuttingDivision.path,
            hasChildren: false,
            hasCustomGeometry: true,
          },
          geometry: part.geometry,
        }));

        return {
          type: 'FeatureCollection',
          features: [...filtered, ...newFeatures],
        };
      });

      // Notify parent that changes were made
      onSplitsApplied?.();

    } catch (e) {
      console.error('Failed to apply cut parts:', e);
      alert('Failed to apply cut parts');
    } finally {
      setCutDialogOpen(false);
      setCuttingDivision(null);
      setCuttingDivisionGeometry(null);
    }
  }, [selectedRegion, cuttingDivision, getDivisionGroupIdx, setSubdivisionGroups, setUnassignedDivisions, onSplitsApplied]);

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
          groupColor: groupIdx !== null ? GROUP_COLORS[groupIdx % GROUP_COLORS.length] : '#cccccc',
          groupName: groupIdx !== null ? subdivisionGroups[groupIdx]?.name : 'Unassigned',
        },
      };
    });

    return { type: 'FeatureCollection', features };
  }, [mapGeometries, getDivisionGroupIdx, subdivisionGroups]);

  // Get hovered feature info
  const getHoveredFeatureInfo = () => {
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
  };

  const hoveredInfo = getHoveredFeatureInfo();

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
                        backgroundColor: GROUP_COLORS[idx % GROUP_COLORS.length],
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

        {/* Image overlay button */}
        <Tooltip title={imageOverlaySettings ? "Edit reference image overlay" : "Add reference image overlay"}>
          <IconButton
            size="small"
            onClick={() => setImageOverlayDialogOpen(true)}
            color={imageOverlaySettings ? "primary" : "default"}
          >
            <ImageIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Instructions */}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {activeTool === 'split'
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
        {subdivisionGroups.map((group, idx) => (
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
              backgroundColor: selectedGroupIdx === idx
                ? GROUP_COLORS[idx % GROUP_COLORS.length]
                : `${GROUP_COLORS[idx % GROUP_COLORS.length]}40`,
              color: selectedGroupIdx === idx ? '#fff' : 'inherit',
              borderWidth: 2,
              borderStyle: 'solid',
              borderColor: GROUP_COLORS[idx % GROUP_COLORS.length],
              '&:hover': {
                backgroundColor: `${GROUP_COLORS[idx % GROUP_COLORS.length]}80`,
              },
            }}
          />
        ))}
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
      </Box>

      {/* Map */}
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

            {/* Reference image overlay (rendered behind divisions) */}
            {imageOverlaySettings && (
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
          </Paper>
        )}
      </Paper>

      {/* Image Overlay Dialog */}
      <ImageOverlayDialog
        open={imageOverlayDialogOpen}
        onClose={() => setImageOverlayDialogOpen(false)}
        onApply={(settings) => setImageOverlaySettings(settings)}
        initialCenter={getMapCenter()}
        initialZoom={4}
        existingSettings={imageOverlaySettings}
        regionGeometries={mapGeometries}
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

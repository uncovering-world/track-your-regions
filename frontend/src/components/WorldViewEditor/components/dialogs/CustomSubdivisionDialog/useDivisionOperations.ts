import { useState, useCallback } from 'react';
import type { Region, RegionMember } from '../../../../../types';
import { getMemberKey } from '../../../types';
import type { SubdivisionGroup, MapTool } from './types';
import { removeMemberAtIndex, addMemberAtIndex } from './groupMutations';
import { fetchDivisionGeometry, fetchSubdivisions, removeDivisionsFromRegion, addDivisionsToRegion, moveMemberToRegion } from '../../../../../api';
import type { CutPart } from '../CutDivisionDialog';
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';

interface UseDivisionOperationsParams {
  selectedRegion: Region | null;
  mapGeometries: GeoJSON.FeatureCollection | null;
  setMapGeometries: React.Dispatch<React.SetStateAction<GeoJSON.FeatureCollection | null>>;
  subdivisionGroups: SubdivisionGroup[];
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
  unassignedDivisions: RegionMember[];
  setUnassignedDivisions: React.Dispatch<React.SetStateAction<RegionMember[]>>;
  onSplitsApplied?: () => void;
  getAllDivisions: () => RegionMember[];
  loadGeometriesForDivisions: (divisions: RegionMember[], parentIdToRemove?: number) => Promise<void>;
  selectedGroupIdx: number | 'unassigned' | null;
}

export function useDivisionOperations({
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
}: UseDivisionOperationsParams) {
  const [activeTool, setActiveTool] = useState<MapTool>('assign');
  const [splittingDivisionId, setSplittingDivisionId] = useState<number | null>(null);

  // Cut division dialog state
  const [cutDialogOpen, setCutDialogOpen] = useState(false);
  const [cuttingDivision, setCuttingDivision] = useState<RegionMember | null>(null);
  const [cuttingDivisionGeometry, setCuttingDivisionGeometry] = useState<GeoJSON.FeatureCollection | null>(null);

  // Move to parent state
  const [movingToParent, setMovingToParent] = useState(false);

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
        setSubdivisionGroups(prev => removeMemberAtIndex(prev, currentGroupIdx, memberKey));
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
        setSubdivisionGroups(prev => removeMemberAtIndex(prev, currentGroupIdx, memberKey));
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
          return !(featureId === cuttingDivision.id && !f.properties?.hasCustomGeometry);
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
  }, [selectedRegion, cuttingDivision, getDivisionGroupIdx, setSubdivisionGroups, setUnassignedDivisions, setMapGeometries, onSplitsApplied]);

  // Move a single division to the parent region
  const handleMoveDivisionToParent = async (div: RegionMember) => {
    if (!selectedRegion?.parentRegionId) return;

    try {
      if (div.memberRowId && div.memberRowId > 0) {
        await moveMemberToRegion(selectedRegion.id, div.memberRowId, selectedRegion.parentRegionId);
      } else {
        // Fallback for divisions without a real memberRowId: remove + add
        await removeDivisionsFromRegion(selectedRegion.id, [div.id]);
        await addDivisionsToRegion(selectedRegion.parentRegionId, [div.id]);
      }

      // Remove from local state
      const memberKey = getMemberKey(div);
      const currentGroupIdx = getDivisionGroupIdx(div.id, div.memberRowId);

      if (currentGroupIdx !== null) {
        setSubdivisionGroups(prev => removeMemberAtIndex(prev, currentGroupIdx, memberKey));
      } else {
        setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
      }

      // Remove from map geometries
      setMapGeometries(prev => {
        if (!prev) return null;
        return {
          type: 'FeatureCollection',
          features: prev.features.filter(f => {
            if (div.memberRowId) return f.properties?.memberRowId !== div.memberRowId;
            return f.properties?.id !== div.id;
          }),
        };
      });

      onSplitsApplied?.();
    } catch (e) {
      console.error('Failed to move division to parent:', e);
      alert('Failed to move division to parent');
    }
  };

  // Move all unassigned divisions to the parent region
  const handleMoveAllUnassignedToParent = async () => {
    if (!selectedRegion?.parentRegionId || unassignedDivisions.length === 0) return;

    setMovingToParent(true);
    try {
      for (const div of unassignedDivisions) {
        if (div.memberRowId && div.memberRowId > 0) {
          await moveMemberToRegion(selectedRegion.id, div.memberRowId, selectedRegion.parentRegionId);
        } else {
          await removeDivisionsFromRegion(selectedRegion.id, [div.id]);
          await addDivisionsToRegion(selectedRegion.parentRegionId, [div.id]);
        }
      }

      // Remove all unassigned from map geometries
      const unassignedKeys = new Set(unassignedDivisions.map(d => getMemberKey(d)));
      setMapGeometries(prev => {
        if (!prev) return null;
        return {
          type: 'FeatureCollection',
          features: prev.features.filter(f => {
            const key = `${f.properties?.id}-${f.properties?.memberRowId ?? 'null'}`;
            return !unassignedKeys.has(key);
          }),
        };
      });

      setUnassignedDivisions([]);
      onSplitsApplied?.();
    } catch (e) {
      console.error('Failed to move unassigned divisions to parent:', e);
      alert('Failed to move divisions to parent');
    } finally {
      setMovingToParent(false);
    }
  };

  // Try the in-memory mapGeometries first (it has any custom geometry), then fall
  // back to the GADM division geometry from the API.
  const loadCuttingGeometry = useCallback(async (
    div: ReturnType<typeof getAllDivisions>[number],
  ): Promise<GeoJSON.Geometry | null> => {
    if (div.hasCustomGeometry && div.memberRowId && mapGeometries) {
      const feature = mapGeometries.features.find(
        f => f.properties?.memberRowId === div.memberRowId,
      );
      if (feature?.geometry) return feature.geometry;
    }
    const geom = await fetchDivisionGeometry(div.id, selectedRegion?.worldViewId ?? 1);
    return (geom?.geometry as GeoJSON.Geometry | undefined) ?? null;
  }, [mapGeometries, selectedRegion]);

  const openCutDialogForDivision = useCallback(async (
    div: ReturnType<typeof getAllDivisions>[number],
  ) => {
    setCuttingDivision(div);
    try {
      const geometry = await loadCuttingGeometry(div);
      if (!geometry) return;
      setCuttingDivisionGeometry({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { id: div.id, name: div.name, memberRowId: div.memberRowId },
          geometry,
        }],
      });
      setCutDialogOpen(true);
    } catch (e) {
      console.error('Failed to load division geometry for cutting:', e);
    }
  }, [loadCuttingGeometry, setCuttingDivision, setCuttingDivisionGeometry, setCutDialogOpen]);

  const moveDivisionToUnassigned = useCallback((
    div: ReturnType<typeof getAllDivisions>[number],
    currentGroupIdx: number | null,
  ) => {
    if (currentGroupIdx === null) return; // Already unassigned
    const memberKey = getMemberKey(div);
    setSubdivisionGroups(prev => removeMemberAtIndex(prev, currentGroupIdx, memberKey));
    setUnassignedDivisions(prev => [...prev, div]);
  }, [setSubdivisionGroups, setUnassignedDivisions]);

  const moveDivisionToGroup = useCallback((
    div: ReturnType<typeof getAllDivisions>[number],
    currentGroupIdx: number | null,
    targetGroupIdx: number,
  ) => {
    if (currentGroupIdx === targetGroupIdx) return; // Already in this group
    const memberKey = getMemberKey(div);

    if (currentGroupIdx !== null) {
      setSubdivisionGroups(prev => removeMemberAtIndex(prev, currentGroupIdx, memberKey));
    } else {
      setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
    }

    setSubdivisionGroups(prev => addMemberAtIndex(prev, targetGroupIdx, div));
  }, [setSubdivisionGroups, setUnassignedDivisions]);

  const handleAssignToolClick = useCallback((
    div: ReturnType<typeof getAllDivisions>[number],
    divId: number,
    memberRowId: number | undefined,
  ) => {
    if (selectedGroupIdx === null) return;
    const currentGroupIdx = getDivisionGroupIdx(divId, memberRowId);
    if (selectedGroupIdx === 'unassigned') {
      moveDivisionToUnassigned(div, currentGroupIdx);
    } else {
      moveDivisionToGroup(div, currentGroupIdx, selectedGroupIdx);
    }
  }, [selectedGroupIdx, getDivisionGroupIdx, moveDivisionToUnassigned, moveDivisionToGroup]);

  // Handle clicking on a division in the map
  const handleMapClick = useCallback(async (event: MapLayerMouseEvent) => {
    const features = event.features;
    if (!features || features.length === 0) return;

    const clickedFeature = features[0];
    const divId = clickedFeature.properties?.id;
    const memberRowId = clickedFeature.properties?.memberRowId;
    if (!divId) return;

    const allDivisions = getAllDivisions();
    const div = allDivisions.find(d =>
      memberRowId ? d.memberRowId === memberRowId : d.id === divId,
    );
    if (!div) return;

    if (activeTool === 'moveToParent') {
      if (selectedRegion?.parentRegionId) await handleMoveDivisionToParent(div);
    } else if (activeTool === 'split') {
      if (div.hasChildren) await handleSplitDivision(div);
    } else if (activeTool === 'cut') {
      await openCutDialogForDivision(div);
    } else {
      handleAssignToolClick(div, divId, memberRowId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSplitDivision excluded to avoid re-creating on every render
  }, [activeTool, selectedRegion, getAllDivisions, openCutDialogForDivision, handleAssignToolClick]);

  return {
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
  };
}

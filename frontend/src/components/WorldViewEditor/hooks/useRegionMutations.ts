import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createRegion,
  deleteRegion,
  updateRegion,
  addDivisionsToRegion,
  removeDivisionsFromRegion,
  addChildDivisionsAsSubregions,
  flattenSubregion,
  expandToSubregions,
  updateWorldView,
} from '../../../api';
import type { Region, WorldView } from '../../../types';

interface InvalidationOptions {
  regionsChanged?: boolean;
  membersChanged?: boolean;
  geometriesChanged?: boolean;
  specificRegionIds?: number[];
}

interface UseRegionMutationsOptions {
  worldView: WorldView;
  selectedRegion: Region | null;
  regions: Region[];
  onRegionDeleted?: (regionId: number) => void;
  onRegionUpdated?: (region: Region) => void;
  onRegionCreated?: () => void;
  onDeleteConfirmNeeded?: (region: Region) => void;
  onEditingComplete?: () => void;
  onWorldViewRenamed?: () => void;
  onAddChildrenComplete?: () => void;
}

export function useRegionMutations({
  worldView,
  selectedRegion,
  regions,
  onRegionDeleted,
  onRegionUpdated,
  onRegionCreated,
  onDeleteConfirmNeeded,
  onEditingComplete,
  onWorldViewRenamed,
  onAddChildrenComplete,
}: UseRegionMutationsOptions) {
  const queryClient = useQueryClient();

  /**
   * Centralized invalidation helper - invalidates all worldView-related queries
   * This ensures UI stays in sync after any mutation
   */
  const invalidateWorldViewQueries = useCallback((options?: InvalidationOptions) => {
    const { regionsChanged = true, membersChanged = true, geometriesChanged = false, specificRegionIds } = options ?? {};

    console.log('[invalidateWorldViewQueries] Called with:', { regionsChanged, membersChanged, geometriesChanged, specificRegionIds });

    if (regionsChanged) {
      console.log('[invalidateWorldViewQueries] Invalidating regions for worldView:', worldView.id);
      queryClient.invalidateQueries({ queryKey: ['regions', worldView.id], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['rootRegions', worldView.id], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['leafRegions', worldView.id], refetchType: 'active' });
    }

    if (membersChanged) {
      if (specificRegionIds && specificRegionIds.length > 0) {
        // Invalidate specific regions' members
        console.log('[invalidateWorldViewQueries] Invalidating members for specific regions:', specificRegionIds);
        specificRegionIds.forEach(id => {
          queryClient.invalidateQueries({ queryKey: ['regionMembers', id], refetchType: 'active' });
        });
      } else {
        // Invalidate ALL member queries
        console.log('[invalidateWorldViewQueries] Invalidating ALL member queries');
        queryClient.invalidateQueries({ queryKey: ['regionMembers'], refetchType: 'active' });
      }
    }

    if (geometriesChanged) {
      // Simple invalidation - just invalidate by prefix
      if (specificRegionIds && specificRegionIds.length > 0) {
        console.log('[invalidateWorldViewQueries] Invalidating geometries for specific regions:', specificRegionIds);
        specificRegionIds.forEach(id => {
          queryClient.invalidateQueries({ queryKey: ['regionGeometry', id], refetchType: 'active' });
        });
      } else {
        console.log('[invalidateWorldViewQueries] Invalidating ALL geometry queries');
        queryClient.invalidateQueries({ queryKey: ['regionGeometry'], refetchType: 'active' });
      }
    }

    console.log('[invalidateWorldViewQueries] Done');
  }, [queryClient, worldView.id]);

  // Create region mutation
  const createRegionMutation = useMutation({
    mutationFn: (data: {
      worldViewId?: number;
      name: string;
      color: string;
      parentRegionId?: number;
      customGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    }) =>
      createRegion(data.worldViewId ?? worldView.id, {
        name: data.name,
        color: data.color,
        parentRegionId: data.parentRegionId,
        customGeometry: data.customGeometry,
      }),
    onSuccess: (_data, variables) => {
      invalidateWorldViewQueries({
        regionsChanged: true,
        membersChanged: !!variables.parentRegionId,
        specificRegionIds: variables.parentRegionId ? [variables.parentRegionId] : undefined,
      });
      onRegionCreated?.();
    },
  });

  // Delete region mutation
  const deleteRegionMutation = useMutation({
    mutationFn: ({ regionId, moveChildrenToParent }: { regionId: number; moveChildrenToParent?: boolean }) =>
      deleteRegion(regionId, { moveChildrenToParent }),
    onSuccess: (_data, { regionId: deletedRegionId }) => {
      // Invalidate everything since deleting a region affects parent's members and geometries
      invalidateWorldViewQueries({ regionsChanged: true, membersChanged: true, geometriesChanged: true });
      onRegionDeleted?.(deletedRegionId);
    },
  });

  // Helper to handle region deletion - shows confirmation if region has children
  const handleDeleteRegion = useCallback((region: Region) => {
    // Prevent rapid clicking while mutation is pending
    if (deleteRegionMutation.isPending) return;

    const children = regions.filter(r => r.parentRegionId === region.id);
    if (children.length > 0) {
      // Has children - show confirmation dialog
      onDeleteConfirmNeeded?.(region);
    } else {
      // No children - delete directly
      deleteRegionMutation.mutate({ regionId: region.id });
    }
  }, [regions, deleteRegionMutation, onDeleteConfirmNeeded]);

  // Update region mutation
  const updateRegionMutation = useMutation({
    mutationFn: ({ regionId, data }: { regionId: number; data: { name?: string; color?: string; parentRegionId?: number | null; usesHull?: boolean } }) =>
      updateRegion(regionId, data),
    onSuccess: (updatedRegion, variables) => {
      // If parent changed, invalidate ALL members (region moved between parents)
      const parentChanged = variables.data.parentRegionId !== undefined;
      // If color changed, invalidate members too (subregion colors are shown in member list)
      const colorChanged = variables.data.color !== undefined;
      // If hull status changed, invalidate geometries (hull needs to be generated)
      const hullChanged = variables.data.usesHull !== undefined;
      invalidateWorldViewQueries({
        regionsChanged: true,
        membersChanged: parentChanged || colorChanged,  // Invalidate members if parent or color changed
        geometriesChanged: parentChanged || hullChanged,  // Invalidate geometries if parent or hull status changed
      });

      // Update selectedRegion if it was the one being edited
      if (selectedRegion && selectedRegion.id === variables.regionId) {
        onRegionUpdated?.({
          ...selectedRegion,
          ...updatedRegion,
        });
      }

      onEditingComplete?.();
    },
  });

  // Add members (divisions) to region mutation
  const addMembersMutation = useMutation({
    mutationFn: async ({ regionId, divisionIds, createAsSubregions, includeChildren, inheritColor, childIds, customName }: {
      regionId: number;
      divisionIds: number[];
      createAsSubregions?: boolean;
      includeChildren?: boolean;
      inheritColor?: boolean;
      childIds?: number[];
      customName?: string;
    }) => {
      console.log('[addMembersMutation] Starting API call:', { regionId, divisionIds, createAsSubregions });
      try {
        const result = await addDivisionsToRegion(regionId, divisionIds, { createAsSubregions, includeChildren, inheritColor, childIds, customName });
        console.log('[addMembersMutation] API call completed successfully:', result);
        return result;
      } catch (error) {
        console.error('[addMembersMutation] API call failed:', error);
        throw error;
      }
    },
    onMutate: (variables) => {
      console.log('[addMembersMutation] onMutate - mutation starting:', variables);
    },
    onSuccess: (data, variables) => {
      console.log('[addMembersMutation] onSuccess! Response:', data, 'Variables:', variables);
      const regionsCreated = data.createdRegions && data.createdRegions.length > 0;
      invalidateWorldViewQueries({
        regionsChanged: regionsCreated,
        membersChanged: true,
        geometriesChanged: true,
        specificRegionIds: [variables.regionId],
      });
      console.log('[addMembersMutation] Invalidation completed');
    },
    onError: (error, variables) => {
      console.error('[addMembersMutation] onError:', error, 'Variables:', variables);
    },
    onSettled: (data, error, variables) => {
      console.log('[addMembersMutation] onSettled - mutation finished:', { data, error, variables });
    },
  });

  // Remove members (divisions) from region mutation
  const removeMembersMutation = useMutation({
    mutationFn: async ({ regionId, divisionIds, memberRowIds }: { regionId: number; divisionIds?: number[]; memberRowIds?: number[] }) => {
      console.log('[removeMembersMutation] Starting API call:', { regionId, divisionIds, memberRowIds });
      try {
        const result = await removeDivisionsFromRegion(regionId, divisionIds, memberRowIds);
        console.log('[removeMembersMutation] API call completed successfully:', result);
        return result;
      } catch (error) {
        console.error('[removeMembersMutation] API call failed:', error);
        throw error;
      }
    },
    onMutate: (variables) => {
      console.log('[removeMembersMutation] onMutate - mutation starting:', variables);
    },
    onSuccess: (data, variables) => {
      console.log('[removeMembersMutation] onSuccess! Response:', data, 'Variables:', variables);
      invalidateWorldViewQueries({
        regionsChanged: false,
        membersChanged: true,
        geometriesChanged: true,
        specificRegionIds: [variables.regionId],
      });
      console.log('[removeMembersMutation] Invalidation completed');
    },
    onError: (error, variables) => {
      console.error('[removeMembersMutation] onError:', error, 'Variables:', variables);
    },
    onSettled: (data, error, variables) => {
      console.log('[removeMembersMutation] onSettled - mutation finished:', { data, error, variables });
    },
  });

  // Add child divisions as subregions mutation
  const addChildrenMutation = useMutation({
    mutationFn: ({ regionId, divisionId, childIds, removeOriginal, inheritColor, createAsSubregions, assignments }: {
      regionId: number;
      divisionId: number;
      childIds?: number[];
      removeOriginal?: boolean;
      inheritColor?: boolean;
      createAsSubregions?: boolean;
      assignments?: Array<{ gadmChildId: number; existingRegionId: number }>;
    }) =>
      addChildDivisionsAsSubregions(regionId, divisionId, { childIds, removeOriginal, inheritColor, createAsSubregions, assignments }),
    onSuccess: (data, variables) => {
      const regionsCreated = data.createdRegions && data.createdRegions.length > 0;
      invalidateWorldViewQueries({
        regionsChanged: regionsCreated,
        membersChanged: true,
        geometriesChanged: true,
        specificRegionIds: [variables.regionId],
      });
      onAddChildrenComplete?.();
    },
  });

  // Flatten subregion mutation - converts a subregion to division members
  const flattenSubregionMutation = useMutation({
    mutationFn: ({ parentRegionId, subregionId }: { parentRegionId: number; subregionId: number }) =>
      flattenSubregion(parentRegionId, subregionId),
    onSuccess: (_data, variables) => {
      // Remove stale member data first so the UI doesn't show deleted subregions
      queryClient.removeQueries({ queryKey: ['regionMembers', variables.subregionId] });
      queryClient.removeQueries({ queryKey: ['regionMembers', variables.parentRegionId] });
      invalidateWorldViewQueries({
        regionsChanged: true,
        membersChanged: true,
        geometriesChanged: true,
        specificRegionIds: [variables.parentRegionId],
      });
    },
  });

  // Expand to subregions mutation - converts division members to subregions (opposite of flatten)
  const expandToSubregionsMutation = useMutation({
    mutationFn: ({ regionId, inheritColor }: { regionId: number; inheritColor?: boolean }) =>
      expandToSubregions(regionId, { inheritColor }),
    onSuccess: (_data, variables) => {
      invalidateWorldViewQueries({
        regionsChanged: true,
        membersChanged: true,
        geometriesChanged: true,
        specificRegionIds: [variables.regionId],
      });
    },
  });

  // World view update mutation (name, description, and/or source)
  const updateWorldViewMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string; source?: string }) => updateWorldView(worldView.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worldViews'] });
      onWorldViewRenamed?.();
    },
  });

  return {
    // Mutations
    createRegionMutation,
    deleteRegionMutation,
    updateRegionMutation,
    addMembersMutation,
    removeMembersMutation,
    addChildrenMutation,
    flattenSubregionMutation,
    expandToSubregionsMutation,
    updateWorldViewMutation,
    // Helpers
    handleDeleteRegion,
    invalidateWorldViewQueries,
  };
}

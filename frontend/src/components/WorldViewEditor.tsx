import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Dialog,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  Collapse,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useQueryClient } from '@tanstack/react-query';
import { fetchSubdivisions } from '../api';
import type { Region, AdministrativeDivision, WorldView, RegionMember } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  DeleteConfirmDialog,
  EditRegionDialog,
  AddChildrenDialog,
  type AddChildrenResult,
  PropagateColorDialog,
  type CreateFromStagedResult,
  SubdivisionDialog,
  type SubdivisionResult,
  SingleDivisionCustomDialog,
  type SingleDivisionCustomResult,
  CustomSubdivisionDialog,
  SplitDivisionDialog,
} from './WorldViewEditor/components/dialogs';
import { useRegionMutations, useRegionQueries } from './WorldViewEditor/hooks';
import { WorldViewHeader, RegionTreePanel, DivisionSearchPanel, GeometryMapPanel, ActionStrip } from './WorldViewEditor/components';
import { useAppTheme } from '../theme';

interface WorldViewEditorProps {
  open: boolean;
  onClose: () => void;
  worldView: WorldView;
}

export function WorldViewEditor({ open, onClose, worldView }: WorldViewEditorProps) {
  const { P } = useAppTheme();
  const queryClient = useQueryClient();
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [inheritParentColor, setInheritParentColor] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [createAsSubregions, setCreateAsSubregions] = useState(true);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [deleteConfirmRegion, setDeleteConfirmRegion] = useState<Region | null>(null);

  // Single division custom boundary dialog state
  const [singleDivisionForCustomBoundary, setSingleDivisionForCustomBoundary] = useState<AdministrativeDivision | null>(null);

  // Add children dialog state
  const [addChildrenDialogMember, setAddChildrenDialogMember] = useState<RegionMember | null>(null);
  const [inheritColorOnAddChildren, setInheritColorOnAddChildren] = useState(true);

  // Hierarchical subdivision selection dialog state
  const [subdivisionDialogDivision, setSubdivisionDialogDivision] = useState<AdministrativeDivision | null>(null);

  // Custom subdivision grouping dialog state
  const [customSubdivisionDialogOpen, setCustomSubdivisionDialogOpen] = useState(false);

  // Division split dialog state
  const [splittingDivision, setSplittingDivision] = useState<RegionMember | null>(null);

  // Split all members state
  const [isSplittingAllMembers, setIsSplittingAllMembers] = useState(false);
  const [splitAllProgress, setSplitAllProgress] = useState<{ current: number; total: number } | null>(null);

  // Propagate color dialog state
  const [propagateColorRegion, setPropagateColorRegion] = useState<Region | null>(null);

  // ── Selected member (division leaf in tree) ─────────────────
  const [selectedMember, setSelectedMember] = useState<RegionMember | null>(null);

  // ── NEW: Layout state ──────────────────────────────────────
  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);

  // ── Add-mode: replaces checkbox trio with single selector ──
  // 'division' = add directly, 'subregion' = create as subregion,
  // 'subregion-children' = subregion + include children
  type AddMode = 'division' | 'subregion' | 'subregion-children';
  const [addMode, setAddMode] = useState<AddMode>('subregion');

  // Sync legacy flags from addMode
  useEffect(() => {
    setCreateAsSubregions(addMode === 'subregion' || addMode === 'subregion-children');
    setIncludeChildren(addMode === 'subregion-children');
  }, [addMode]);

  // Clear selected member when region changes
  useEffect(() => { setSelectedMember(null); }, [selectedRegion]);

  // Region queries hook
  const {
    regions,
    regionsLoading,
    regionMembers,
    membersLoading,
    searchResults,
    searchLoading,
  } = useRegionQueries({
    worldView,
    open,
    selectedRegion,
    debouncedSearch,
  });

  // Memoize existing children to avoid re-creating the array on every render
  const existingChildren = useMemo(
    () => regions.filter(r => r.parentRegionId === selectedRegion?.id),
    [regions, selectedRegion?.id],
  );

  // Sync selectedRegion with fresh data from regions query (e.g. after focusBbox/anchorPoint update)
  useEffect(() => {
    if (!selectedRegion || !regions.length) return;
    const fresh = regions.find(r => r.id === selectedRegion.id);
    if (!fresh) return;
    const bboxChanged = JSON.stringify(fresh.focusBbox) !== JSON.stringify(selectedRegion.focusBbox);
    const anchorChanged = JSON.stringify(fresh.anchorPoint) !== JSON.stringify(selectedRegion.anchorPoint);
    if (bboxChanged || anchorChanged || fresh.usesHull !== selectedRegion.usesHull) {
      setSelectedRegion(prev => prev ? { ...prev, focusBbox: fresh.focusBbox, anchorPoint: fresh.anchorPoint, usesHull: fresh.usesHull } : null);
    }
  }, [regions, selectedRegion]);

  // Clear selected member if it no longer exists in regionMembers
  useEffect(() => {
    if (!selectedMember) return;
    const stillExists = regionMembers.some(m =>
      m.id === selectedMember.id &&
      m.memberRowId === selectedMember.memberRowId &&
      m.isSubregion === selectedMember.isSubregion
    );
    if (!stillExists) setSelectedMember(null);
  }, [regionMembers, selectedMember]);

  // Region mutations hook
  const {
    createRegionMutation,
    deleteRegionMutation,
    updateRegionMutation,
    addMembersMutation,
    removeMembersMutation,
    addChildrenMutation,
    flattenSubregionMutation,
    updateWorldViewMutation,
    handleDeleteRegion,
    invalidateWorldViewQueries,
  } = useRegionMutations({
    worldView,
    selectedRegion,
    regions,
    onRegionDeleted: (deletedRegionId) => {
      if (selectedRegion?.id === deletedRegionId) {
        setSelectedRegion(null);
      }
      setDeleteConfirmRegion(null);
    },
    onRegionUpdated: (updatedRegion) => {
      setSelectedRegion(updatedRegion);
    },
    onRegionCreated: () => {},
    onDeleteConfirmNeeded: (region) => {
      setDeleteConfirmRegion(region);
    },
    onEditingComplete: () => {
      setEditingRegion(null);
    },
    onAddChildrenComplete: () => {
      setAddChildrenDialogMember(null);
    },
  });

  // ── Callbacks (identical to before) ────────────────────────

  const handleConfirmSubdivisionSelection = useCallback((result: SubdivisionResult) => {
    if (!selectedRegion) return;
    addMembersMutation.mutate({
      regionId: selectedRegion.id,
      divisionIds: [result.divisionId],
      createAsSubregions: result.createAsSubregions,
      includeChildren: result.includeChildren,
      inheritColor: result.inheritColor,
      childIds: result.selectedChildIds.length > 0 ? result.selectedChildIds : undefined,
      customName: result.customName,
    });
    setSubdivisionDialogDivision(null);
  }, [selectedRegion, addMembersMutation]);

  const handleCreateRegionFromStaged = useCallback((divisions: AdministrativeDivision[], result: CreateFromStagedResult) => {
    if (!selectedRegion || divisions.length === 0) return;
    const colorToUse = result.inheritParentColor && selectedRegion?.color ? selectedRegion.color : '#3388ff';
    createRegionMutation.mutate({
      worldViewId: worldView.id,
      name: result.name,
      color: colorToUse,
      parentRegionId: selectedRegion.id,
      customGeometry: result.customGeometry,
    }, {
      onSuccess: (newRegion) => {
        addMembersMutation.mutate({
          regionId: newRegion.id,
          divisionIds: divisions.map(d => d.id),
          createAsSubregions: false,
        });
      }
    });
  }, [selectedRegion, worldView.id, createRegionMutation, addMembersMutation]);

  const handleConfirmSingleDivisionCustom = useCallback((result: SingleDivisionCustomResult) => {
    if (!selectedRegion) return;
    const colorToUse = result.inheritParentColor && selectedRegion?.color ? selectedRegion.color : '#3388ff';
    createRegionMutation.mutate({
      worldViewId: worldView.id,
      name: result.name,
      color: colorToUse,
      parentRegionId: selectedRegion.id,
      customGeometry: result.customGeometry,
    }, {
      onSuccess: (newRegion) => {
        addMembersMutation.mutate({
          regionId: newRegion.id,
          divisionIds: [result.divisionId],
          createAsSubregions: false,
        }, {
          onSuccess: async () => {
            await queryClient.refetchQueries({ queryKey: ['regions', worldView.id] });
            setSelectedRegion({
              id: newRegion.id,
              worldViewId: newRegion.worldViewId,
              name: newRegion.name,
              description: newRegion.description,
              parentRegionId: newRegion.parentRegionId,
              color: newRegion.color,
              isCustomBoundary: true,
              usesHull: false,
              hasSubregions: false,
              hasHullChildren: false,
            });
            queryClient.invalidateQueries({ queryKey: ['regionGeometry', newRegion.id] });
          }
        });
        setSingleDivisionForCustomBoundary(null);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryClient is a stable singleton
  }, [selectedRegion, worldView.id, createRegionMutation, addMembersMutation]);

  const handleAddDivision = useCallback((division: AdministrativeDivision) => {
    if (!selectedRegion) return;
    addMembersMutation.mutate({
      regionId: selectedRegion.id,
      divisionIds: [division.id],
      createAsSubregions,
      includeChildren: createAsSubregions && includeChildren,
      inheritColor: createAsSubregions && inheritColorOnAddChildren,
    });
  }, [selectedRegion, addMembersMutation, createAsSubregions, includeChildren, inheritColorOnAddChildren]);

  const handleRemoveMember = useCallback((member: RegionMember) => {
    if (!selectedRegion) return;
    if (removeMembersMutation.isPending || deleteRegionMutation.isPending) return;

    if (member.isSubregion) {
      const regionToDelete = regions.find(r => r.id === member.id);
      if (regionToDelete) handleDeleteRegion(regionToDelete);
    } else {
      if (member.hasCustomGeometry && member.memberRowId) {
        removeMembersMutation.mutate({ regionId: selectedRegion.id, memberRowIds: [member.memberRowId] });
      } else {
        removeMembersMutation.mutate({ regionId: selectedRegion.id, divisionIds: [member.id] });
      }
    }
  }, [selectedRegion, removeMembersMutation, deleteRegionMutation.isPending, regions, handleDeleteRegion]);

  const handleAddChildren = useCallback((member: RegionMember) => {
    if (!selectedRegion || member.isSubregion) return;
    setAddChildrenDialogMember(member);
  }, [selectedRegion]);

  const handleSplitAllMembers = useCallback(async () => {
    if (!selectedRegion) return;
    const divisionMembers = regionMembers.filter(m => !m.isSubregion);
    if (divisionMembers.length === 0) return;
    if (!window.confirm(
      `Split all ${divisionMembers.length} division${divisionMembers.length > 1 ? 's' : ''} into their children?\n\nThis will replace each division with its GADM subdivisions as subregions.`
    )) return;

    setIsSplittingAllMembers(true);
    setSplitAllProgress({ current: 0, total: divisionMembers.length });
    try {
      for (let i = 0; i < divisionMembers.length; i++) {
        const member = divisionMembers[i];
        setSplitAllProgress({ current: i + 1, total: divisionMembers.length });
        const children = await fetchSubdivisions(member.id);
        if (children.length === 0) continue;
        await new Promise<void>((resolve) => {
          addChildrenMutation.mutate({
            regionId: selectedRegion.id,
            divisionId: member.id,
            removeOriginal: true,
            inheritColor: inheritColorOnAddChildren,
            createAsSubregions: true,
          }, {
            onSuccess: () => resolve(),
            onError: () => resolve(),
          });
        });
      }
    } finally {
      setIsSplittingAllMembers(false);
      setSplitAllProgress(null);
    }
  }, [selectedRegion, regionMembers, addChildrenMutation, inheritColorOnAddChildren]);

  const handleInheritParentColor = useCallback((member: RegionMember) => {
    if (!selectedRegion || !member.isSubregion) return;
    updateRegionMutation.mutate({
      regionId: member.id,
      data: { color: selectedRegion.color || '#3388ff' },
    });
  }, [selectedRegion, updateRegionMutation]);

  const handleConfirmPropagateColor = useCallback(async (regionIds: number[]) => {
    if (!propagateColorRegion) return;
    const color = propagateColorRegion.color || '#3388ff';
    for (const regionId of regionIds) {
      await updateRegionMutation.mutateAsync({ regionId, data: { color } });
    }
    setPropagateColorRegion(null);
    invalidateWorldViewQueries({ regionsChanged: true, membersChanged: true });
  }, [propagateColorRegion, updateRegionMutation, invalidateWorldViewQueries]);

  const handleConfirmAddChildren = useCallback((result: AddChildrenResult) => {
    if (!selectedRegion) return;
    addChildrenMutation.mutate({
      regionId: selectedRegion.id,
      divisionId: result.divisionId,
      childIds: result.childIds,
      removeOriginal: true,
      inheritColor: result.inheritColor,
      createAsSubregions: result.asSubregions,
      assignments: result.assignments,
    });
  }, [selectedRegion, addChildrenMutation]);

  const handleFlattenAll = useCallback(async () => {
    if (!selectedRegion) return;
    const subregions = regionMembers.filter(m => m.isSubregion);
    if (subregions.length === 0) return;
    if (!window.confirm(
      `Flatten all ${subregions.length} subregions?\n\nThis will move all divisions from subregions directly into "${selectedRegion.name}" and delete the subregions.`
    )) return;
    for (const subregion of subregions) {
      await flattenSubregionMutation.mutateAsync({
        parentRegionId: selectedRegion.id,
        subregionId: subregion.id,
      });
    }
    // After all flattens complete, do a comprehensive invalidation
    invalidateWorldViewQueries({
      regionsChanged: true,
      membersChanged: true,
      geometriesChanged: true,
      specificRegionIds: [selectedRegion.id],
    });
  }, [selectedRegion, regionMembers, flattenSubregionMutation, invalidateWorldViewQueries]);

  // ── Derived values for status bar ──────────────────────────
  const divisionCount = regionMembers.filter(m => !m.isSubregion).length;
  const subregionCount = regionMembers.filter(m => m.isSubregion).length;

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      slotProps={{
        paper: {
          sx: { bgcolor: P.light.bg, overflow: 'hidden' },
        },
      }}
    >
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: P.font.ui,
      }}>

        {/* ═══ TOP BAR ═══════════════════════════════════════════ */}
        <Box sx={{
          py: 1,
          bgcolor: P.dark.bg,
          display: 'flex',
          alignItems: 'center',
          px: 2.5,
          gap: 2,
          borderBottom: `1px solid ${P.dark.border}`,
          flexShrink: 0,
        }}>
          <WorldViewHeader
            worldView={worldView}
            onUpdate={(data) => updateWorldViewMutation.mutate(data)}
            isPending={updateWorldViewMutation.isPending}
            onClose={onClose}
          />
          <Tooltip title="Close editor">
            <IconButton
              onClick={onClose}
              size="small"
              sx={{ ml: 'auto', color: P.dark.textMuted, '&:hover': { color: P.accent.danger } }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>

        {/* ═══ MAIN CONTENT ══════════════════════════════════════ */}
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* ─── LEFT SIDEBAR ──────────────────────────────────── */}
          <Box sx={{
            width: 360,
            bgcolor: P.dark.bg,
            display: 'flex',
            flexDirection: 'column',
            borderRight: `1px solid ${P.dark.border}`,
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            <RegionTreePanel
              regions={regions}
              regionsLoading={regionsLoading}
              selectedRegion={selectedRegion}
              onSelectRegion={setSelectedRegion}
              regionMembers={regionMembers}
              membersLoading={membersLoading}
              inheritParentColor={inheritParentColor}
              onInheritParentColorChange={setInheritParentColor}
              onCreateRegion={(data) => createRegionMutation.mutate(data)}
              createRegionPending={createRegionMutation.isPending}
              onEditRegion={(region: Region) => setEditingRegion(region)}
              onDeleteRegion={handleDeleteRegion}
              onMoveRegion={(regionId: number, newParentId: number | null) => updateRegionMutation.mutate({ regionId, data: { parentRegionId: newParentId } })}
              selectedMember={selectedMember}
              onSelectMember={setSelectedMember}
            />
          </Box>

          {/* ─── RIGHT CONTENT AREA ────────────────────────────── */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

            {/* ─ ACTION STRIP (batch/member actions) ─ */}
            <ActionStrip
              selectedRegion={selectedRegion}
              selectedMember={selectedMember}
              onClearMember={() => setSelectedMember(null)}
              regions={regions}
              regionMembers={regionMembers}
              onOpenCustomSubdivision={() => setCustomSubdivisionDialogOpen(true)}
              onSplitAllMembers={handleSplitAllMembers}
              isSplittingAllMembers={isSplittingAllMembers}
              splitAllProgress={splitAllProgress}
              onFlattenAll={handleFlattenAll}
              flattenPending={flattenSubregionMutation.isPending}
              onPropagateColor={(region: Region) => setPropagateColorRegion(region)}
              addChildrenPending={addChildrenMutation.isPending}
              updateRegionPending={updateRegionMutation.isPending}
              onAddChildren={handleAddChildren}
              onSplitDivision={(member: RegionMember) => setSplittingDivision(member)}
              onInheritMemberColor={handleInheritParentColor}
              onRemoveMember={handleRemoveMember}
              removeMemberPending={removeMembersMutation.isPending}
              deletePending={deleteRegionMutation.isPending}
            />

            {/* ─ MAP (hero — always visible, fills space) ─ */}
            <Box sx={{ flex: 1, minHeight: 200, position: 'relative' }}>
              <GeometryMapPanel
                selectedRegion={selectedRegion}
                worldView={worldView}
                open={open}
                regions={regions}
                onSelectedRegionChange={setSelectedRegion}
                onInvalidateQueries={({ regionGeometryId, regions: invalidateRegions }) => {
                  if (regionGeometryId) {
                    queryClient.invalidateQueries({ queryKey: ['regionGeometry', regionGeometryId] });
                  }
                  if (invalidateRegions) {
                    queryClient.invalidateQueries({ queryKey: ['regions', worldView.id] });
                  }
                }}
                onToggleHull={(region) => updateRegionMutation.mutate({
                  regionId: region.id,
                  data: { usesHull: !region.usesHull },
                })}
              />
            </Box>

            {/* ─ SEARCH DRAWER (collapsible) ─────────────────── */}
            <Box sx={{
              borderTop: `2px solid ${P.light.border}`,
              bgcolor: P.light.surface,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              {/* Drawer handle */}
              <Box
                onClick={() => setSearchDrawerOpen(!searchDrawerOpen)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 1,
                  cursor: 'pointer',
                  userSelect: 'none',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.03)' },
                  borderBottom: searchDrawerOpen ? `1px solid ${P.light.border}` : 'none',
                }}
              >
                <SearchIcon sx={{ fontSize: 18, color: P.accent.primary }} />
                <Typography sx={{
                  fontFamily: P.font.ui,
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  letterSpacing: '0.03em',
                  color: P.light.text,
                }}>
                  Search & Add Divisions
                </Typography>

                {/* Add-mode selector (inline in drawer header) */}
                {selectedRegion && (
                  <Select
                    size="small"
                    value={addMode}
                    onChange={(e) => setAddMode(e.target.value as AddMode)}
                    onClick={(e) => e.stopPropagation()}
                    variant="outlined"
                    sx={{
                      ml: 1,
                      height: 28,
                      fontSize: '0.75rem',
                      fontFamily: P.font.ui,
                      '& .MuiSelect-select': { py: 0.5, px: 1 },
                      '& fieldset': { borderColor: P.light.border },
                    }}
                  >
                    <MenuItem value="division" sx={{ fontSize: '0.8rem' }}>
                      Add as division
                    </MenuItem>
                    <MenuItem value="subregion" sx={{ fontSize: '0.8rem' }}>
                      Add as subregion
                    </MenuItem>
                    <MenuItem value="subregion-children" sx={{ fontSize: '0.8rem' }}>
                      Subregion + children
                    </MenuItem>
                  </Select>
                )}

                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', color: P.light.textMuted }}>
                  {searchDrawerOpen
                    ? <KeyboardArrowDownIcon fontSize="small" />
                    : <KeyboardArrowUpIcon fontSize="small" />
                  }
                </Box>
              </Box>

              {/* Drawer content */}
              <Collapse in={searchDrawerOpen} timeout={300}>
                <Box sx={{ height: 300, overflow: 'hidden' }}>
                  <DivisionSearchPanel
                    selectedRegion={selectedRegion}
                    regionMembers={regionMembers}
                    searchQuery={searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    searchResults={searchResults}
                    searchLoading={searchLoading}
                    debouncedSearch={debouncedSearch}
                    createAsSubregions={createAsSubregions}
                    inheritColorOnAddChildren={inheritColorOnAddChildren}
                    onInheritColorOnAddChildrenChange={setInheritColorOnAddChildren}
                    inheritParentColor={inheritParentColor}
                    onInheritParentColorChange={setInheritParentColor}
                    onAddDivision={handleAddDivision}
                    onOpenSubdivisionDialog={(division) => setSubdivisionDialogDivision(division)}
                    onOpenSingleDivisionCustom={(division) => setSingleDivisionForCustomBoundary(division)}
                    onCreateRegionFromStaged={handleCreateRegionFromStaged}
                    createFromStagedPending={createRegionMutation.isPending || addMembersMutation.isPending}
                  />
                </Box>
              </Collapse>
            </Box>
          </Box>
        </Box>

        {/* ═══ STATUS BAR ════════════════════════════════════════ */}
        <Box sx={{
          height: 32,
          bgcolor: P.dark.bg,
          display: 'flex',
          alignItems: 'center',
          px: 2.5,
          gap: 3,
          flexShrink: 0,
          borderTop: `1px solid ${P.dark.border}`,
        }}>
          <Typography sx={{
            fontFamily: P.font.mono,
            fontSize: '0.65rem',
            color: P.dark.textMuted,
            letterSpacing: '0.02em',
          }}>
            {regions.length} region{regions.length !== 1 ? 's' : ''}
          </Typography>

          {selectedRegion && (
            <>
              <Box sx={{ width: 1, height: 12, bgcolor: P.dark.border }} />
              <Typography sx={{
                fontFamily: P.font.mono,
                fontSize: '0.65rem',
                color: P.accent.primary,
                letterSpacing: '0.02em',
              }}>
                {selectedRegion.name}
              </Typography>
              {divisionCount > 0 && (
                <Typography sx={{ fontFamily: P.font.mono, fontSize: '0.65rem', color: P.dark.textMuted }}>
                  {divisionCount} div
                </Typography>
              )}
              {subregionCount > 0 && (
                <Typography sx={{ fontFamily: P.font.mono, fontSize: '0.65rem', color: P.dark.textMuted }}>
                  {subregionCount} sub
                </Typography>
              )}
            </>
          )}

          <Box sx={{ ml: 'auto' }}>
            <Typography sx={{
              fontFamily: P.font.mono,
              fontSize: '0.6rem',
              color: P.dark.textMuted,
              opacity: 0.5,
            }}>
              WorldView Editor
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ═══ DIALOGS (unchanged) ═══════════════════════════════ */}

      <EditRegionDialog
        region={editingRegion}
        regions={regions}
        onClose={() => setEditingRegion(null)}
        onSave={(data) => {
          if (editingRegion) {
            updateRegionMutation.mutate({ regionId: editingRegion.id, data });
          }
        }}
      />

      <DeleteConfirmDialog
        region={deleteConfirmRegion}
        childCount={regions.filter(r => r.parentRegionId === deleteConfirmRegion?.id).length}
        onClose={() => setDeleteConfirmRegion(null)}
        onDeleteMoveChildren={() => {
          if (deleteConfirmRegion) {
            deleteRegionMutation.mutate({ regionId: deleteConfirmRegion.id, moveChildrenToParent: true });
          }
        }}
        onDeleteWithChildren={() => {
          if (deleteConfirmRegion) {
            deleteRegionMutation.mutate({ regionId: deleteConfirmRegion.id, moveChildrenToParent: false });
          }
        }}
      />

      <AddChildrenDialog
        member={addChildrenDialogMember}
        selectedRegion={selectedRegion}
        existingChildren={existingChildren}
        inheritColor={inheritColorOnAddChildren}
        onInheritColorChange={setInheritColorOnAddChildren}
        worldViewId={worldView.id}
        onClose={() => setAddChildrenDialogMember(null)}
        onConfirm={handleConfirmAddChildren}
        isPending={addChildrenMutation.isPending}
      />

      <PropagateColorDialog
        region={propagateColorRegion}
        regions={regions}
        onClose={() => setPropagateColorRegion(null)}
        onConfirm={handleConfirmPropagateColor}
        isPending={updateRegionMutation.isPending}
      />

      <SubdivisionDialog
        division={subdivisionDialogDivision}
        selectedRegion={selectedRegion}
        createAsSubregions={createAsSubregions}
        includeChildren={includeChildren}
        onIncludeChildrenChange={setIncludeChildren}
        inheritColor={inheritColorOnAddChildren}
        onInheritColorChange={setInheritColorOnAddChildren}
        worldViewId={worldView.id}
        onClose={() => setSubdivisionDialogDivision(null)}
        onConfirm={handleConfirmSubdivisionSelection}
        isPending={addMembersMutation.isPending}
      />

      <SingleDivisionCustomDialog
        division={singleDivisionForCustomBoundary}
        selectedRegion={selectedRegion}
        inheritParentColor={inheritParentColor}
        onInheritParentColorChange={setInheritParentColor}
        onClose={() => setSingleDivisionForCustomBoundary(null)}
        onConfirm={handleConfirmSingleDivisionCustom}
        isPending={createRegionMutation.isPending}
      />

      <CustomSubdivisionDialog
        open={customSubdivisionDialogOpen}
        selectedRegion={selectedRegion}
        regionMembers={regionMembers}
        existingChildren={existingChildren}
        worldViewId={worldView.id}
        worldViewDescription={worldView.description || undefined}
        worldViewSource={worldView.source || undefined}
        onClose={() => setCustomSubdivisionDialogOpen(false)}
        onComplete={() => {
          setCustomSubdivisionDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ['regions', worldView.id] });
          if (selectedRegion) {
            queryClient.invalidateQueries({ queryKey: ['regionMembers', selectedRegion.id] });
          }
        }}
        onSplitsApplied={() => {
          if (selectedRegion) {
            queryClient.invalidateQueries({ queryKey: ['regionMembers', selectedRegion.id] });
          }
        }}
      />

      <SplitDivisionDialog
        member={splittingDivision}
        selectedRegion={selectedRegion}
        onClose={() => setSplittingDivision(null)}
        onComplete={() => {
          setSplittingDivision(null);
          queryClient.invalidateQueries({ queryKey: ['regions', worldView.id] });
          if (selectedRegion) {
            queryClient.invalidateQueries({ queryKey: ['regionMembers', selectedRegion.id] });
            queryClient.invalidateQueries({ queryKey: ['regionGeometry', selectedRegion.id] });
          }
        }}
      />
    </Dialog>
  );
}

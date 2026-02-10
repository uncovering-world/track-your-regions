import { useState, useCallback } from 'react';
import {
  FormControlLabel,
  Switch,
  Typography,
  TextField,
  Box,
  Chip,
  IconButton,
  Tooltip,
  Button,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import DrawIcon from '@mui/icons-material/Draw';
import MapIcon from '@mui/icons-material/Map';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import type { Region, AdministrativeDivision, AdministrativeDivisionWithPath, RegionMember } from '../../../types';
import { fetchDivisionGeometry } from '../../../api';
import {
  DivisionPreviewDialog,
  CreateFromStagedDialog,
  type CreateFromStagedResult,
} from './dialogs';
import { useAppTheme } from '../../../theme';

export interface DivisionSearchPanelProps {
  // Context
  selectedRegion: Region | null;
  regionMembers: RegionMember[];

  // Search (controlled from parent — fed into useRegionQueries)
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchResults: AdministrativeDivisionWithPath[];
  searchLoading: boolean;
  debouncedSearch: string;

  // Shared options (controlled, shared with SubdivisionDialog / AddChildrenDialog)
  createAsSubregions: boolean;
  inheritColorOnAddChildren: boolean;
  onInheritColorOnAddChildrenChange: (value: boolean) => void;

  // For CreateFromStagedDialog (shared with RegionTreePanel)
  inheritParentColor: boolean;
  onInheritParentColorChange: (value: boolean) => void;

  // Actions
  onAddDivision: (division: AdministrativeDivision) => void;
  onOpenSubdivisionDialog: (division: AdministrativeDivision) => void;
  onOpenSingleDivisionCustom: (division: AdministrativeDivision) => void;
  onCreateRegionFromStaged: (stagedDivisions: AdministrativeDivision[], result: CreateFromStagedResult) => void;
  createFromStagedPending: boolean;
}

export function DivisionSearchPanel({
  selectedRegion,
  regionMembers,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searchLoading,
  debouncedSearch,
  createAsSubregions,
  inheritColorOnAddChildren,
  onInheritColorOnAddChildrenChange,
  inheritParentColor,
  onInheritParentColorChange,
  onAddDivision,
  onOpenSubdivisionDialog,
  onOpenSingleDivisionCustom,
  onCreateRegionFromStaged,
  createFromStagedPending,
}: DivisionSearchPanelProps) {
  const { P } = useAppTheme();

  // --- Panel-internal state ---

  // "Select specific children" option (only affects search panel behavior)
  const [selectSpecificChildren, setSelectSpecificChildren] = useState(false);

  // Staging area for collecting divisions before batch-creating a region
  const [stagedDivisions, setStagedDivisions] = useState<AdministrativeDivision[]>([]);
  const [createFromStagedDialogOpen, setCreateFromStagedDialogOpen] = useState(false);

  // Division preview state
  const [previewDivision, setPreviewDivision] = useState<AdministrativeDivisionWithPath | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // --- Handlers ---

  const handleAddDivision = useCallback((division: AdministrativeDivision) => {
    if (!selectedRegion) return;

    if (selectSpecificChildren) {
      onOpenSubdivisionDialog(division);
    } else {
      onAddDivision(division);
    }
  }, [selectedRegion, selectSpecificChildren, onOpenSubdivisionDialog, onAddDivision]);

  const handleStageDivision = useCallback((division: AdministrativeDivision) => {
    setStagedDivisions(prev => {
      if (prev.some(d => d.id === division.id)) return prev;
      return [...prev, division];
    });
  }, []);

  const handleUnstageDivision = useCallback((divisionId: number) => {
    setStagedDivisions(prev => prev.filter(d => d.id !== divisionId));
  }, []);

  const handleClearStaged = useCallback(() => {
    setStagedDivisions([]);
  }, []);

  const handlePreviewDivision = useCallback(async (division: AdministrativeDivisionWithPath) => {
    setPreviewDivision(division);
    setPreviewLoading(true);
    setPreviewGeometry(null);

    try {
      const feature = await fetchDivisionGeometry(division.id, 1);
      if (feature?.geometry) {
        setPreviewGeometry(feature.geometry as GeoJSON.Geometry);
      }
    } catch (e) {
      console.error('Failed to fetch division geometry:', e);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleConfirmCreateFromStaged = useCallback((result: CreateFromStagedResult) => {
    onCreateRegionFromStaged(stagedDivisions, result);
    setStagedDivisions([]);
    setCreateFromStagedDialogOpen(false);
  }, [stagedDivisions, onCreateRegionFromStaged]);

  // ── Shared sx fragments ──────────────────────────────────────
  const resultRowSx = {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    py: 0.75,
    px: 1.5,
    borderBottom: `1px solid ${P.light.border}`,
    '&:hover': { bgcolor: 'rgba(78, 205, 196, 0.04)' },
    '&:last-child': { borderBottom: 'none' },
  };

  const actionBtnSx = {
    width: 26,
    height: 26,
    color: P.light.textMuted,
    '&:hover': { color: P.accent.primary, bgcolor: P.accent.primaryDim },
  };

  return (
    <>
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}>
        {/* ── Search bar + inline options ──────────────────────── */}
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${P.light.border}`,
          flexShrink: 0,
        }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search administrative divisions..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            disabled={!selectedRegion}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: P.font.ui,
                fontSize: '0.85rem',
                height: 34,
                bgcolor: P.light.bg,
                '& fieldset': { borderColor: P.light.border },
                '&:hover fieldset': { borderColor: P.accent.primary },
                '&.Mui-focused fieldset': { borderColor: P.accent.primary },
              },
              '& .MuiInputBase-input::placeholder': {
                color: P.light.textMuted,
                opacity: 1,
              },
            }}
          />

          {/* Compact toggle: pick specific children */}
          <Tooltip title="When enabled, clicking Add opens a dialog to pick specific subdivisions" placement="top">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={selectSpecificChildren}
                  onChange={(e) => setSelectSpecificChildren(e.target.checked)}
                  disabled={!selectedRegion}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: P.accent.primary },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: P.accent.primary },
                  }}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <AccountTreeIcon sx={{ fontSize: 14, color: P.light.textMuted }} />
                  <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.7rem', color: P.light.textMuted, whiteSpace: 'nowrap' }}>
                    Pick children
                  </Typography>
                </Box>
              }
              sx={{ ml: 0, mr: 0, flexShrink: 0 }}
            />
          </Tooltip>

          {/* Compact toggle: inherit color */}
          {createAsSubregions && (
            <Tooltip title="Inherit parent region color when creating subregions" placement="top">
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={inheritColorOnAddChildren}
                    onChange={(e) => onInheritColorOnAddChildrenChange(e.target.checked)}
                    disabled={!selectedRegion}
                    sx={{
                      '& .MuiSwitch-switchBase.Mui-checked': { color: P.accent.primary },
                      '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: P.accent.primary },
                    }}
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{
                      width: 10,
                      height: 10,
                      backgroundColor: selectedRegion?.color || '#3388ff',
                      borderRadius: '2px',
                      border: '1px solid rgba(0,0,0,0.15)',
                      flexShrink: 0,
                    }} />
                    <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.7rem', color: P.light.textMuted, whiteSpace: 'nowrap' }}>
                      Inherit color
                    </Typography>
                  </Box>
                }
                sx={{ ml: 0, mr: 0, flexShrink: 0 }}
              />
            </Tooltip>
          )}
        </Box>

        {/* ── Staging area (compact chip bar) ──────────────────── */}
        {stagedDivisions.length > 0 && (
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.5,
            py: 0.75,
            bgcolor: P.accent.primaryDim,
            borderBottom: `1px solid ${P.light.border}`,
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            <Typography sx={{
              fontFamily: P.font.ui,
              fontSize: '0.7rem',
              fontWeight: 600,
              color: P.light.text,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              Staged ({stagedDivisions.length})
            </Typography>

            <Box sx={{ display: 'flex', gap: 0.5, overflow: 'auto', flex: 1, py: 0.25 }}>
              {stagedDivisions.map(division => (
                <Chip
                  key={division.id}
                  label={division.name}
                  size="small"
                  onDelete={() => handleUnstageDivision(division.id)}
                  sx={{
                    fontFamily: P.font.ui,
                    fontSize: '0.7rem',
                    height: 22,
                    bgcolor: P.light.surface,
                    border: `1px solid ${P.light.border}`,
                    '& .MuiChip-deleteIcon': { fontSize: 14 },
                  }}
                />
              ))}
            </Box>

            <Button
              size="small"
              onClick={handleClearStaged}
              sx={{
                minWidth: 'auto',
                px: 1,
                py: 0.25,
                fontSize: '0.65rem',
                fontFamily: P.font.ui,
                color: P.light.textMuted,
                textTransform: 'none',
              }}
            >
              Clear
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => setCreateFromStagedDialogOpen(true)}
              sx={{
                minWidth: 'auto',
                px: 1.5,
                py: 0.25,
                fontSize: '0.7rem',
                fontFamily: P.font.ui,
                fontWeight: 600,
                textTransform: 'none',
                bgcolor: P.accent.primary,
                color: P.dark.bg,
                '&:hover': { bgcolor: P.accent.primaryHover },
              }}
            >
              Create Region
            </Button>
          </Box>
        )}

        {/* ── Results list ─────────────────────────────────────── */}
        <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {!selectedRegion ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{
                fontFamily: P.font.ui,
                fontSize: '0.85rem',
                color: P.light.textMuted,
                fontStyle: 'italic',
              }}>
                Select a region in the sidebar to search divisions
              </Typography>
            </Box>
          ) : searchLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={22} sx={{ color: P.accent.primary }} />
            </Box>
          ) : searchResults.length === 0 && debouncedSearch.length >= 2 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{
                fontFamily: P.font.ui,
                fontSize: '0.85rem',
                color: P.light.textMuted,
              }}>
                No divisions found for &quot;{debouncedSearch}&quot;
              </Typography>
            </Box>
          ) : searchResults.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{
                fontFamily: P.font.ui,
                fontSize: '0.8rem',
                color: P.light.textMuted,
                fontStyle: 'italic',
              }}>
                Type at least 2 characters to search
              </Typography>
            </Box>
          ) : (
            searchResults.map((division) => {
              const isAdded = regionMembers.some((m) => m.id === division.id);
              const isStaged = stagedDivisions.some((d) => d.id === division.id);

              return (
                <Box key={division.id} sx={resultRowSx}>
                  {/* Division info */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{
                      fontFamily: P.font.ui,
                      fontSize: '0.82rem',
                      fontWeight: 500,
                      color: isAdded ? P.light.textMuted : P.light.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {division.name}
                    </Typography>
                    <Typography sx={{
                      fontFamily: P.font.mono,
                      fontSize: '0.62rem',
                      color: P.light.textMuted,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.3,
                    }}>
                      {division.path}
                      {' \u2022 '}
                      used: {division.usageCount ?? 0}
                      {division.usedAsSubdivisionCount && division.usedAsSubdivisionCount > 0
                        ? ` \u2022 ${division.usedAsSubdivisionCount} as subdiv`
                        : ''}
                      {division.hasUsedSubdivisions ? ' \u2022 has used subdivs' : ''}
                    </Typography>
                  </Box>

                  {/* Action buttons */}
                  {isAdded ? (
                    <Chip
                      size="small"
                      label="Added"
                      sx={{
                        fontFamily: P.font.ui,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        height: 20,
                        bgcolor: 'rgba(102, 187, 106, 0.12)',
                        color: P.accent.success,
                        border: `1px solid rgba(102, 187, 106, 0.25)`,
                      }}
                    />
                  ) : (
                    <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
                      <Tooltip title="Preview on map" placement="top">
                        <IconButton
                          size="small"
                          onClick={() => handlePreviewDivision(division)}
                          sx={actionBtnSx}
                        >
                          <MapIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Draw custom boundary" placement="top">
                        <IconButton
                          size="small"
                          onClick={() => onOpenSingleDivisionCustom(division)}
                          sx={actionBtnSx}
                        >
                          <DrawIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Stage for region creation" placement="top">
                        <IconButton
                          size="small"
                          onClick={() => handleStageDivision(division)}
                          disabled={isStaged}
                          sx={{
                            ...actionBtnSx,
                            ...(isStaged ? { color: P.accent.warning, opacity: 0.5 } : {}),
                          }}
                        >
                          <PlaylistAddIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={selectSpecificChildren ? 'Pick children to add' : 'Add to region'} placement="top">
                        <IconButton
                          size="small"
                          onClick={() => handleAddDivision(division)}
                          sx={{
                            ...actionBtnSx,
                            color: P.accent.primary,
                            '&:hover': { color: P.accent.primaryHover, bgcolor: P.accent.primaryDim },
                          }}
                        >
                          <AddIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </Box>

      {/* Create Region from Staged Divisions Dialog */}
      <CreateFromStagedDialog
        open={createFromStagedDialogOpen}
        stagedDivisions={stagedDivisions}
        selectedRegion={selectedRegion}
        inheritParentColor={inheritParentColor}
        onInheritParentColorChange={onInheritParentColorChange}
        onClose={() => setCreateFromStagedDialogOpen(false)}
        onConfirm={handleConfirmCreateFromStaged}
        isPending={createFromStagedPending}
      />

      {/* Division Preview Dialog */}
      <DivisionPreviewDialog
        division={previewDivision}
        geometry={previewGeometry}
        loading={previewLoading}
        onClose={() => setPreviewDivision(null)}
      />
    </>
  );
}

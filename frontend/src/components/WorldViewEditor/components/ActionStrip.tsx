import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
  CircularProgress,
} from '@mui/material';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import PaletteIcon from '@mui/icons-material/Palette';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import type { Region, RegionMember } from '../../../types';
import { useAppTheme } from '../../../theme';

export interface ActionStripProps {
  selectedRegion: Region | null;
  selectedMember: RegionMember | null;
  onClearMember: () => void;
  regions: Region[];
  regionMembers: RegionMember[];

  // Batch actions (region selected, no member)
  onOpenCustomSubdivision: () => void;
  onSplitAllMembers: () => void;
  isSplittingAllMembers: boolean;
  splitAllProgress: { current: number; total: number } | null;
  onFlattenAll: () => void;
  flattenPending: boolean;
  onPropagateColor: (region: Region) => void;
  addChildrenPending: boolean;
  updateRegionPending: boolean;

  // Per-member actions
  onAddChildren: (member: RegionMember) => void;
  onSplitDivision: (member: RegionMember) => void;
  onInheritMemberColor: (member: RegionMember) => void;
  onRemoveMember: (member: RegionMember) => void;
  removeMemberPending: boolean;
  deletePending: boolean;
}

export function ActionStrip({
  selectedRegion,
  selectedMember,
  onClearMember,
  regions,
  regionMembers,
  onOpenCustomSubdivision,
  onSplitAllMembers,
  isSplittingAllMembers,
  splitAllProgress,
  onFlattenAll,
  flattenPending,
  onPropagateColor,
  addChildrenPending,
  updateRegionPending,
  onAddChildren,
  onSplitDivision,
  onInheritMemberColor,
  onRemoveMember,
  removeMemberPending,
  deletePending,
}: ActionStripProps) {
  const { P } = useAppTheme();

  if (!selectedRegion) return null;

  const hasDivisionMembers = regionMembers.some(m => !m.isSubregion);
  const hasSubregionMembers = regionMembers.some(m => m.isSubregion);
  const hasChildRegions = regions.some(r => r.parentRegionId === selectedRegion.id);

  const stripBtnSx = {
    textTransform: 'none' as const,
    fontFamily: P.font.ui,
    fontSize: '0.68rem',
    fontWeight: 500,
    color: P.light.text,
    borderColor: P.light.border,
    py: 0.25,
    px: 1,
    minWidth: 0,
    '&:hover': { bgcolor: 'rgba(0,0,0,0.04)', borderColor: P.light.text },
  };

  const accentBtnSx = {
    ...stripBtnSx,
    color: P.accent.primary,
    borderColor: P.accent.primaryDim,
    '&:hover': { bgcolor: P.accent.primaryDim, borderColor: P.accent.primary },
  };

  const stripIconSx = {
    color: P.light.textMuted,
    '&:hover': { color: P.light.text, bgcolor: 'rgba(0,0,0,0.04)' },
  };

  // ── Member mode ──
  if (selectedMember) {
    return (
      <Box sx={{
        px: 2, py: 0.5,
        bgcolor: P.light.surface,
        borderBottom: `1px solid ${P.light.border}`,
        display: 'flex',
        gap: 0.75,
        alignItems: 'center',
        flexShrink: 0,
        minHeight: 36,
      }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          borderRight: `1px solid ${P.light.border}`, pr: 1.5, mr: 0.5,
        }}>
          <Typography sx={{
            fontFamily: P.font.ui,
            fontSize: '0.76rem',
            fontWeight: 600,
            color: P.light.text,
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {selectedMember.name}
          </Typography>
          <IconButton size="small" onClick={onClearMember} sx={{ p: 0.25, ...stripIconSx }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>

        {/* Division member actions */}
        {!selectedMember.isSubregion && (
          <>
            {selectedMember.hasChildren && (
              <Tooltip title="Split into child divisions">
                <span>
                  <Button
                    size="small" variant="outlined"
                    onClick={() => onAddChildren(selectedMember)}
                    disabled={addChildrenPending}
                    startIcon={<GroupAddIcon sx={{ fontSize: '14px !important' }} />}
                    sx={accentBtnSx}
                  >
                    Split Children
                  </Button>
                </span>
              </Tooltip>
            )}
            <Tooltip title="Cut into custom parts">
              <Button
                size="small" variant="outlined"
                onClick={() => onSplitDivision(selectedMember)}
                startIcon={<ContentCutIcon sx={{ fontSize: '14px !important' }} />}
                sx={stripBtnSx}
              >
                Cut
              </Button>
            </Tooltip>
          </>
        )}

        {/* Subregion member actions */}
        {selectedMember.isSubregion && (
          <>
            {selectedMember.color !== selectedRegion?.color && (
              <Tooltip title="Inherit parent color">
                <span>
                  <Button
                    size="small" variant="outlined"
                    onClick={() => onInheritMemberColor(selectedMember)}
                    disabled={updateRegionPending}
                    startIcon={<PaletteIcon sx={{ fontSize: '14px !important', color: selectedRegion?.color }} />}
                    sx={stripBtnSx}
                  >
                    Inherit Color
                  </Button>
                </span>
              </Tooltip>
            )}
            {regions.some(r => r.parentRegionId === selectedMember.id) && (
              <Tooltip title="Propagate color to children">
                <span>
                  <Button
                    size="small" variant="outlined"
                    onClick={() => {
                      const r = regions.find(reg => reg.id === selectedMember.id);
                      if (r) onPropagateColor(r);
                    }}
                    disabled={updateRegionPending}
                    startIcon={<FormatColorFillIcon sx={{ fontSize: '14px !important', color: selectedMember.color || '#3388ff' }} />}
                    sx={stripBtnSx}
                  >
                    Propagate Color
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        )}

        {/* Remove (always available) */}
        <Box sx={{ ml: 'auto' }}>
          <Tooltip title={selectedMember.isSubregion ? 'Delete subregion' : 'Remove member'}>
            <span>
              <IconButton
                size="small"
                onClick={() => onRemoveMember(selectedMember)}
                disabled={removeMemberPending || deletePending}
                sx={{ ...stripIconSx, '&:hover': { color: P.accent.danger, bgcolor: 'rgba(239,68,68,0.06)' } }}
              >
                <DeleteIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
    );
  }

  // ── Batch mode ── (region selected, no member selected)
  const showBatch = hasDivisionMembers || hasSubregionMembers || hasChildRegions;
  if (!showBatch) return null;

  return (
    <Box sx={{
      px: 2, py: 0.5,
      bgcolor: P.light.surface,
      borderBottom: `1px solid ${P.light.border}`,
      display: 'flex',
      gap: 0.75,
      alignItems: 'center',
      flexWrap: 'wrap',
      flexShrink: 0,
      minHeight: 36,
    }}>
      {hasDivisionMembers && (
        <>
          <Tooltip title="Create custom subregion groups">
            <Button
              size="small" variant="outlined"
              onClick={onOpenCustomSubdivision}
              startIcon={<UnfoldMoreIcon sx={{ fontSize: '14px !important' }} />}
              sx={stripBtnSx}
            >
              Group
            </Button>
          </Tooltip>
          <Tooltip title={
            isSplittingAllMembers && splitAllProgress
              ? `Splitting ${splitAllProgress.current}/${splitAllProgress.total}`
              : 'Replace each division with its GADM children'
          }>
            <span>
              <Button
                size="small" variant="outlined"
                onClick={onSplitAllMembers}
                disabled={isSplittingAllMembers || addChildrenPending}
                startIcon={isSplittingAllMembers
                  ? <CircularProgress size={12} sx={{ color: P.accent.primary }} />
                  : <AccountTreeIcon sx={{ fontSize: '14px !important' }} />
                }
                sx={accentBtnSx}
              >
                Split All
              </Button>
            </span>
          </Tooltip>
        </>
      )}
      {hasSubregionMembers && (
        <Tooltip title="Move divisions from subregions back to parent">
          <span>
            <Button
              size="small" variant="outlined"
              onClick={onFlattenAll}
              disabled={flattenPending}
              startIcon={<UnfoldLessIcon sx={{ fontSize: '14px !important' }} />}
              sx={stripBtnSx}
            >
              Flatten
            </Button>
          </span>
        </Tooltip>
      )}
      {hasChildRegions && (
        <Tooltip title="Apply this region's color to all children">
          <span>
            <IconButton
              size="small"
              onClick={() => onPropagateColor(selectedRegion)}
              disabled={updateRegionPending}
              sx={{ ml: 'auto', ...stripIconSx }}
            >
              <FormatColorFillIcon sx={{ fontSize: 16, color: selectedRegion.color || '#3388ff' }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Box>
  );
}

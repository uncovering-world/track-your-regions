import {
  Alert, Box, Button, Chip, CircularProgress, IconButton,
  LinearProgress, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import StopIcon from '@mui/icons-material/Stop';
import DrawIcon from '@mui/icons-material/Draw';
import LayersIcon from '@mui/icons-material/Layers';
import HubIcon from '@mui/icons-material/Hub';
import SettingsIcon from '@mui/icons-material/Settings';
import type { Region } from '../../../types';
import type { DisplayMode } from '../types';
import type { ComputationStatus } from '../../../api/types';

export interface ToolbarStyles {
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  uiFont: string;
  monoFont: string;
}

export interface ActionToolbarProps {
  selectedRegion: Region | null;
  displayMode: DisplayMode;
  showOptions: boolean;
  isComputing: boolean;
  isComputingSingleRegion: boolean;
  isResettingToGADM: boolean;
  regionsCount: number;
  geojsonHasFeatures: boolean;
  toolBtnSx: object;
  styles: ToolbarStyles;
  onToggleHull: (region: Region) => void;
  onComputeSingleRegion: () => void;
  onRedefineBoundaries: () => void;
  onResetToGADM: () => void;
  onSetDisplayMode: (m: DisplayMode) => void;
  onSetShowOptions: (s: boolean) => void;
  onOpenHullEditor: () => void;
  onStartComputation: () => void;
  onCancelComputation: () => void;
}

function RegionInfoBadge({ selectedRegion, styles, onToggleHull }: {
  selectedRegion: Region;
  styles: ToolbarStyles;
  onToggleHull: (r: Region) => void;
}) {
  const hullVariant = selectedRegion.usesHull ? 'filled' : 'outlined';
  const hullColor = selectedRegion.usesHull ? 'warning' : 'default';
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, mr: 1,
      borderRight: `1px solid ${styles.border}`, pr: 2,
    }}>
      <Box sx={{ width: 10, height: 10, bgcolor: selectedRegion.color || '#3388ff', borderRadius: '2px', border: '1px solid rgba(0,0,0,0.1)' }} />
      <Typography sx={{ fontFamily: styles.uiFont, fontWeight: 600, fontSize: '0.85rem', color: styles.text }}>
        {selectedRegion.name}
      </Typography>
      <Chip
        size="small"
        label="Hull"
        variant={hullVariant}
        color={hullColor}
        onClick={() => onToggleHull(selectedRegion)}
        sx={{ height: 20, fontSize: '0.65rem', cursor: 'pointer' }}
      />
      {selectedRegion.isCustomBoundary && <Chip size="small" label="Custom" sx={{ height: 20, fontSize: '0.65rem' }} color="info" />}
    </Box>
  );
}

function ResetGadmButton({ isResettingToGADM, isComputingSingleRegion, onResetToGADM, toolBtnSx }: {
  isResettingToGADM: boolean;
  isComputingSingleRegion: boolean;
  onResetToGADM: () => void;
  toolBtnSx: object;
}) {
  const startIcon = isResettingToGADM
    ? <CircularProgress size={12} />
    : <RefreshIcon sx={{ fontSize: '16px !important' }} />;
  return (
    <Tooltip title="Reset to original GADM divisions">
      <span>
        <Button
          size="small" variant="outlined" color="warning"
          onClick={onResetToGADM}
          disabled={isResettingToGADM || isComputingSingleRegion}
          startIcon={startIcon}
          sx={toolBtnSx}
        >
          Reset
        </Button>
      </span>
    </Tooltip>
  );
}

function HullDisplayControls({ displayMode, onSetDisplayMode, onOpenHullEditor, toolBtnSx, uiFont }: {
  displayMode: DisplayMode;
  onSetDisplayMode: (m: DisplayMode) => void;
  onOpenHullEditor: () => void;
  toolBtnSx: object;
  uiFont: string;
}) {
  const handleToggle = (_: unknown, v: DisplayMode | null) => {
    if (v !== null) onSetDisplayMode(v);
  };
  return (
    <>
      <ToggleButtonGroup
        size="small"
        value={displayMode}
        exclusive
        onChange={handleToggle}
        sx={{ ml: 0.5 }}
      >
        <ToggleButton value="real" sx={{ py: 0.25, px: 0.75, gap: 0.5 }}>
          <Tooltip title="Show actual island polygons"><LayersIcon sx={{ fontSize: 16 }} /></Tooltip>
          <Typography sx={{ fontSize: '0.65rem', fontFamily: uiFont, textTransform: 'none' }}>Islands</Typography>
        </ToggleButton>
        <ToggleButton value="hull" sx={{ py: 0.25, px: 0.75, gap: 0.5 }}>
          <Tooltip title="Show convex hull envelope"><HubIcon sx={{ fontSize: 16 }} /></Tooltip>
          <Typography sx={{ fontSize: '0.65rem', fontFamily: uiFont, textTransform: 'none' }}>Hull</Typography>
        </ToggleButton>
      </ToggleButtonGroup>
      <Tooltip title="Edit hull envelope parameters">
        <Button
          size="small" variant="outlined" color="warning"
          onClick={onOpenHullEditor}
          startIcon={<HubIcon sx={{ fontSize: '16px !important' }} />}
          sx={toolBtnSx}
        >
          Edit Hull
        </Button>
      </Tooltip>
    </>
  );
}

function RegionToolbarContent(props: ActionToolbarProps & { selectedRegion: Region }) {
  const {
    selectedRegion, displayMode, showOptions,
    isComputing, isComputingSingleRegion, isResettingToGADM,
    geojsonHasFeatures, toolBtnSx, styles,
    onToggleHull, onComputeSingleRegion, onRedefineBoundaries, onResetToGADM,
    onSetDisplayMode, onSetShowOptions, onOpenHullEditor,
  } = props;
  const computeTooltip = geojsonHasFeatures ? 'Recompute geometry from divisions' : 'Compute geometry';
  const computeIcon = isComputingSingleRegion
    ? <CircularProgress size={12} />
    : <RefreshIcon sx={{ fontSize: '16px !important' }} />;
  const computeLabel = isComputingSingleRegion ? 'Computing...' : 'Compute';
  const redefineColor = selectedRegion.isCustomBoundary ? 'info' : 'primary';
  const settingsIconColor = showOptions ? styles.primary : styles.textMuted;
  return (
    <>
      <RegionInfoBadge selectedRegion={selectedRegion} styles={styles} onToggleHull={onToggleHull} />
      <Tooltip title={computeTooltip}>
        <span>
          <Button
            size="small" variant="outlined" color="primary"
            onClick={onComputeSingleRegion}
            disabled={isComputingSingleRegion || isComputing}
            startIcon={computeIcon}
            sx={toolBtnSx}
          >
            {computeLabel}
          </Button>
        </span>
      </Tooltip>
      <Button
        size="small" variant="outlined"
        color={redefineColor}
        onClick={onRedefineBoundaries}
        startIcon={<DrawIcon sx={{ fontSize: '16px !important' }} />}
        sx={toolBtnSx}
      >
        Redefine
      </Button>
      {selectedRegion.isCustomBoundary && (
        <ResetGadmButton
          isResettingToGADM={isResettingToGADM}
          isComputingSingleRegion={isComputingSingleRegion}
          onResetToGADM={onResetToGADM}
          toolBtnSx={toolBtnSx}
        />
      )}
      {selectedRegion.usesHull && (
        <HullDisplayControls
          displayMode={displayMode}
          onSetDisplayMode={onSetDisplayMode}
          onOpenHullEditor={onOpenHullEditor}
          toolBtnSx={toolBtnSx}
          uiFont={styles.uiFont}
        />
      )}
      <Tooltip title="Computation options">
        <IconButton size="small" onClick={() => onSetShowOptions(!showOptions)} sx={{ ml: 'auto' }}>
          <SettingsIcon sx={{ fontSize: 16, color: settingsIconColor }} />
        </IconButton>
      </Tooltip>
    </>
  );
}

function EmptyToolbarContent({
  isComputing, regionsCount, toolBtnSx, styles,
  onStartComputation, onCancelComputation,
}: ActionToolbarProps) {
  const button = isComputing
    ? (
      <Button size="small" variant="outlined" color="error" onClick={onCancelComputation} startIcon={<StopIcon />} sx={toolBtnSx}>
        Cancel
      </Button>
    )
    : (
      <Button
        size="small" variant="outlined"
        onClick={onStartComputation}
        disabled={regionsCount === 0}
        startIcon={<RefreshIcon sx={{ fontSize: '16px !important' }} />}
        sx={toolBtnSx}
      >
        Compute All
      </Button>
    );
  return (
    <>
      <Typography sx={{ fontFamily: styles.uiFont, fontSize: '0.82rem', color: styles.textMuted, fontStyle: 'italic', flex: 1 }}>
        Select a region to view geometry
      </Typography>
      {button}
    </>
  );
}

export function ActionToolbar(props: ActionToolbarProps) {
  const { styles, selectedRegion } = props;
  return (
    <Box sx={{
      px: 2, py: 1,
      bgcolor: styles.surface,
      borderBottom: `1px solid ${styles.border}`,
      display: 'flex',
      gap: 1,
      alignItems: 'center',
      flexWrap: 'wrap',
      flexShrink: 0,
    }}>
      {selectedRegion
        ? <RegionToolbarContent {...props} selectedRegion={selectedRegion} />
        : <EmptyToolbarContent {...props} />}
    </Box>
  );
}

export interface BatchProgressSectionProps {
  isComputing: boolean;
  computationStatus: ComputationStatus | null;
  borderColor: string;
  uiFont: string;
  monoFont: string;
  mutedColor: string;
  onClearStatus: () => void;
}

function BatchProgressBar({ computationStatus, borderColor, uiFont, monoFont, mutedColor }: {
  computationStatus: ComputationStatus;
  borderColor: string;
  uiFont: string;
  monoFont: string;
  mutedColor: string;
}) {
  const percent = computationStatus.percent ?? 0;
  const memberCount = computationStatus.currentMembers ?? 0;
  const memberSuffix = memberCount > 0 ? ` (${memberCount} divisions)` : '';
  return (
    <Box sx={{ px: 2, py: 0.75, bgcolor: '#f0f7f6', borderBottom: `1px solid ${borderColor}`, flexShrink: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        <Box sx={{ flex: 1 }}>
          <LinearProgress variant="determinate" value={percent} sx={{ height: 4, borderRadius: 1 }} />
        </Box>
        <Typography sx={{ fontFamily: monoFont, fontSize: '0.65rem', color: mutedColor, minWidth: 36 }}>
          {percent}%
        </Typography>
      </Box>
      {computationStatus.currentRegion && (
        <Typography sx={{ fontFamily: uiFont, fontSize: '0.7rem', color: mutedColor }}>
          {computationStatus.currentRegion}{memberSuffix}
        </Typography>
      )}
    </Box>
  );
}

export function BatchProgressSection({
  isComputing, computationStatus, borderColor, uiFont, monoFont, mutedColor, onClearStatus,
}: BatchProgressSectionProps) {
  if (isComputing && computationStatus) {
    return (
      <BatchProgressBar
        computationStatus={computationStatus}
        borderColor={borderColor}
        uiFont={uiFont}
        monoFont={monoFont}
        mutedColor={mutedColor}
      />
    );
  }
  if (!isComputing && computationStatus?.status === 'Complete') {
    return (
      <Alert severity="success" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={onClearStatus}>
        Complete! Computed: {computationStatus.computed ?? 0}, Skipped: {computationStatus.skipped ?? 0}
      </Alert>
    );
  }
  if (!isComputing && computationStatus?.status === 'Cancelled') {
    return (
      <Alert severity="warning" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={onClearStatus}>
        Cancelled. Computed: {computationStatus.computed ?? 0}
      </Alert>
    );
  }
  return null;
}

export interface MapStateOverlayProps {
  selectedRegion: Region | null;
  geometryLoading: boolean;
  geojsonHasFeatures: boolean;
  isComputingSingleRegion: boolean;
  uiFont: string;
  bgColor: string;
  mutedColor: string;
  primaryColor: string;
  primaryHover: string;
  onComputeSingleRegion: () => void;
}

const DOT_PATTERN_BG = {
  backgroundImage: 'radial-gradient(circle, rgba(78,205,196,0.06) 1px, transparent 1px)',
  backgroundSize: '24px 24px',
} as const;

function pickOverlayKind(props: MapStateOverlayProps): 'loading' | 'no-region' | 'no-geom' | null {
  const { selectedRegion, geometryLoading, geojsonHasFeatures } = props;
  if (geometryLoading) return 'loading';
  if (!selectedRegion) return 'no-region';
  if (!geojsonHasFeatures) return 'no-geom';
  return null;
}

export function MapStateOverlay(props: MapStateOverlayProps) {
  const kind = pickOverlayKind(props);
  if (kind === null) return null;
  const { uiFont, bgColor, mutedColor, primaryColor, primaryHover, isComputingSingleRegion, onComputeSingleRegion } = props;
  if (kind === 'loading') {
    return (
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.7)', zIndex: 5 }}>
        <CircularProgress size={32} sx={{ color: primaryColor }} />
      </Box>
    );
  }
  if (kind === 'no-region') {
    return (
      <Box sx={{
        position: 'absolute', inset: 0,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        bgcolor: bgColor, ...DOT_PATTERN_BG, zIndex: 5,
      }}>
        <Typography sx={{ fontFamily: uiFont, fontSize: '0.9rem', color: mutedColor }}>
          Select a region from the sidebar
        </Typography>
      </Box>
    );
  }
  return (
    <Box sx={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      bgcolor: bgColor, ...DOT_PATTERN_BG, zIndex: 5,
    }}>
      <Typography sx={{ fontFamily: uiFont, fontSize: '0.85rem', color: mutedColor, mb: 1 }}>
        No geometry computed yet
      </Typography>
      <Button size="small" variant="contained" onClick={onComputeSingleRegion} disabled={isComputingSingleRegion}
        sx={{ textTransform: 'none', fontFamily: uiFont, bgcolor: primaryColor, '&:hover': { bgcolor: primaryHover } }}>
        Compute Now
      </Button>
    </Box>
  );
}

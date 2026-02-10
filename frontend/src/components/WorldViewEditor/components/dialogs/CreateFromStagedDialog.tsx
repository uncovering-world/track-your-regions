import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Checkbox,
  FormControlLabel,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import DrawIcon from '@mui/icons-material/Draw';
import type { AdministrativeDivision, Region } from '../../../../types';
import { CustomBoundaryDialog } from '../../../CustomBoundaryDialog';
import { fetchDivisionGeometry } from '../../../../api';

export interface CreateFromStagedResult {
  name: string;
  inheritParentColor: boolean;
  customGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

interface CreateFromStagedDialogProps {
  open: boolean;
  stagedDivisions: AdministrativeDivision[];
  selectedRegion: Region | null;
  inheritParentColor: boolean;
  onInheritParentColorChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: (result: CreateFromStagedResult) => void;
  isPending: boolean;
}

export function CreateFromStagedDialog({
  open,
  stagedDivisions,
  selectedRegion,
  inheritParentColor,
  onInheritParentColorChange,
  onClose,
  onConfirm,
  isPending,
}: CreateFromStagedDialogProps) {
  // Internal state — previously in parent
  const [regionName, setRegionName] = useState('');
  const [useCustomBoundary, setUseCustomBoundary] = useState(false);
  const [customBoundaryGeometry, setCustomBoundaryGeometry] = useState<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(null);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [sourceGeometries, setSourceGeometries] = useState<GeoJSON.FeatureCollection | null>(null);

  // Initialize region name from common prefix when dialog opens
  // (using stagedDivisions which are set before dialog opens)
  const initializeName = useCallback(() => {
    if (stagedDivisions.length > 0 && !regionName) {
      const names = stagedDivisions.map(d => d.name);
      const prefix = findCommonPrefix(names);
      if (prefix) {
        setRegionName(prefix);
      }
    }
  }, [stagedDivisions, regionName]);

  // Call on each render when open (cheap, sets state only if needed)
  if (open && stagedDivisions.length > 0 && !regionName) {
    initializeName();
  }

  const handleClose = () => {
    setRegionName('');
    setUseCustomBoundary(false);
    setCustomBoundaryGeometry(null);
    setSourceGeometries(null);
    onClose();
  };

  const handleConfirm = () => {
    if (!regionName.trim() || (useCustomBoundary && !customBoundaryGeometry)) return;

    onConfirm({
      name: regionName.trim(),
      inheritParentColor,
      customGeometry: useCustomBoundary ? customBoundaryGeometry ?? undefined : undefined,
    });

    // Clear internal state after confirm
    setRegionName('');
    setUseCustomBoundary(false);
    setCustomBoundaryGeometry(null);
    setSourceGeometries(null);
  };

  const handleDrawBoundary = useCallback(async () => {
    // Fetch geometries for staged divisions
    const features: GeoJSON.Feature[] = [];
    for (const division of stagedDivisions) {
      try {
        const geom = await fetchDivisionGeometry(division.id, 1);
        if (geom) {
          features.push(geom as unknown as GeoJSON.Feature);
        }
      } catch (e) {
        console.error('Failed to fetch geometry for division', division.id, e);
      }
    }
    setSourceGeometries({ type: 'FeatureCollection', features });
    setDrawingOpen(true);
  }, [stagedDivisions]);

  return (
    <>
      <Dialog
        open={open && !drawingOpen}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Create Region from Staged Divisions
          <Typography variant="body2" color="text.secondary">
            Create a new region containing {stagedDivisions.length} selected administrative divisions
          </Typography>
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Region Name"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            placeholder="Enter a name for the new region"
          />
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Divisions to include:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
            {stagedDivisions.map(division => (
              <Chip
                key={division.id}
                label={division.name}
                size="small"
                variant="outlined"
              />
            ))}
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={inheritParentColor}
                onChange={(e) => onInheritParentColorChange(e.target.checked)}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2">Inherit parent color</Typography>
                {selectedRegion?.color && (
                  <Box
                    sx={{
                      width: 16,
                      height: 16,
                      backgroundColor: selectedRegion.color,
                      borderRadius: 0.5,
                      border: '1px solid rgba(0,0,0,0.2)',
                    }}
                  />
                )}
              </Box>
            }
          />

          {/* Custom boundary option */}
          <Divider sx={{ my: 2 }} />
          <FormControlLabel
            control={
              <Checkbox
                checked={useCustomBoundary}
                onChange={(e) => {
                  setUseCustomBoundary(e.target.checked);
                  if (!e.target.checked) {
                    setCustomBoundaryGeometry(null);
                  }
                }}
              />
            }
            label={
              <Typography variant="body2">
                Draw custom boundary (for partial divisions)
              </Typography>
            }
          />
          {useCustomBoundary && (
            <Box sx={{ ml: 4, mt: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Draw a polygon to define a custom boundary. The polygon will be intersected with the source divisions.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={handleDrawBoundary}
                startIcon={<DrawIcon />}
              >
                {customBoundaryGeometry ? 'Edit Boundary' : 'Draw Boundary'}
              </Button>
              {customBoundaryGeometry && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  Custom boundary defined
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={isPending || !regionName.trim() || (useCustomBoundary && !customBoundaryGeometry)}
          >
            {isPending
              ? 'Creating...'
              : `Create Region with ${stagedDivisions.length} Divisions`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Custom Boundary Drawing Dialog */}
      <CustomBoundaryDialog
        open={drawingOpen}
        onClose={() => setDrawingOpen(false)}
        onConfirm={(geometry) => {
          setCustomBoundaryGeometry(geometry);
          setDrawingOpen(false);
        }}
        sourceGeometries={sourceGeometries}
        title={`Redefine Boundaries for "${regionName || 'New Region'}"`}
      />
    </>
  );
}

// Helper function to find common prefix in an array of strings
function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  const minLen = Math.min(...strings.map(s => s.length));

  let prefix = '';
  for (let i = 0; i < minLen; i++) {
    const char = strings[0][i];
    if (strings.every(s => s[i] === char)) {
      prefix += char;
    } else {
      break;
    }
  }

  return prefix.replace(/[\s\-_,.:;]+$/, '').trim();
}

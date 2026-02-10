import { useState, useEffect, useCallback } from 'react';
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
  Alert,
  CircularProgress,
} from '@mui/material';
import DrawIcon from '@mui/icons-material/Draw';
import type { AdministrativeDivision, Region } from '../../../../types';
import { CustomBoundaryDialog } from '../../../CustomBoundaryDialog';
import { fetchDivisionGeometry } from '../../../../api';

export interface SingleDivisionCustomResult {
  name: string;
  inheritParentColor: boolean;
  customGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  divisionId: number;
}

interface SingleDivisionCustomDialogProps {
  division: AdministrativeDivision | null;
  selectedRegion: Region | null;
  inheritParentColor: boolean;
  onInheritParentColorChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: (result: SingleDivisionCustomResult) => void;
  isPending: boolean;
}

export function SingleDivisionCustomDialog({
  division,
  selectedRegion,
  inheritParentColor,
  onInheritParentColorChange,
  onClose,
  onConfirm,
  isPending,
}: SingleDivisionCustomDialogProps) {
  // Internal state — previously in parent
  const [regionName, setRegionName] = useState('');
  const [customGeometry, setCustomGeometry] = useState<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(null);
  const [sourceGeometry, setSourceGeometry] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadingGeometry, setLoadingGeometry] = useState(false);

  // Fetch division geometry when dialog opens
  useEffect(() => {
    if (!division) return;

    let cancelled = false;
    setLoadingGeometry(true);
    setRegionName(division.name);
    setCustomGeometry(null);
    setSourceGeometry(null);

    (async () => {
      try {
        const geom = await fetchDivisionGeometry(division.id, 1);
        if (cancelled) return;
        if (geom) {
          setSourceGeometry({
            type: 'FeatureCollection',
            features: [geom as unknown as GeoJSON.Feature],
          });
        }
      } catch (e) {
        console.error('Failed to fetch geometry for division', division.id, e);
      } finally {
        if (!cancelled) setLoadingGeometry(false);
      }
    })();

    return () => { cancelled = true; };
  }, [division]);

  const handleClose = () => {
    setRegionName('');
    setCustomGeometry(null);
    setSourceGeometry(null);
    onClose();
  };

  const handleConfirm = useCallback(() => {
    if (!division || !customGeometry) return;

    onConfirm({
      name: regionName.trim() || division.name,
      inheritParentColor,
      customGeometry,
      divisionId: division.id,
    });
  }, [division, customGeometry, regionName, inheritParentColor, onConfirm]);

  // Two stages: drawing (customGeometry is null) → confirmation (customGeometry is set)
  const isDrawingStage = !!division && !customGeometry;
  const isConfirmStage = !!division && !!customGeometry;

  return (
    <>
      {/* Stage 1: Drawing boundary */}
      {!loadingGeometry ? (
        <CustomBoundaryDialog
          open={isDrawingStage}
          onClose={handleClose}
          onConfirm={(geometry) => {
            setCustomGeometry(geometry);
          }}
          sourceGeometries={sourceGeometry}
          title={`Draw Boundary for "${regionName || division?.name || 'New Region'}"`}
        />
      ) : (
        <Dialog open={!!division} onClose={handleClose} maxWidth="sm" fullWidth>
          <DialogContent>
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          </DialogContent>
        </Dialog>
      )}

      {/* Stage 2: Confirmation dialog */}
      <Dialog
        open={isConfirmStage}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Confirm Custom Region
          <Typography variant="body2" color="text.secondary">
            Custom boundary drawn from: {division?.name}
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
            placeholder={division?.name || 'Enter a name'}
          />

          <Alert severity="success" sx={{ mb: 2 }}>
            Custom boundary defined. Click "Create" to add this region.
          </Alert>

          <Button
            variant="outlined"
            size="small"
            onClick={() => setCustomGeometry(null)}
            startIcon={<DrawIcon />}
            sx={{ mb: 2 }}
          >
            Redraw Boundary
          </Button>

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
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? 'Creating...' : 'Create Region'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

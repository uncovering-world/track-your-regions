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
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
} from '@mui/material';
import DrawIcon from '@mui/icons-material/Draw';
import DeleteIcon from '@mui/icons-material/Delete';
import * as turf from '@turf/turf';
import type { Region, RegionMember } from '../../../../types';
import { CustomBoundaryDialog } from '../../../CustomBoundaryDialog';
import {
  fetchRegionMemberGeometries,
  fetchDivisionGeometry,
  addDivisionsToRegion,
  removeDivisionsFromRegion,
} from '../../../../api';

export interface SplitPart {
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

interface SplitDivisionDialogProps {
  member: RegionMember | null;
  selectedRegion: Region | null;
  onClose: () => void;
  onComplete: () => void;
}

export function SplitDivisionDialog({
  member,
  selectedRegion,
  onClose,
  onComplete,
}: SplitDivisionDialogProps) {
  const [splitParts, setSplitParts] = useState<SplitPart[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [divisionGeometry, setDivisionGeometry] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadingGeometry, setLoadingGeometry] = useState(false);

  // Fetch division geometry when dialog opens
  useEffect(() => {
    if (!member || !selectedRegion) return;

    let cancelled = false;
    setLoadingGeometry(true);
    setSplitParts([]);
    setDivisionGeometry(null);

    (async () => {
      try {
        let geometry: GeoJSON.Geometry | null = null;

        // If member has custom geometry, fetch it from member geometries
        if (member.hasCustomGeometry && member.memberRowId) {
          const memberGeoms = await fetchRegionMemberGeometries(selectedRegion.id);
          if (memberGeoms) {
            const memberFeature = memberGeoms.features.find(
              f => f.properties?.memberRowId === member.memberRowId
            );
            if (memberFeature?.geometry) {
              geometry = memberFeature.geometry;
            }
          }
        }

        // Fallback to original GADM geometry
        if (!geometry) {
          const geom = await fetchDivisionGeometry(member.id, 1);
          if (geom?.geometry) {
            geometry = geom.geometry as GeoJSON.Geometry;
          }
        }

        if (cancelled) return;

        if (geometry) {
          setDivisionGeometry({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: { id: member.id, name: member.name, memberRowId: member.memberRowId },
              geometry,
            }],
          });
        }
      } catch (e) {
        console.error('Failed to fetch division geometry:', e);
      } finally {
        if (!cancelled) setLoadingGeometry(false);
      }
    })();

    return () => { cancelled = true; };
  }, [member, selectedRegion]);

  // Confirm handler — remove original division and add parts
  const handleConfirm = useCallback(async () => {
    if (!selectedRegion || !member) return;

    setIsCreating(true);
    try {
      // Remove the original division from the region
      await removeDivisionsFromRegion(selectedRegion.id, [member.id]);

      // Add each part as a division member with custom geometry
      for (const part of splitParts) {
        await addDivisionsToRegion(selectedRegion.id, [member.id], {
          customGeometry: part.geometry,
          customName: part.name,
        });
      }

      onComplete();
    } catch (e) {
      console.error('Failed to split division:', e);
      alert('Failed to split division');
    } finally {
      setIsCreating(false);
    }
  }, [selectedRegion, member, splitParts, onComplete]);

  const handleClose = () => {
    setSplitParts([]);
    onClose();
  };

  // Calculate remaining geometry to check if there's area left
  let remainingArea = 0;
  let remainingGeometry: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null = null;

  if (divisionGeometry?.features?.length && splitParts.length > 0) {
    try {
      let remaining = divisionGeometry.features[0] as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
      for (const part of splitParts) {
        const partFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
          type: 'Feature',
          properties: {},
          geometry: part.geometry,
        };
        const fc = turf.featureCollection([remaining, partFeature]);
        const diff = turf.difference(fc);
        if (diff) {
          remaining = diff as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
        } else {
          remaining = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } } as GeoJSON.Feature<GeoJSON.Polygon>;
        }
      }
      remainingGeometry = remaining;
      remainingArea = remaining?.geometry ? turf.area(remaining) : 0;
    } catch {
      remainingArea = 0;
    }
  } else if (divisionGeometry?.features?.length) {
    // No parts yet, full area remaining
    remainingArea = Infinity;
  }

  const hasRemainingArea = remainingArea > 1000; // More than 1000 sq meters

  // Calculate source geometries for the drawing dialog (remaining after subtracting drawn parts)
  const getSourceGeometries = useCallback((): GeoJSON.FeatureCollection | null => {
    if (!divisionGeometry?.features?.length) return null;
    if (splitParts.length === 0) return divisionGeometry;

    try {
      let remaining = divisionGeometry.features[0] as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
      for (const part of splitParts) {
        const partFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
          type: 'Feature',
          properties: {},
          geometry: part.geometry,
        };
        const fc = turf.featureCollection([remaining, partFeature]);
        const diff = turf.difference(fc);
        if (diff) {
          remaining = diff as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
        }
      }
      return { type: 'FeatureCollection' as const, features: [remaining] };
    } catch (e) {
      console.error('Failed to calculate remaining geometry:', e);
      return divisionGeometry;
    }
  }, [divisionGeometry, splitParts]);

  return (
    <>
      <Dialog
        open={!!member && !drawingOpen}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Split Division: {member?.name}
          <Typography variant="body2" color="text.secondary">
            Draw boundaries to split this division into multiple subregions
          </Typography>
        </DialogTitle>
        <DialogContent>
          {loadingGeometry ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  Click "Draw Part" to draw each piece. Each part will become a separate subregion.
                </Typography>
              </Alert>

              {/* List of created parts */}
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2">
                    Parts ({splitParts.length}):
                  </Typography>
                  <Tooltip title={!hasRemainingArea && splitParts.length > 0 ? "No remaining area to draw" : ""}>
                    <span>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<DrawIcon />}
                        onClick={() => setDrawingOpen(true)}
                        disabled={!hasRemainingArea && splitParts.length > 0}
                      >
                        Draw Part {splitParts.length + 1}
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
                {splitParts.length === 0 ? (
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                      No parts yet. Click "Draw Part" to start.
                    </Typography>
                  </Paper>
                ) : (
                  <List dense>
                    {splitParts.map((part, idx) => (
                      <ListItem
                        key={idx}
                        secondaryAction={
                          <IconButton
                            size="small"
                            onClick={() => setSplitParts(prev => prev.filter((_, i) => i !== idx))}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        }
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <Box
                            sx={{
                              width: 16,
                              height: 16,
                              backgroundColor: `hsl(${(idx * 60) % 360}, 70%, 50%)`,
                              borderRadius: 0.5,
                            }}
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <TextField
                              size="small"
                              defaultValue={part.name}
                              onBlur={(e) => {
                                const newName = e.target.value.trim();
                                if (newName && newName !== part.name) {
                                  setSplitParts(prev => prev.map((p, i) =>
                                    i === idx ? { ...p, name: newName } : p
                                  ));
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              variant="standard"
                              fullWidth
                              placeholder="Part name"
                            />
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                )}

                {/* Use remaining area button - only show if we have parts and remaining area */}
                {splitParts.length > 0 && hasRemainingArea && remainingGeometry && (
                  <Box sx={{ mt: 1 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      fullWidth
                      onClick={() => {
                        if (remainingGeometry?.geometry) {
                          const partName = `${member?.name} - Part ${splitParts.length + 1}`;
                          setSplitParts(prev => [...prev, {
                            name: partName,
                            geometry: remainingGeometry.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
                          }]);
                        }
                      }}
                    >
                      Use Remaining Area as Part {splitParts.length + 1}
                    </Button>
                  </Box>
                )}

                {/* Show message when no remaining area */}
                {splitParts.length > 0 && !hasRemainingArea && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    All area has been assigned to parts.
                  </Alert>
                )}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={splitParts.length === 0 || isCreating}
            onClick={handleConfirm}
          >
            {isCreating ? 'Creating...' : `Create ${splitParts.length} Part(s)`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Drawing dialog for a single part */}
      <CustomBoundaryDialog
        open={drawingOpen}
        onClose={() => setDrawingOpen(false)}
        onConfirm={(geometry) => {
          const partName = `${member?.name} - Part ${splitParts.length + 1}`;
          setSplitParts(prev => [...prev, { name: partName, geometry }]);
          setDrawingOpen(false);
        }}
        sourceGeometries={getSourceGeometries()}
        title={`Draw Part ${splitParts.length + 1} of "${member?.name}"${splitParts.length > 0 ? ' (already drawn parts are excluded)' : ''}`}
      />
    </>
  );
}

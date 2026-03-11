/**
 * GuidedCvMatchDialog — 3-step clickable map wizard for guided CV matching.
 *
 * Steps:
 * 1. Water — user clicks ocean/lake areas (blue dots)
 * 2. Parks — user clicks park overlays (green dots, optional)
 * 3. Regions — user clicks each child region one at a time (colored labeled dots)
 * 4. Matching — progress via SSE
 * 5. Done — calls onComplete(result)
 */

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Alert,
  Box,
  LinearProgress,
  Chip,
} from '@mui/material';
import {
  prepareGuidedMatch,
  guidedMatchWithProgress,
  type ColorMatchResult,
  type GuidedMatchPoint,
} from '../../api/adminWorldViewImport';

// =============================================================================
// Types
// =============================================================================

interface Point {
  x: number;
  y: number;
}

interface RegionSeed extends Point {
  regionId: number;
  regionName: string;
}

type WizardStep = 'water' | 'parks' | 'regions' | 'matching' | 'done';

export interface GuidedCvMatchDialogProps {
  open: boolean;
  onClose: () => void;
  regionMapUrl: string;
  regionName: string;
  childRegions: Array<{ id: number; name: string }>;
  worldViewId: number;
  regionId: number;
  onComplete: (result: ColorMatchResult) => void;
}

// =============================================================================
// Color palette for region dots (HSL with evenly spaced hues)
// =============================================================================

function getRegionColor(index: number, total: number): string {
  const hue = Math.round((index / Math.max(total, 1)) * 360);
  return `hsl(${hue}, 80%, 50%)`;
}

// =============================================================================
// Dot overlay component
// =============================================================================

interface DotOverlayProps {
  waterPoints: Point[];
  parkPoints: Point[];
  regionSeeds: RegionSeed[];
  imgNaturalWidth: number;
  imgNaturalHeight: number;
  totalRegions: number;
}

function DotOverlay({ waterPoints, parkPoints, regionSeeds, imgNaturalWidth, imgNaturalHeight, totalRegions }: DotOverlayProps) {
  if (imgNaturalWidth === 0 || imgNaturalHeight === 0) return null;

  return (
    <>
      {waterPoints.map((pt, i) => (
        <Box
          key={`water-${i}`}
          sx={{
            position: 'absolute',
            left: `${(pt.x / imgNaturalWidth) * 100}%`,
            top: `${(pt.y / imgNaturalHeight) * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: '#1565c0',
            border: '2px solid #fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ))}
      {parkPoints.map((pt, i) => (
        <Box
          key={`park-${i}`}
          sx={{
            position: 'absolute',
            left: `${(pt.x / imgNaturalWidth) * 100}%`,
            top: `${(pt.y / imgNaturalHeight) * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: '#2e7d32',
            border: '2px solid #fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ))}
      {regionSeeds.map((seed, i) => {
        const color = getRegionColor(i, totalRegions);
        return (
          <Box
            key={`region-${seed.regionId}-${i}`}
            sx={{
              position: 'absolute',
              left: `${(seed.x / imgNaturalWidth) * 100}%`,
              top: `${(seed.y / imgNaturalHeight) * 100}%`,
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: color,
                border: '2px solid #fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                flexShrink: 0,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                bgcolor: 'rgba(255,255,255,0.9)',
                px: 0.5,
                borderRadius: 0.5,
                fontSize: '0.6rem',
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              {seed.regionName}
            </Typography>
          </Box>
        );
      })}
    </>
  );
}

// =============================================================================
// Main dialog component
// =============================================================================

export default function GuidedCvMatchDialog({
  open,
  onClose,
  regionMapUrl,
  regionName,
  childRegions,
  worldViewId,
  regionId,
  onComplete,
}: GuidedCvMatchDialogProps) {
  const [step, setStep] = useState<WizardStep>('water');
  const [waterPoints, setWaterPoints] = useState<Point[]>([]);
  const [parkPoints, setParkPoints] = useState<Point[]>([]);
  const [regionSeeds, setRegionSeeds] = useState<RegionSeed[]>([]);
  const [currentRegionIdx, setCurrentRegionIdx] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [imgNaturalWidth, setImgNaturalWidth] = useState(0);
  const [imgNaturalHeight, setImgNaturalHeight] = useState(0);

  // Reset state when dialog opens
  const handleEnter = useCallback(() => {
    setStep('water');
    setWaterPoints([]);
    setParkPoints([]);
    setRegionSeeds([]);
    setCurrentRegionIdx(0);
    setProgressText('');
    setError(null);
    setImgNaturalWidth(0);
    setImgNaturalHeight(0);
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgNaturalWidth(img.naturalWidth);
    setImgNaturalHeight(img.naturalHeight);
  }, []);

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (step === 'matching' || step === 'done') return;

    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * img.naturalWidth);
    const y = Math.round((e.clientY - rect.top) / rect.height * img.naturalHeight);

    if (step === 'water') {
      setWaterPoints(prev => [...prev, { x, y }]);
    } else if (step === 'parks') {
      setParkPoints(prev => [...prev, { x, y }]);
    } else if (step === 'regions') {
      if (currentRegionIdx >= childRegions.length) return;
      const region = childRegions[currentRegionIdx];
      setRegionSeeds(prev => [...prev, { x, y, regionId: region.id, regionName: region.name }]);
      // Auto-advance to next region
      if (currentRegionIdx < childRegions.length - 1) {
        setCurrentRegionIdx(prev => prev + 1);
      }
    }
  }, [step, currentRegionIdx, childRegions]);

  // undo last region seed
  const handleUndo = useCallback(() => {
    if (regionSeeds.length === 0) return;
    setRegionSeeds(prev => prev.slice(0, -1));
    // Go back one region (but not below 0)
    setCurrentRegionIdx(prev => Math.max(0, prev - 1));
  }, [regionSeeds.length]);

  const handleStartMatching = useCallback(async () => {
    setStep('matching');
    setError(null);
    setProgressText('Preparing...');

    try {
      const seeds = {
        waterPoints: waterPoints as GuidedMatchPoint[],
        parkPoints: parkPoints as GuidedMatchPoint[],
        regionSeeds: regionSeeds.map(s => ({ x: s.x, y: s.y, regionId: s.regionId })),
      };

      const sessionId = await prepareGuidedMatch(worldViewId, regionId, seeds);
      setProgressText('Starting guided match...');

      const result = await guidedMatchWithProgress(worldViewId, sessionId, (event) => {
        if (event.type === 'progress' && event.step) {
          setProgressText(event.step);
        } else if (event.type === 'error') {
          setError(event.message ?? 'Match failed');
        }
      });

      setStep('done');
      onComplete(result);
    } catch (err) {
      setError(String(err));
      setStep('regions');
    }
  }, [waterPoints, parkPoints, regionSeeds, worldViewId, regionId, onComplete]);

  // Step indicator label
  const stepLabels: Record<WizardStep, string> = {
    water: 'Step 1/3: Water',
    parks: 'Step 2/3: Parks',
    regions: 'Step 3/3: Regions',
    matching: 'Matching...',
    done: 'Done',
  };

  // Current prompt region
  const currentRegion = step === 'regions' && currentRegionIdx < childRegions.length
    ? childRegions[currentRegionIdx]
    : null;

  // Whether all regions have been clicked
  const allRegionsMarked = regionSeeds.length === childRegions.length;

  const isClickable = step === 'water' || step === 'parks' || (step === 'regions' && !allRegionsMarked);

  return (
    <Dialog
      open={open}
      onClose={step === 'matching' ? undefined : onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ transition: { onEnter: handleEnter } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
        <Box>
          Guided CV Match — {regionName}
        </Box>
        <Chip label={stepLabels[step]} size="small" variant="outlined" color="primary" />
      </DialogTitle>

      <DialogContent sx={{ pb: 1 }}>
        {/* Instruction banner */}
        {step === 'water' && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Click on <strong>water/ocean areas</strong> on the map. Click multiple times to mark all water bodies (ocean, lakes, rivers).
            Press <strong>Done</strong> when finished, or <strong>No water</strong> if there is none.
          </Alert>
        )}
        {step === 'parks' && (
          <Alert severity="success" sx={{ mb: 1.5 }}>
            Click on <strong>park overlays</strong> (dark green areas) if any are visible on the map.
            Press <strong>Done</strong> when finished, or <strong>Skip</strong> if there are no parks.
          </Alert>
        )}
        {step === 'regions' && currentRegion && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            Click on the area for <strong>{currentRegion.name}</strong> on the map.
            {childRegions.length > 1 && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                {regionSeeds.length}/{childRegions.length} regions marked
              </Typography>
            )}
          </Alert>
        )}
        {step === 'regions' && allRegionsMarked && (
          <Alert severity="success" sx={{ mb: 1.5 }}>
            All {childRegions.length} regions marked. Press <strong>Start Matching</strong> to begin.
          </Alert>
        )}
        {step === 'matching' && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {progressText}
          </Alert>
        )}
        {step === 'done' && (
          <Alert severity="success" sx={{ mb: 1.5 }}>
            Match complete.
          </Alert>
        )}

        {/* Error display */}
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}

        {/* Map image container */}
        {step !== 'done' && (
          <Box
            sx={{
              position: 'relative',
              display: 'inline-block',
              width: '100%',
              lineHeight: 0,
            }}
          >
            <Box
              component="img"
              src={regionMapUrl}
              alt={`Map of ${regionName}`}
              onLoad={handleImageLoad}
              onClick={isClickable ? handleImageClick : undefined}
              sx={{
                maxWidth: '100%',
                width: '100%',
                height: 'auto',
                display: 'block',
                cursor: isClickable ? 'crosshair' : 'default',
                userSelect: 'none',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            />
            <DotOverlay
              waterPoints={waterPoints}
              parkPoints={parkPoints}
              regionSeeds={regionSeeds}
              imgNaturalWidth={imgNaturalWidth}
              imgNaturalHeight={imgNaturalHeight}
              totalRegions={childRegions.length}
            />
          </Box>
        )}

        {/* Progress bar during matching */}
        {step === 'matching' && (
          <LinearProgress sx={{ mt: 2 }} />
        )}

        {/* Region progress indicator */}
        {step === 'regions' && childRegions.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {childRegions.map((r, i) => {
              const isMarked = i < regionSeeds.length;
              const isCurrent = i === currentRegionIdx && !allRegionsMarked;
              const color = isMarked ? getRegionColor(i, childRegions.length) : undefined;
              return (
                <Chip
                  key={r.id}
                  label={r.name}
                  size="small"
                  variant={isCurrent ? 'filled' : isMarked ? 'filled' : 'outlined'}
                  sx={{
                    bgcolor: isMarked ? color : undefined,
                    color: isMarked ? '#fff' : isCurrent ? 'warning.main' : undefined,
                    borderColor: isCurrent ? 'warning.main' : undefined,
                    fontWeight: isCurrent ? 700 : undefined,
                    fontSize: '0.65rem',
                  }}
                />
              );
            })}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        {/* Step 1 — Water */}
        {step === 'water' && (
          <>
            <Button onClick={() => { setWaterPoints([]); setStep('parks'); }} color="secondary">
              No water
            </Button>
            <Button onClick={() => setStep('parks')} variant="contained" disabled={waterPoints.length === 0}>
              Done ({waterPoints.length} points)
            </Button>
          </>
        )}

        {/* Step 2 — Parks */}
        {step === 'parks' && (
          <>
            <Button onClick={() => { setParkPoints([]); setStep('regions'); }} color="secondary">
              Skip
            </Button>
            <Button onClick={() => setStep('regions')} variant="contained" disabled={parkPoints.length === 0}>
              Done ({parkPoints.length} points)
            </Button>
          </>
        )}

        {/* Step 3 — Regions */}
        {step === 'regions' && (
          <>
            <Button
              onClick={handleUndo}
              disabled={regionSeeds.length === 0}
              color="warning"
            >
              Undo last
            </Button>
            <Button
              onClick={handleStartMatching}
              variant="contained"
              color="success"
              disabled={!allRegionsMarked}
            >
              Start Matching
            </Button>
          </>
        )}

        {/* Matching phase — no buttons */}
        {step === 'matching' && null}

        {/* Cancel / Close */}
        {step !== 'matching' && step !== 'done' && (
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
        )}
        {step === 'done' && (
          <Button onClick={onClose} variant="outlined">
            Close
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

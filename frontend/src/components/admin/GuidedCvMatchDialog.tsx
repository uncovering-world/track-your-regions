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

import { useState, useCallback, useRef } from 'react';
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
  color: string; // hex color sampled from the map image at click point
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
// Dot overlay component
// =============================================================================

interface DotOverlayProps {
  waterPoints: Point[];
  parkPoints: Point[];
  regionSeeds: RegionSeed[];
  imgNaturalWidth: number;
  imgNaturalHeight: number;
}

function DotOverlay({ waterPoints, parkPoints, regionSeeds, imgNaturalWidth, imgNaturalHeight }: DotOverlayProps) {
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
            width: 12,
            height: 12,
            borderRadius: '50%',
            bgcolor: pt.color,
            border: '2px solid #1565c0',
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
            width: 12,
            height: 12,
            borderRadius: '50%',
            bgcolor: pt.color,
            border: '2px solid #2e7d32',
            boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ))}
      {regionSeeds.map((seed, i) => {
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
                bgcolor: seed.color,
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sample pixel color from the hidden canvas at natural image coordinates
  const sampleColor = useCallback((x: number, y: number): string => {
    const canvas = canvasRef.current;
    if (!canvas) return '#888888';
    const ctx = canvas.getContext('2d');
    if (!ctx) return '#888888';
    try {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch {
      // Canvas tainted by cross-origin image — fall back to gray
      return '#888888';
    }
  }, []);

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
    canvasRef.current = null;
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgNaturalWidth(img.naturalWidth);
    setImgNaturalHeight(img.naturalHeight);
    // Try to draw onto canvas for color sampling.
    // First attempt: draw the displayed <img> directly (works for same-origin).
    // If tainted (cross-origin), re-fetch via a CORS-enabled Image element.
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    try {
      ctx.getImageData(0, 0, 1, 1); // test if canvas is tainted
      canvasRef.current = canvas;
    } catch {
      // Canvas tainted — re-fetch with CORS
      const corsImg = new Image();
      corsImg.crossOrigin = 'anonymous';
      corsImg.onload = () => {
        const c2 = document.createElement('canvas');
        c2.width = corsImg.naturalWidth;
        c2.height = corsImg.naturalHeight;
        const ctx2 = c2.getContext('2d');
        if (ctx2) {
          ctx2.drawImage(corsImg, 0, 0);
          canvasRef.current = c2;
        }
      };
      corsImg.src = img.src;
    }
  }, []);

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (step === 'matching' || step === 'done') return;

    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * img.naturalWidth);
    const y = Math.round((e.clientY - rect.top) / rect.height * img.naturalHeight);
    const color = sampleColor(x, y);

    if (step === 'water') {
      setWaterPoints(prev => [...prev, { x, y, color }]);
    } else if (step === 'parks') {
      setParkPoints(prev => [...prev, { x, y, color }]);
    } else if (step === 'regions') {
      if (currentRegionIdx >= childRegions.length) return;
      const region = childRegions[currentRegionIdx];
      setRegionSeeds(prev => [...prev, { x, y, color, regionId: region.id, regionName: region.name }]);
      // Auto-advance to next region
      if (currentRegionIdx < childRegions.length - 1) {
        setCurrentRegionIdx(prev => prev + 1);
      }
    }
  }, [step, currentRegionIdx, childRegions, sampleColor]);

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
                width: '100%',
                height: 'auto',
                display: 'block',
                cursor: isClickable ? 'crosshair' : 'default',
                userSelect: 'none',
                borderRadius: 1,
              }}
            />
            <DotOverlay
              waterPoints={waterPoints}
              parkPoints={parkPoints}
              regionSeeds={regionSeeds}
              imgNaturalWidth={imgNaturalWidth}
              imgNaturalHeight={imgNaturalHeight}
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
              const color = isMarked ? regionSeeds[i]?.color : undefined;
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

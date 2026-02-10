import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  fetchWorldViewComputationStatus,
  fetchDisplayGeometryStatus,
  regenerateDisplayGeometries,
  type ComputationStatus,
  type DisplayGeometryStatus,
  type ComputeProgressEvent,
} from '../../../api';
import type { WorldView } from '../../../types';

interface UseComputationStatusOptions {
  worldView: WorldView;
  open: boolean;
}

export function useComputationStatus({
  worldView,
  open,
}: UseComputationStatusOptions) {
  const queryClient = useQueryClient();

  // Computation status state
  const [isComputing, setIsComputing] = useState(false);
  const [computationStatus, setComputationStatus] = useState<ComputationStatus | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isComputingSingleRegion, setIsComputingSingleRegion] = useState(false);
  const [forceRecompute, setForceRecompute] = useState(false);
  const [isResettingToGADM, setIsResettingToGADM] = useState(false);
  const [skipSnapping, setSkipSnapping] = useState(true);  // Fast mode - skip expensive snapping (default: true)

  // Display geometry state
  const [displayGeomStatus, setDisplayGeomStatus] = useState<DisplayGeometryStatus | null>(null);

  // Single region compute progress logs
  const [computeProgressLogs, setComputeProgressLogs] = useState<ComputeProgressEvent[]>([]);

  // Poll for computation status when computing
  useEffect(() => {
    if (isComputing) {
      const pollStatus = async () => {
        try {
          const status = await fetchWorldViewComputationStatus(worldView.id);
          setComputationStatus(status);

          if (!status.running) {
            // Computation finished
            setIsComputing(false);
            queryClient.invalidateQueries({ queryKey: ['regions', worldView.id] });
            queryClient.invalidateQueries({ queryKey: ['regionGeometries'] });

            // Regenerate display geometries automatically after computation
            if (status.status === 'Complete') {
              console.log('[DisplayGeom] Computation complete, regenerating display geometries...');
              try {
                const displayResult = await regenerateDisplayGeometries(worldView.id);
                console.log('[DisplayGeom] Display geometry regeneration result:', displayResult);
                // Refresh display geometry status
                const newStatus = await fetchDisplayGeometryStatus(worldView.id);
                setDisplayGeomStatus(newStatus);
              } catch (e) {
                console.error('[DisplayGeom] Failed to regenerate display geometries:', e);
              }
            }
          }
        } catch (e) {
          console.error('Failed to fetch computation status:', e);
        }
      };

      // Poll immediately and then every second
      pollStatus();
      pollingRef.current = setInterval(pollStatus, 1000);

      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
      };
    }
  }, [isComputing, worldView.id, queryClient]);

  // Check if computation is running when dialog opens
  useEffect(() => {
    if (open) {
      fetchWorldViewComputationStatus(worldView.id).then(status => {
        if (status.running) {
          setIsComputing(true);
          setComputationStatus(status);
        }
      }).catch(() => {});
    }
  }, [open, worldView.id]);

  return {
    // Computation state
    isComputing,
    setIsComputing,
    computationStatus,
    setComputationStatus,
    isComputingSingleRegion,
    setIsComputingSingleRegion,
    forceRecompute,
    setForceRecompute,
    isResettingToGADM,
    setIsResettingToGADM,
    skipSnapping,
    setSkipSnapping,
    // Display geometry state
    displayGeomStatus,
    setDisplayGeomStatus,
    // Single region compute progress
    computeProgressLogs,
    setComputeProgressLogs,
  };
}

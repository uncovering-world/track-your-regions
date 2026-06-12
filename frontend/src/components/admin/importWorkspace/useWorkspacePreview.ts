/**
 * useWorkspacePreview — Encapsulates all preview state and handlers for the
 * CountryWorkspacePage, ported from the legacy WorldViewImportReview.tsx
 * preview suite (lines 264–421 + usePreviewMutations 169–222 +
 * computePreviewDialogHandlers 89–165).
 *
 * Exported shape is used by WorkspaceInner to drive the DivisionPreviewDialog.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchDivisionGeometry } from '../../../api/divisions';
import {
  acceptMatch,
  rejectSuggestion,
  acceptBatchMatches,
  rejectRemaining,
  getUnionGeometry,
  getTransferPreview,
  acceptWithTransfer,
  splitDivisionsDeeper,
  visionMatchDivisions,
} from '../../../api/admin/worldViewImport';

// ─── Preview state shape (legacy parity) ─────────────────────────────────────

export interface PreviewState {
  name: string;
  path?: string;
  regionMapUrl?: string;
  regionMapLabel?: string;
  regionName?: string;
  wikidataId?: string;
  divisionId?: number;
  divisionIds?: number[];
  regionId?: number;
  isAssigned?: boolean;
  markerPoints?: Array<{ name: string; lat: number; lon: number }>;
}

export type PendingTransfer = {
  regionId: number;
  groups: Array<{
    divisionIds: number[];
    donorRegionId: number;
    donorDivisionId: number;
    transferType: 'direct' | 'split';
  }>;
} | null;

// ─── computePreviewDialogHandlers (ported from WVIR:89-165) ──────────────────

function computeHandlers(params: {
  preview: PreviewState | null;
  pendingTransfer: PendingTransfer;
  acceptMutation: { mutate: (args: { regionId: number; divisionId: number }) => void };
  acceptSelectedMutation: { mutate: (args: { regionId: number; divisionIds: number[] }) => void };
  transferMutation: { mutate: (args: PendingTransfer & object) => void };
  acceptAndRejectRestMutation: { mutate: (args: { regionId: number; divisionId: number }) => void };
  acceptSelectedRejectRestMutation: { mutate: (args: { regionId: number; divisionIds: number[] }) => void };
  rejectMutation: { mutate: (args: { regionId: number; divisionId: number }) => void };
  rejectSelectedMutation: { mutate: (args: { regionId: number; divisionIds: number[] }) => void };
}): { onAccept?: () => void; onAcceptAndRejectRest?: () => void; onReject?: () => void } {
  const {
    preview, pendingTransfer,
    acceptMutation, acceptSelectedMutation, transferMutation,
    acceptAndRejectRestMutation, acceptSelectedRejectRestMutation,
    rejectMutation, rejectSelectedMutation,
  } = params;

  const hasSelectedDivisions = !!(preview?.divisionIds && preview.regionId != null);
  const hasSingleDivision = preview?.regionId != null && preview?.divisionId != null;
  const singleDivisionNotYetAssigned = hasSingleDivision && !preview!.isAssigned;

  const buildAccept = (): (() => void) | undefined => {
    if (pendingTransfer) return () => transferMutation.mutate(pendingTransfer);
    if (hasSelectedDivisions) {
      return () => acceptSelectedMutation.mutate({
        regionId: preview!.regionId!,
        divisionIds: preview!.divisionIds!,
      });
    }
    if (singleDivisionNotYetAssigned) {
      return () => acceptMutation.mutate({
        regionId: preview!.regionId!,
        divisionId: preview!.divisionId!,
      });
    }
    return undefined;
  };

  const buildAcceptAndRejectRest = (): (() => void) | undefined => {
    if (hasSelectedDivisions) {
      return () => acceptSelectedRejectRestMutation.mutate({
        regionId: preview!.regionId!,
        divisionIds: preview!.divisionIds!,
      });
    }
    if (singleDivisionNotYetAssigned) {
      return () => acceptAndRejectRestMutation.mutate({
        regionId: preview!.regionId!,
        divisionId: preview!.divisionId!,
      });
    }
    return undefined;
  };

  const buildReject = (): (() => void) | undefined => {
    if (hasSelectedDivisions) {
      return () => rejectSelectedMutation.mutate({
        regionId: preview!.regionId!,
        divisionIds: preview!.divisionIds!,
      });
    }
    if (hasSingleDivision) {
      return () => rejectMutation.mutate({
        regionId: preview!.regionId!,
        divisionId: preview!.divisionId!,
      });
    }
    return undefined;
  };

  return {
    onAccept: buildAccept(),
    onAcceptAndRejectRest: buildAcceptAndRejectRest(),
    onReject: buildReject(),
  };
}

// ─── useWorkspacePreview ──────────────────────────────────────────────────────

export interface UseWorkspacePreviewResult {
  // State
  previewState: PreviewState | null;
  previewGeometry: GeoJSON.Geometry | GeoJSON.FeatureCollection | null;
  previewLoading: boolean;
  pendingTransfer: PendingTransfer;

  // Handlers
  handlePreviewDivision: (
    divisionId: number, name: string, path?: string,
    regionMapUrl?: string, wikidataId?: string,
    regionId?: number, isAssigned?: boolean,
    regionMapLabel?: string, regionName?: string,
    markerPoints?: Array<{ name: string; lat: number; lon: number }>,
  ) => Promise<void>;
  handleClosePreview: () => void;
  handlePreviewUnion: (
    regionId: number,
    divisionIds: number[],
    context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string },
  ) => Promise<void>;
  handlePreviewTransfer: (
    divisionId: number, name: string, path: string | undefined,
    conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' },
    wikidataId: string, regionName: string,
    regionId?: number, allDivisionIds?: number[],
    allSuggestions?: Array<{ divisionId: number; conflict?: { donorDivisionId: number; donorRegionId: number; type: 'direct' | 'split' } }>,
  ) => Promise<void>;
  handleViewMap: (
    regionId: number,
    context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string; divisionIds: number[] },
  ) => Promise<void>;
  handleSplitDeeper: (source: 'geoshape' | 'points' | 'image' | null) => Promise<void>;
  handleVisionMatch: () => Promise<{ ids: number[]; rejectedIds?: number[]; unclearIds?: number[]; reasoning?: string; debugImages?: { regionMap: string; divisionsMap: string } }>;

  // Computed dialog handlers
  dialogHandlers: { onAccept?: () => void; onAcceptAndRejectRest?: () => void; onReject?: () => void };

  // Pending status
  actionPending: boolean;

  // onSplitDeeper condition
  onSplitDeeperEnabled: boolean;
  // onVisionMatch condition
  onVisionMatchEnabled: boolean;
}

export function useWorkspacePreview(
  worldViewId: number,
  onDone: () => void,
): UseWorkspacePreviewResult {
  const queryClient = useQueryClient();

  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | GeoJSON.FeatureCollection | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer>(null);

  // ── Invalidation helper (ported from WVIR onSuccess pattern) ─────────────

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
  }, [queryClient, worldViewId]);

  // ── Mutations (ported from usePreviewMutations WVIR:169-222) ─────────────

  const onSuccess = useCallback(() => {
    setPreviewState(null);
    setPreviewGeometry(null);
    setPendingTransfer(null);
    invalidate();
    onDone();
  }, [invalidate, onDone]);

  const acceptMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptMatch(worldViewId, regionId, divisionId),
    onSuccess,
  });

  const rejectMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      rejectSuggestion(worldViewId, regionId, divisionId),
    onSuccess,
  });

  const transferMutation = useMutation({
    mutationFn: async (params: { regionId: number; groups: Array<{ divisionIds: number[]; donorRegionId: number; donorDivisionId: number; transferType: 'direct' | 'split' }> }) => {
      for (const g of params.groups) {
        await acceptWithTransfer(worldViewId, params.regionId, g.divisionIds, g.donorRegionId, g.donorDivisionId, g.transferType);
      }
    },
    onSuccess,
  });

  const acceptAndRejectRestMutation = useMutation({
    mutationFn: async ({ regionId, divisionId }: { regionId: number; divisionId: number }) => {
      await acceptMatch(worldViewId, regionId, divisionId);
      await rejectRemaining(worldViewId, regionId);
    },
    onSuccess,
  });

  const acceptSelectedMutation = useMutation({
    mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
      acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d }))),
    onSuccess,
  });

  const acceptSelectedRejectRestMutation = useMutation({
    mutationFn: async ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) => {
      await acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d })));
      await rejectRemaining(worldViewId, regionId);
    },
    onSuccess,
  });

  const rejectSelectedMutation = useMutation({
    mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
      Promise.all(divisionIds.map(d => rejectSuggestion(worldViewId, regionId, d))).then(() => {}),
    onSuccess,
  });

  // ── Handlers (ported from WVIR:278-421) ──────────────────────────────────

  const handlePreviewDivision = useCallback(async (
    divisionId: number, name: string, path?: string,
    regionMapUrl?: string, wikidataId?: string,
    regionId?: number, isAssigned?: boolean,
    regionMapLabel?: string, regionName?: string,
    markerPoints?: Array<{ name: string; lat: number; lon: number }>,
  ) => {
    setPreviewState({ name, path, regionMapUrl, wikidataId, divisionId, regionId, isAssigned, regionMapLabel, regionName, markerPoints });
    setPreviewGeometry(null);
    setPendingTransfer(null);
    setPreviewLoading(true);
    try {
      const feature = await fetchDivisionGeometry(divisionId, 1, { detail: 'medium' });
      setPreviewGeometry((feature?.geometry as GeoJSON.Geometry) ?? null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewState(null);
    setPreviewGeometry(null);
    setPendingTransfer(null);
  }, []);

  const handlePreviewUnion = useCallback(async (
    regionId: number,
    divisionIds: number[],
    context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string },
  ) => {
    setPreviewState({
      name: `${divisionIds.length} divisions (union)`,
      regionId,
      isAssigned: false,
      divisionIds,
      wikidataId: context.wikidataId,
      regionMapUrl: context.regionMapUrl,
      regionMapLabel: context.regionMapLabel,
      regionName: context.regionName,
    });
    setPreviewGeometry(null);
    setPendingTransfer(null);
    setPreviewLoading(true);
    try {
      const result = await getUnionGeometry(worldViewId, divisionIds, regionId);
      setPreviewGeometry(result.geometry);
    } finally {
      setPreviewLoading(false);
    }
  }, [worldViewId]);

  const handlePreviewTransfer = useCallback(async (
    divisionId: number, name: string, path: string | undefined,
    conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' },
    wikidataId: string, regionName: string,
    regionId?: number, allDivisionIds?: number[],
    allSuggestions?: Array<{ divisionId: number; conflict?: { donorDivisionId: number; donorRegionId: number; type: 'direct' | 'split' } }>,
  ) => {
    const movingIds = allDivisionIds ?? [divisionId];
    const label = movingIds.length > 1 ? `Transfer: ${movingIds.length} divisions` : `Transfer: ${name}`;
    setPreviewState({ name: label, path, regionMapUrl: undefined, wikidataId, regionId: undefined, regionName });
    setPreviewGeometry(null);
    setPreviewLoading(true);

    // Group by donor for multi-donor support
    const suggestions = allSuggestions ?? [{ divisionId, conflict }];
    const groupsByDonor = new Map<number, { divisionIds: number[]; donorRegionId: number; donorDivisionId: number; transferType: 'direct' | 'split' }>();
    for (const s of suggestions) {
      const c = s.conflict ?? conflict;
      const key = c.donorDivisionId;
      const existing = groupsByDonor.get(key);
      if (existing) {
        existing.divisionIds.push(s.divisionId);
      } else {
        groupsByDonor.set(key, { divisionIds: [s.divisionId], donorRegionId: c.donorRegionId, donorDivisionId: c.donorDivisionId, transferType: c.type });
      }
    }
    const groups = [...groupsByDonor.values()];
    setPendingTransfer(regionId != null ? { regionId, groups } : null);

    try {
      const fcs = await Promise.all(groups.map(g => getTransferPreview(worldViewId, g.donorDivisionId, g.divisionIds, wikidataId)));
      const merged: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: fcs.flatMap(fc => fc.features) };
      // Deduplicate target_outline (same geoshape repeated per group)
      const seen = new Set<string>();
      merged.features = merged.features.filter(f => {
        if (f.properties?.role !== 'target_outline') return true;
        const key = f.properties.role;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setPreviewGeometry(merged);
    } catch {
      setPreviewGeometry(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [worldViewId]);

  const handleViewMap = useCallback(async (
    regionId: number,
    context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string; divisionIds: number[] },
  ) => {
    const hasDivisions = context.divisionIds.length > 0;
    const divSuffix = context.divisionIds.length > 1 ? 's' : '';
    const previewName = hasDivisions
      ? `${context.regionName} — ${context.divisionIds.length} division${divSuffix}`
      : context.regionName;
    setPreviewState({
      name: previewName,
      wikidataId: context.wikidataId,
      regionMapUrl: context.regionMapUrl,
      regionMapLabel: context.regionMapLabel,
      regionName: context.regionName,
      regionId,
    });
    setPreviewGeometry(null);
    setPendingTransfer(null);
    if (hasDivisions) {
      setPreviewLoading(true);
      try {
        const result = await getUnionGeometry(worldViewId, context.divisionIds);
        setPreviewGeometry(result.geometry);
      } finally {
        setPreviewLoading(false);
      }
    }
  }, [worldViewId]);

  const handleSplitDeeper = useCallback(async (source: 'geoshape' | 'points' | 'image' | null) => {
    const computeIds = (): number[] | null => {
      if (previewState?.divisionIds?.length) return previewState.divisionIds;
      if (previewState?.divisionId) return [previewState.divisionId];
      return null;
    };
    const ids = computeIds();
    if (!ids || !previewState?.wikidataId || !previewState.regionId) return;
    setPreviewLoading(true);
    try {
      const result = await splitDivisionsDeeper(worldViewId, ids, previewState.wikidataId, previewState.regionId, source ?? undefined);
      const newIds = result.divisions.map(d => d.divisionId);
      setPreviewState(prev => prev ? {
        ...prev,
        name: `${newIds.length} divisions (refined)`,
        divisionIds: newIds,
        markerPoints: result.points ?? prev.markerPoints,
      } : prev);
      setPreviewGeometry(result.geometry);
    } finally {
      setPreviewLoading(false);
    }
  }, [worldViewId, previewState?.divisionIds, previewState?.divisionId, previewState?.wikidataId, previewState?.regionId]);

  const handleVisionMatch = useCallback(async (): Promise<{ ids: number[]; rejectedIds?: number[]; unclearIds?: number[]; reasoning?: string; debugImages?: { regionMap: string; divisionsMap: string } }> => {
    if (!previewState?.divisionIds?.length || !previewState.regionId || !previewState.regionMapUrl) return { ids: [] };
    const result = await visionMatchDivisions(worldViewId, previewState.divisionIds, previewState.regionId, previewState.regionMapUrl);
    return { ids: result.suggestedIds, rejectedIds: result.rejectedIds, unclearIds: result.unclearIds, reasoning: result.reasoning, debugImages: result.debugImages };
  }, [worldViewId, previewState?.divisionIds, previewState?.regionId, previewState?.regionMapUrl]);

  // ── Computed dialog handlers ──────────────────────────────────────────────

  const dialogHandlers = computeHandlers({
    preview: previewState,
    pendingTransfer,
    acceptMutation,
    acceptSelectedMutation,
    transferMutation,
    acceptAndRejectRestMutation,
    acceptSelectedRejectRestMutation,
    rejectMutation,
    rejectSelectedMutation,
  });

  const actionPending =
    acceptMutation.isPending ||
    rejectMutation.isPending ||
    transferMutation.isPending ||
    acceptAndRejectRestMutation.isPending ||
    acceptSelectedMutation.isPending ||
    acceptSelectedRejectRestMutation.isPending ||
    rejectSelectedMutation.isPending ||
    previewLoading;

  const onSplitDeeperEnabled = !!(
    (previewState?.divisionIds?.length || previewState?.divisionId) &&
    previewState?.wikidataId
  );

  const onVisionMatchEnabled = !!(
    previewState?.divisionIds?.length &&
    previewState.regionId &&
    previewState.regionMapUrl
  );

  return {
    previewState,
    previewGeometry,
    previewLoading,
    pendingTransfer,
    handlePreviewDivision,
    handleClosePreview,
    handlePreviewUnion,
    handlePreviewTransfer,
    handleViewMap,
    handleSplitDeeper,
    handleVisionMatch,
    dialogHandlers,
    actionPending,
    onSplitDeeperEnabled,
    onVisionMatchEnabled,
  };
}

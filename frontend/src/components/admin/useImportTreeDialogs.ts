/**
 * useImportTreeDialogs — Custom hook for dialog state and handlers in the import tree.
 *
 * Extracted from WorldViewImportTree.tsx. Owns all dialog-related useState,
 * callbacks for opening/submitting dialogs, and computed values used only by dialogs
 * (flatRegionList, regionNameToId, regionNameRegex).
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  smartFlattenPreview,
  aiSuggestChildren as apiAISuggestChildren,
  getCoverageGeometry,
  analyzeCoverageGaps as apiAnalyzeCoverageGaps,
  type MatchTreeNode,
  type AISuggestChildrenResult,
  type CoverageGapDivision,
  type SiblingRegionGeometry,
} from '../../api/adminWorldViewImport';
import { searchDivisions } from '../../api/divisions';
import { runHierarchyReview } from '../../api/adminAI';
import { type StoredReport } from './AIReviewDrawer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively find a node by ID in the tree */
function findNodeById(nodes: MatchTreeNode[], id: number): MatchTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeById(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Recursively find a node's name by ID */
function findNameById(nodes: MatchTreeNode[], id: number): string {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    const found = findNameById(n.children, id);
    if (found) return found;
  }
  return '';
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RenameDialogState {
  regionId: number;
  currentName: string;
  newName: string;
}

export interface ReparentDialogState {
  regionId: number;
  regionName: string;
  selectedParentId: number | null;
}

export interface SuggestChildrenState {
  regionId: number;
  regionName: string;
  result: AISuggestChildrenResult;
  selected: Set<string>;
}

export interface DivisionSearchDialogState {
  regionId: number;
  regionName: string;
}

export interface CoverageCompareState {
  regionId: number;
  regionName: string;
  worldViewId: number;
  loading: boolean;
  parentGeometry: GeoJSON.Geometry | null;
  childrenGeometry: GeoJSON.Geometry | null;
  geoshapeGeometry?: GeoJSON.Geometry | null;
}

export interface GapAnalysisState {
  regionId: number;
  regionName: string;
  loading: boolean;
  gapDivisions: CoverageGapDivision[];
  siblingRegions: SiblingRegionGeometry[];
  regionMapUrl: string | null;
}

export interface FlattenPreviewState {
  regionId: number;
  regionName: string;
  geometry: GeoJSON.Geometry | null;
  regionMapUrl: string | null;
  descendants: number;
  divisions: number;
}

export interface SmartSimplifyState {
  regionId: number;
  regionName: string;
  regionMapUrl: string | null;
}

export interface FlatRegionItem {
  id: number;
  name: string;
  depth: number;
}

export interface UseImportTreeDialogsResult {
  // Rename dialog
  renameDialog: RenameDialogState | null;
  setRenameDialog: React.Dispatch<React.SetStateAction<RenameDialogState | null>>;
  handleRenameSubmit: () => void;

  // Reparent dialog
  reparentDialog: ReparentDialogState | null;
  setReparentDialog: React.Dispatch<React.SetStateAction<ReparentDialogState | null>>;
  handleReparentSubmit: () => void;

  // AI suggest children
  suggestChildrenResult: SuggestChildrenState | null;
  setSuggestChildrenResult: React.Dispatch<React.SetStateAction<SuggestChildrenState | null>>;
  aiSuggestingRegionId: number | null;
  handleAISuggestChildren: (regionId: number) => Promise<void>;

  // Division search
  divisionSearchDialog: DivisionSearchDialogState | null;
  setDivisionSearchDialog: React.Dispatch<React.SetStateAction<DivisionSearchDialogState | null>>;
  divSearchQuery: string;
  divSearchResults: Awaited<ReturnType<typeof searchDivisions>>;
  divSearchLoading: boolean;
  handleManualDivisionSearch: (regionId: number) => void;
  handleDivSearchInput: (_e: unknown, value: string) => void;

  // Add child
  addChildDialogRegionId: number | null;
  setAddChildDialogRegionId: React.Dispatch<React.SetStateAction<number | null>>;
  addChildName: string;
  setAddChildName: React.Dispatch<React.SetStateAction<string>>;
  handleAddChild: (parentRegionId: number) => void;

  // Coverage compare
  coverageCompare: CoverageCompareState | null;
  setCoverageCompare: React.Dispatch<React.SetStateAction<CoverageCompareState | null>>;
  handleCoverageClick: (regionId: number) => void;

  // Gap analysis
  gapAnalysis: GapAnalysisState | null;
  setGapAnalysis: React.Dispatch<React.SetStateAction<GapAnalysisState | null>>;
  highlightedGapId: number | null;
  setHighlightedGapId: React.Dispatch<React.SetStateAction<number | null>>;
  gapMapSelectedRegionId: number | null;
  setGapMapSelectedRegionId: React.Dispatch<React.SetStateAction<number | null>>;
  handleAnalyzeGaps: (regionId: number) => Promise<void>;

  // Flatten preview
  flattenPreview: FlattenPreviewState | null;
  setFlattenPreview: React.Dispatch<React.SetStateAction<FlattenPreviewState | null>>;
  flattenPreviewLoading: number | null;
  handleSmartFlatten: (regionId: number) => Promise<void>;

  // Remove region
  handleRemoveRegion: (regionId: number) => void;

  // Manual fix
  fixDialogState: { regionId: number; regionName: string } | null;
  setFixDialogState: React.Dispatch<React.SetStateAction<{ regionId: number; regionName: string } | null>>;

  // Review
  reviewReports: Map<string, StoredReport>;
  setReviewReports: React.Dispatch<React.SetStateAction<Map<string, StoredReport>>>;
  activeReviewKey: string | null;
  setActiveReviewKey: React.Dispatch<React.SetStateAction<string | null>>;
  reviewLoading: { key: string; passInfo: string } | null;
  handleReview: (regionId?: number, forceRegenerate?: boolean) => Promise<void>;

  // Smart simplify
  smartSimplifyDialog: SmartSimplifyState | null;
  setSmartSimplifyDialog: React.Dispatch<React.SetStateAction<SmartSimplifyState | null>>;
  handleSmartSimplify: (regionId: number) => void;

  // Computed values for dialogs
  flatRegionList: FlatRegionItem[];
  regionNameToId: Map<string, number>;
  regionNameRegex: RegExp | null;
}

interface UseImportTreeDialogsDeps {
  renameMutation: { mutate: (args: { regionId: number; name: string }, opts?: { onSettled?: () => void }) => void };
  reparentMutation: { mutate: (args: { regionId: number; newParentId: number | null }, opts?: { onSettled?: () => void }) => void };
  setRemoveDialogState: React.Dispatch<React.SetStateAction<{
    regionId: number;
    regionName: string;
    hasChildren: boolean;
    hasDivisions: boolean;
  } | null>>;
  setUndoSnackbar: (value: { open: boolean; message: string; worldViewId: number } | null) => void;
  invalidateTree: () => void;
}

export function useImportTreeDialogs(
  worldViewId: number,
  tree: MatchTreeNode[] | undefined,
  deps: UseImportTreeDialogsDeps,
): UseImportTreeDialogsResult {
  const { renameMutation, reparentMutation, setRemoveDialogState, setUndoSnackbar, invalidateTree } = deps;

  // ── Rename ─────────────────────────────────────────────────────────────────
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);

  const handleRenameSubmit = useCallback(() => {
    if (!renameDialog || !renameDialog.newName.trim()) return;
    renameMutation.mutate(
      { regionId: renameDialog.regionId, name: renameDialog.newName.trim() },
      { onSettled: () => setRenameDialog(null) },
    );
  }, [renameDialog, renameMutation]);

  // ── Reparent ───────────────────────────────────────────────────────────────
  const [reparentDialog, setReparentDialog] = useState<ReparentDialogState | null>(null);

  const handleReparentSubmit = useCallback(() => {
    if (!reparentDialog) return;
    reparentMutation.mutate(
      { regionId: reparentDialog.regionId, newParentId: reparentDialog.selectedParentId },
      { onSettled: () => setReparentDialog(null) },
    );
  }, [reparentDialog, reparentMutation]);

  // ── AI Suggest Children ────────────────────────────────────────────────────
  const [suggestChildrenResult, setSuggestChildrenResult] = useState<SuggestChildrenState | null>(null);
  const [aiSuggestingRegionId, setAISuggestingRegionId] = useState<number | null>(null);

  const handleAISuggestChildren = useCallback(async (regionId: number) => {
    const regionName = tree ? findNameById(tree, regionId) || 'Region' : 'Region';
    setAISuggestingRegionId(regionId);
    try {
      const result = await apiAISuggestChildren(worldViewId, regionId);
      setSuggestChildrenResult({
        regionId,
        regionName,
        result,
        selected: new Set(result.suggestions.map(s => s.name)),
      });
    } catch (err) {
      console.error('AI suggest children failed:', err);
      setUndoSnackbar({
        open: true,
        message: `Suggest children failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        worldViewId,
      });
    } finally {
      setAISuggestingRegionId(null);
    }
  }, [tree, worldViewId, setUndoSnackbar]);

  // ── Division Search ────────────────────────────────────────────────────────
  const [divisionSearchDialog, setDivisionSearchDialog] = useState<DivisionSearchDialogState | null>(null);
  const [divSearchQuery, setDivSearchQuery] = useState('');
  const [divSearchResults, setDivSearchResults] = useState<Awaited<ReturnType<typeof searchDivisions>>>([]);
  const [divSearchLoading, setDivSearchLoading] = useState(false);

  const handleManualDivisionSearch = useCallback((regionId: number) => {
    const regionName = tree ? findNameById(tree, regionId) || 'Region' : 'Region';
    setDivisionSearchDialog({ regionId, regionName });
    setDivSearchQuery('');
    setDivSearchResults([]);
  }, [tree]);

  const divSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDivSearchInput = useCallback((_e: unknown, value: string) => {
    setDivSearchQuery(value);
    if (divSearchTimerRef.current) clearTimeout(divSearchTimerRef.current);
    if (value.length < 2) {
      setDivSearchResults([]);
      setDivSearchLoading(false);
      return;
    }
    setDivSearchLoading(true);
    divSearchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchDivisions(value, worldViewId, 30);
        setDivSearchResults(results);
      } catch (err) {
        console.error('Division search failed:', err);
      } finally {
        setDivSearchLoading(false);
      }
    }, 300);
  }, [worldViewId]);

  // ── Add Child ──────────────────────────────────────────────────────────────
  const [addChildDialogRegionId, setAddChildDialogRegionId] = useState<number | null>(null);
  const [addChildName, setAddChildName] = useState('');

  const handleAddChild = useCallback((parentRegionId: number) => {
    setAddChildDialogRegionId(parentRegionId);
  }, []);

  // ── Coverage Compare ───────────────────────────────────────────────────────
  const [coverageCompare, setCoverageCompare] = useState<CoverageCompareState | null>(null);

  const handleCoverageClick = useCallback((regionId: number) => {
    const name = tree ? findNameById(tree, regionId) || '' : '';
    setCoverageCompare({ regionId, regionName: name, worldViewId, loading: true, parentGeometry: null, childrenGeometry: null, geoshapeGeometry: null });

    getCoverageGeometry(worldViewId, regionId).then(data => {
      setCoverageCompare(prev => prev?.regionId === regionId ? { ...prev, loading: false, ...data } : prev);
    }).catch(() => {
      setCoverageCompare(prev => prev?.regionId === regionId ? { ...prev, loading: false } : prev);
    });
  }, [tree, worldViewId]);

  // ── Gap Analysis ───────────────────────────────────────────────────────────
  const [gapAnalysis, setGapAnalysis] = useState<GapAnalysisState | null>(null);
  const [highlightedGapId, setHighlightedGapId] = useState<number | null>(null);
  const [gapMapSelectedRegionId, setGapMapSelectedRegionId] = useState<number | null>(null);

  const handleAnalyzeGaps = useCallback(async (regionId: number) => {
    const node = tree ? findNodeById(tree, regionId) : null;
    const regionName = node?.name ?? 'Region';
    const regionMapUrl = node?.regionMapUrl ?? null;
    setGapAnalysis({ regionId, regionName, loading: true, gapDivisions: [], siblingRegions: [], regionMapUrl });

    try {
      const result = await apiAnalyzeCoverageGaps(worldViewId, regionId);
      setGapAnalysis({ regionId, regionName, loading: false, gapDivisions: result.gapDivisions, siblingRegions: result.siblingRegions, regionMapUrl });
    } catch (err) {
      console.error('Coverage gap analysis failed:', err);
      setGapAnalysis(prev => prev ? { ...prev, loading: false } : prev);
    }
  }, [tree, worldViewId]);

  // ── Flatten Preview ────────────────────────────────────────────────────────
  const [flattenPreview, setFlattenPreview] = useState<FlattenPreviewState | null>(null);
  const [flattenPreviewLoading, setFlattenPreviewLoading] = useState<number | null>(null);

  const handleSmartFlatten = useCallback(async (regionId: number) => {
    const regionName = tree ? findNameById(tree, regionId) || 'Region' : 'Region';
    setFlattenPreviewLoading(regionId);
    try {
      const data = await smartFlattenPreview(worldViewId, regionId);
      if (data.unmatched) {
        const names = data.unmatched.map(u => u.name).join(', ');
        setUndoSnackbar({
          open: true,
          message: `Cannot flatten: ${data.unmatched.length} unmatched: ${names}`,
          worldViewId,
        });
        invalidateTree();
        return;
      }
      setFlattenPreview({
        regionId,
        regionName,
        geometry: data.geometry ?? null,
        regionMapUrl: data.regionMapUrl ?? null,
        descendants: data.descendants ?? 0,
        divisions: data.divisions ?? 0,
      });
    } catch (err) {
      console.error('Smart flatten preview failed:', err);
      setUndoSnackbar({
        open: true,
        message: `Preview failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        worldViewId,
      });
    } finally {
      setFlattenPreviewLoading(null);
    }
  }, [tree, worldViewId, invalidateTree, setUndoSnackbar]);

  // ── Smart Simplify ─────────────────────────────────────────────────────────
  const [smartSimplifyDialog, setSmartSimplifyDialog] = useState<SmartSimplifyState | null>(null);

  const handleSmartSimplify = useCallback((regionId: number) => {
    const node = tree ? findNodeById(tree, regionId) : null;
    if (!node) return;
    setSmartSimplifyDialog({
      regionId,
      regionName: node.name,
      regionMapUrl: node.regionMapUrl ?? null,
    });
  }, [tree]);

  // ── Remove Region ──────────────────────────────────────────────────────────
  const handleRemoveRegion = useCallback((regionId: number) => {
    const node = tree ? findNodeById(tree, regionId) : null;
    if (!node) return;
    setRemoveDialogState({
      regionId,
      regionName: node.name,
      hasChildren: node.children.length > 0,
      hasDivisions: node.memberCount > 0,
    });
  }, [tree, setRemoveDialogState]);

  // ── Manual Fix ─────────────────────────────────────────────────────────────
  const [fixDialogState, setFixDialogState] = useState<{ regionId: number; regionName: string } | null>(null);

  // ── AI Review ──────────────────────────────────────────────────────────────
  const [reviewReports, setReviewReports] = useState<Map<string, StoredReport>>(new Map());
  const [activeReviewKey, setActiveReviewKey] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState<{ key: string; passInfo: string } | null>(null);

  const handleReview = useCallback(async (regionId?: number, forceRegenerate = false) => {
    const key = regionId != null ? `region-${regionId}` : 'full';

    // If report already exists and not forcing regenerate, just open it
    if (!forceRegenerate && reviewReports.has(key) && !reviewLoading) {
      setActiveReviewKey(key);
      return;
    }

    const scope = regionId ? 'Subtree review' : 'Full tree';
    const passInfo = regionId ? 'Analyzing branch...' : 'Pass 1: surveying tree structure...';
    setActiveReviewKey(key);
    setReviewLoading({ key, passInfo });

    try {
      const result = await runHierarchyReview(worldViewId, regionId);
      const stored: StoredReport = {
        scope,
        regionId: regionId ?? null,
        report: result.report,
        actions: (result.actions ?? []).map((a, i) => ({ ...a, id: a.id || `action-${i}`, completed: false })),
        stats: result.stats,
        generatedAt: new Date().toISOString(),
      };
      setReviewReports(prev => new Map(prev).set(key, stored));
    } catch (err) {
      const stored: StoredReport = {
        scope,
        regionId: regionId ?? null,
        report: `Error: ${err instanceof Error ? err.message : 'Review failed'}`,
        actions: [],
        stats: null,
        generatedAt: new Date().toISOString(),
      };
      setReviewReports(prev => new Map(prev).set(key, stored));
    } finally {
      setReviewLoading(null);
    }
  }, [worldViewId, reviewReports, reviewLoading]);

  // ── Computed values for dialogs ────────────────────────────────────────────

  // Flat list of all regions for reparent dialog Autocomplete
  const flatRegionList = useMemo(() => {
    if (!tree) return [];
    const list: FlatRegionItem[] = [];
    function walk(nodes: MatchTreeNode[], depth: number) {
      for (const node of nodes) {
        list.push({ id: node.id, name: node.name, depth });
        if (node.children.length > 0) walk(node.children, depth + 1);
      }
    }
    walk(tree, 0);
    return list;
  }, [tree]);

  // Name -> ID map for clickable region names in review text
  const regionNameToId = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of flatRegionList) {
      // First occurrence wins (higher in tree = more likely intended)
      if (!map.has(r.name)) map.set(r.name, r.id);
    }
    return map;
  }, [flatRegionList]);

  // Regex matching any region name (longest first to avoid partial matches)
  const regionNameRegex = useMemo(() => {
    if (regionNameToId.size === 0) return null;
    const names = [...regionNameToId.keys()]
      .filter(n => n.length >= 3) // skip very short names to avoid false positives
      .sort((a, b) => b.length - a.length); // longest first
    if (names.length === 0) return null;
    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from escaped region names, not user input
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'g');
  }, [regionNameToId]);

  return {
    // Rename
    renameDialog, setRenameDialog, handleRenameSubmit,
    // Reparent
    reparentDialog, setReparentDialog, handleReparentSubmit,
    // AI suggest children
    suggestChildrenResult, setSuggestChildrenResult, aiSuggestingRegionId, handleAISuggestChildren,
    // Division search
    divisionSearchDialog, setDivisionSearchDialog,
    divSearchQuery, divSearchResults, divSearchLoading,
    handleManualDivisionSearch, handleDivSearchInput,
    // Add child
    addChildDialogRegionId, setAddChildDialogRegionId, addChildName, setAddChildName, handleAddChild,
    // Coverage compare
    coverageCompare, setCoverageCompare, handleCoverageClick,
    // Gap analysis
    gapAnalysis, setGapAnalysis,
    highlightedGapId, setHighlightedGapId,
    gapMapSelectedRegionId, setGapMapSelectedRegionId,
    handleAnalyzeGaps,
    // Flatten preview
    flattenPreview, setFlattenPreview, flattenPreviewLoading, handleSmartFlatten,
    // Smart simplify
    smartSimplifyDialog, setSmartSimplifyDialog, handleSmartSimplify,
    // Remove region
    handleRemoveRegion,
    // Manual fix
    fixDialogState, setFixDialogState,
    // Review
    reviewReports, setReviewReports,
    activeReviewKey, setActiveReviewKey,
    reviewLoading, handleReview,
    // Computed
    flatRegionList, regionNameToId, regionNameRegex,
  };
}

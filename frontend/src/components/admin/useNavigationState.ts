/**
 * useNavigationState — Custom hook for tree navigation and virtualization.
 *
 * Extracted from WorldViewImportTree.tsx. Owns the expanded set, scroll management,
 * category navigation (unresolved/warnings/single-child/incomplete-coverage),
 * virtualizer setup, and highlight tracking.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { MatchTreeNode, ChildrenCoverageResult } from '../../api/adminWorldViewImport';
import type { ShadowInsertion } from './treeNodeShared';
import {
  collectAncestorsOfIds,
  findUnresolvedNodes,
  findSingleChildNodes,
  findNodesWithWarnings,
  flattenVisibleTree,
  type FlatTreeItem,
} from './importTreeUtils';

export type NavCategory = 'unresolved' | 'warnings' | 'single-child' | 'incomplete-coverage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyVirtualizer = ReturnType<typeof useVirtualizer<any, any>>;

export interface UseNavigationStateResult {
  // Expand/collapse
  expanded: Set<number>;
  toggleExpand: (id: number) => void;
  expandAll: () => void;
  collapseAll: () => void;
  expandToShadows: () => void;

  // Flat items + virtualizer
  flatItems: FlatTreeItem[];
  virtualizer: AnyVirtualizer;
  parentRef: React.RefObject<HTMLDivElement | null>;

  // Category navigation
  activeNav: { category: NavCategory; idx: number } | null;
  setActiveNav: React.Dispatch<React.SetStateAction<{ category: NavCategory; idx: number } | null>>;
  navIdsMap: Record<NavCategory, number[]>;
  navigateTo: (category: NavCategory, idx: number) => void;

  // Highlight
  highlightedRegionId: number | null;
  navigateToRegion: (regionId: number) => void;

  // Category ID lists (exposed for toolbar badge counts)
  unresolvedIds: number[];
  singleChildIds: number[];
  warningIds: number[];
  incompleteCoverageIds: number[];

  // Shadow map (pre-computed, shared with TreeNodeRow)
  shadowsByRegionId: Map<number, ShadowInsertion[]>;

  // Scroll helpers
  requestScrollTo: (targetId: number) => void;
}

export function useNavigationState(
  tree: MatchTreeNode[] | undefined,
  shadowInsertions: ShadowInsertion[] | undefined,
  coverageData: ChildrenCoverageResult | undefined,
): UseNavigationStateResult {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allBranchIds = useMemo(() => {
    if (!tree) return new Set<number>();
    const ids = new Set<number>();
    function walk(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.add(node.id);
          walk(node.children);
        }
      }
    }
    walk(tree);
    return ids;
  }, [tree]);

  // Compute per-region shadow map
  const shadowsByRegionId = useMemo(() => {
    const map = new Map<number, ShadowInsertion[]>();
    for (const s of shadowInsertions ?? []) {
      const arr = map.get(s.targetRegionId) ?? [];
      arr.push(s);
      map.set(s.targetRegionId, arr);
    }
    return map;
  }, [shadowInsertions]);

  // Flatten tree into visible items for the virtualizer
  const flatItems = useMemo<FlatTreeItem[]>(() => {
    if (!tree) return [];
    return flattenVisibleTree(tree, expanded, shadowsByRegionId);
  }, [tree, expanded, shadowsByRegionId]);

  // Virtualizer for the flat list
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 15,
    getItemKey: (index) => {
      const item = flatItems[index];
      if (item.kind === 'node') {
        const n = item.node;
        // Include content-affecting fields so the virtualizer discards stale cached
        // heights when row content changes (e.g., suggestions removed after accept).
        // Without this, ResizeObserver intermittently misses height changes, leaving
        // blank space where removed content used to be.
        // Include coverage presence so key changes when async coverage data arrives,
        // forcing the virtualizer to discard its stale cached height and re-measure.
        const cov = coverageData?.coverage?.[String(n.id)];
        const geoCov = coverageData?.geoshapeCoverage?.[String(n.id)];
        const covKey = cov != null ? 'c' : geoCov != null ? 'g' : '';
        return `${n.id}:${n.matchStatus}:${n.suggestions.length}:${n.assignedDivisions.length}:${n.hierarchyReviewed}:${covKey}`;
      }
      return `shadow-${item.shadow.gapDivisionId}`;
    },
  });

  /** Pending scroll target — useEffect on flatItems will scroll when the target becomes visible */
  const pendingScrollRef = useRef<number | null>(null);
  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  /** Request scroll to a node. Scrolls immediately if visible, else defers to useEffect. */
  const requestScrollTo = useCallback((targetId: number) => {
    const items = flatItemsRef.current;
    const index = items.findIndex(item => item.kind === 'node' && item.node.id === targetId);
    if (index >= 0) {
      virtualizerRef.current.scrollToIndex(index, { align: 'center' });
      pendingScrollRef.current = null;
    } else {
      pendingScrollRef.current = targetId;
    }
  }, []);

  // When flatItems changes (expanded set updated), execute pending scroll
  useEffect(() => {
    if (pendingScrollRef.current == null) return;
    const targetId = pendingScrollRef.current;
    const index = flatItems.findIndex(item => item.kind === 'node' && item.node.id === targetId);
    if (index >= 0) {
      pendingScrollRef.current = null;
      virtualizer.scrollToIndex(index, { align: 'center' });
    }
  }, [flatItems, virtualizer]);

  const expandAll = useCallback(() => {
    setExpanded(new Set(allBranchIds));
  }, [allBranchIds]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const expandToShadows = useCallback(() => {
    if (!tree || !shadowInsertions?.length) return;
    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    setExpanded(new Set([...ancestorIds, ...targetIds]));
    requestScrollTo(shadowInsertions[0].targetRegionId);
  }, [tree, shadowInsertions, requestScrollTo]);

  // Category ID lists for navigation
  const unresolvedIds = useMemo(() => tree ? findUnresolvedNodes(tree) : [], [tree]);
  const singleChildIds = useMemo(() => tree ? findSingleChildNodes(tree) : [], [tree]);
  const warningIds = useMemo(() => tree ? findNodesWithWarnings(tree) : [], [tree]);

  // Regions with children coverage < 99% (only containers with coverage data)
  const incompleteCoverageIds = useMemo(() => {
    if (!coverageData?.coverage) return [];
    const ids: number[] = [];
    for (const [key, pct] of Object.entries(coverageData.coverage)) {
      if (pct < 0.99) ids.push(Number(key));
    }
    return ids;
  }, [coverageData?.coverage]);

  // Unified category navigation state
  const [activeNav, setActiveNav] = useState<{ category: NavCategory; idx: number } | null>(null);

  const navIdsMap: Record<NavCategory, number[]> = useMemo(() => ({
    unresolved: unresolvedIds,
    warnings: warningIds,
    'single-child': singleChildIds,
    'incomplete-coverage': incompleteCoverageIds,
  }), [unresolvedIds, warningIds, singleChildIds, incompleteCoverageIds]);

  // Region clicked from review drawer
  const [reviewHighlightId, setReviewHighlightId] = useState<number | null>(null);

  const highlightedRegionId = activeNav
    ? navIdsMap[activeNav.category][activeNav.idx] ?? null
    : reviewHighlightId;

  const navigateTo = useCallback((category: NavCategory, idx: number) => {
    const ids = navIdsMap[category];
    if (!tree || idx < 0 || idx >= ids.length) return;
    setActiveNav({ category, idx });
    const targetId = ids[idx];
    const ancestorIds = collectAncestorsOfIds(tree, new Set([targetId]));
    setExpanded(prev => new Set([...prev, ...ancestorIds, targetId]));
    requestScrollTo(targetId);
  }, [tree, navIdsMap, requestScrollTo]);

  // When the nav list changes (item dismissed/resolved), clamp index and scroll to new current.
  // Compare by content length, not reference — optimistic updates create new array refs
  // with the same content, and reference comparison would trigger spurious scroll cycles.
  const prevNavLengthRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeNav) {
      prevNavLengthRef.current = null;
      return;
    }
    const ids = navIdsMap[activeNav.category];
    const prevLength = prevNavLengthRef.current;
    prevNavLengthRef.current = ids.length;

    if (ids.length === 0) {
      setActiveNav(null);
      return;
    }

    // List content actually changed (length changed after accept/reject/dismiss)
    if (prevLength != null && prevLength !== ids.length) {
      const clampedIdx = Math.min(activeNav.idx, ids.length - 1);
      if (clampedIdx !== activeNav.idx) {
        setActiveNav({ category: activeNav.category, idx: clampedIdx });
      }
      // Scroll to the (possibly new) item at this index
      const targetId = ids[clampedIdx];
      if (tree) {
        const ancestorIds = collectAncestorsOfIds(tree, new Set([targetId]));
        setExpanded(prev => new Set([...prev, ...ancestorIds, targetId]));
        requestScrollTo(targetId);
      }
    } else if (activeNav.idx >= ids.length) {
      setActiveNav({ category: activeNav.category, idx: ids.length - 1 });
    }
  }, [activeNav, navIdsMap, tree, requestScrollTo]);

  // Navigate to a specific region by ID (expand ancestors, scroll, highlight)
  const navigateToRegion = useCallback((regionId: number) => {
    if (!tree) return;
    setActiveNav(null);
    setReviewHighlightId(regionId);
    const ancestorIds = collectAncestorsOfIds(tree, new Set([regionId]));
    setExpanded(prev => new Set([...prev, ...ancestorIds, regionId]));
    requestScrollTo(regionId);
  }, [tree, requestScrollTo]);

  // Auto-expand tree ancestors when shadow insertions appear
  const prevShadowCount = useRef(0);
  useEffect(() => {
    if (!tree || !shadowInsertions?.length) {
      prevShadowCount.current = 0;
      return;
    }
    if (prevShadowCount.current === shadowInsertions.length) return;
    prevShadowCount.current = shadowInsertions.length;

    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    // Also expand the target nodes themselves (for create_region, shadows appear as children)
    setExpanded(prev => new Set([...prev, ...ancestorIds, ...targetIds]));

    requestScrollTo(shadowInsertions[0].targetRegionId);
  }, [tree, shadowInsertions, requestScrollTo]);

  return {
    expanded,
    toggleExpand,
    expandAll,
    collapseAll,
    expandToShadows,

    flatItems,
    virtualizer,
    parentRef,

    activeNav,
    setActiveNav,
    navIdsMap,
    navigateTo,

    highlightedRegionId,
    navigateToRegion,

    unresolvedIds,
    singleChildIds,
    warningIds,
    incompleteCoverageIds,

    shadowsByRegionId,

    requestScrollTo,
  };
}

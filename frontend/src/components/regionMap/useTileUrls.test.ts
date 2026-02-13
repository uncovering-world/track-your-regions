import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTileUrls } from './useTileUrls';

// Mock useNavigation
const mockNavigation = {
  selectedWorldView: null as { id: number } | null,
  selectedWorldViewId: null as number | null,
  isCustomWorldView: false,
  tileVersion: 1,
};

vi.mock('../../hooks/useNavigation', () => ({
  useNavigation: () => mockNavigation,
}));

vi.mock('../../api', () => ({
  MARTIN_URL: 'http://martin:3000',
}));

beforeEach(() => {
  mockNavigation.selectedWorldView = null;
  mockNavigation.selectedWorldViewId = null;
  mockNavigation.isCustomWorldView = false;
  mockNavigation.tileVersion = 1;
});

describe('useTileUrls — contextLayers', () => {
  it('returns empty for GADM (non-custom world view)', () => {
    mockNavigation.selectedWorldViewId = 1;
    mockNavigation.isCustomWorldView = false;

    const { result } = renderHook(() =>
      useTileUrls('all-leaf', 'root', [{ id: 5, parentRegionId: null }], true),
    );

    expect(result.current.contextLayers).toEqual([]);
  });

  it('returns empty when no world view is selected', () => {
    mockNavigation.isCustomWorldView = true;
    mockNavigation.selectedWorldViewId = null;

    const { result } = renderHook(() =>
      useTileUrls('all-leaf', 'root', [{ id: 5, parentRegionId: null }], true),
    );

    expect(result.current.contextLayers).toEqual([]);
  });

  it('returns empty when no breadcrumbs are provided', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() => useTileUrls(5, 'root'));

    expect(result.current.contextLayers).toEqual([]);
  });

  it('returns empty for root-level leaf (no ancestors above)', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    // Root-level leaf like Antarctica — only 1 breadcrumb (itself), sliced to []
    const { result } = renderHook(() =>
      useTileUrls('all-leaf', 'root', [{ id: 30, parentRegionId: null }], false),
    );

    expect(result.current.contextLayers).toEqual([]);
  });

  it('returns ancestor context for leaf region (excluding leaf itself)', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    // Leaf Wallonia: breadcrumbs = [Europe, Benelux, Belgium, Wallonia]
    // Context should be [Europe, Benelux, Belgium] — NOT Wallonia (siblings in main tiles)
    const { result } = renderHook(() =>
      useTileUrls(300, 'root', [
        { id: 5, parentRegionId: null },
        { id: 10, parentRegionId: 5 },
        { id: 20, parentRegionId: 10 },
        { id: 40, parentRegionId: 20 },
      ], false),
    );

    expect(result.current.contextLayers).toHaveLength(3);
    expect(result.current.contextLayers[0].highlightId).toBe(5);
    expect(result.current.contextLayers[0].url).toContain('tile_world_view_root_regions');
    expect(result.current.contextLayers[1].highlightId).toBe(10);
    expect(result.current.contextLayers[1].url).toContain('parent_id=5');
    expect(result.current.contextLayers[2].highlightId).toBe(20);
    expect(result.current.contextLayers[2].url).toContain('parent_id=10');
  });

  it('returns root regions URL for root-level breadcrumb (parentRegionId=null)', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() =>
      useTileUrls(5, 'root', [{ id: 5, parentRegionId: null }], true),
    );

    expect(result.current.contextLayers).toHaveLength(1);
    expect(result.current.contextLayers[0].url).toContain('tile_world_view_root_regions');
    expect(result.current.contextLayers[0].url).toContain('world_view_id=2');
    expect(result.current.contextLayers[0].highlightId).toBe(5);
  });

  it('returns subregions URL for nested breadcrumb', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() =>
      useTileUrls(10, 'root', [
        { id: 5, parentRegionId: null },
        { id: 10, parentRegionId: 5 },
      ], true),
    );

    expect(result.current.contextLayers).toHaveLength(2);
    // First layer: root level
    expect(result.current.contextLayers[0].url).toContain('tile_world_view_root_regions');
    expect(result.current.contextLayers[0].highlightId).toBe(5);
    // Second layer: nested level
    expect(result.current.contextLayers[1].url).toContain('tile_region_subregions');
    expect(result.current.contextLayers[1].url).toContain('parent_id=5');
    expect(result.current.contextLayers[1].highlightId).toBe(10);
  });

  it('returns 3 layers for deeply nested breadcrumbs', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() =>
      useTileUrls(30, 'root', [
        { id: 5, parentRegionId: null },
        { id: 10, parentRegionId: 5 },
        { id: 30, parentRegionId: 10 },
      ], true),
    );

    expect(result.current.contextLayers).toHaveLength(3);
    expect(result.current.contextLayers[0].highlightId).toBe(5);
    expect(result.current.contextLayers[1].highlightId).toBe(10);
    expect(result.current.contextLayers[1].url).toContain('parent_id=5');
    expect(result.current.contextLayers[2].highlightId).toBe(30);
    expect(result.current.contextLayers[2].url).toContain('parent_id=10');
  });

  it('includes tile version in URL for cache busting', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;
    mockNavigation.tileVersion = 42;

    const { result } = renderHook(() =>
      useTileUrls(10, 'root', [{ id: 10, parentRegionId: 5 }], true),
    );

    expect(result.current.contextLayers[0].url).toContain('_v=42');
  });
});

describe('useTileUrls — Source key uniqueness', () => {
  // react-map-gl throws "source id changed" if two <Source> components share the
  // same React key during the same render.  RegionMapVT uses tile URLs (with a
  // source-id prefix for overlay sources) as keys.  This test verifies uniqueness
  // across every representative navigation state so a future URL change can't
  // silently introduce a key collision.

  /**
   * Mirrors the React key computation in RegionMapVT.tsx.
   * Each Source's key is: plain URL for the main source, prefixed for overlays.
   */
  function sourceKeys(urls: ReturnType<typeof useTileUrls>) {
    const keys: string[] = [];
    if (urls.tileUrl) keys.push(urls.tileUrl);
    if (urls.islandTileUrl) keys.push(urls.islandTileUrl);
    for (let i = 0; i < urls.contextLayers.length; i++) {
      keys.push(`context-${i}:${urls.contextLayers[i].url}`);
    }
    if (urls.rootRegionsBorderUrl) keys.push(`root-regions:${urls.rootRegionsBorderUrl}`);
    return keys;
  }

  interface Scenario {
    name: string;
    isCustom: boolean;
    viewingRegionId: 'all-leaf' | number;
    viewingParentId: 'root' | number;
    breadcrumbs?: { id: number; parentRegionId: number | null }[];
    hasSubregions?: boolean;
  }

  const scenarios: Scenario[] = [
    // GADM views
    { name: 'GADM root',           isCustom: false, viewingRegionId: 'all-leaf', viewingParentId: 'root' },
    { name: 'GADM subdivision',    isCustom: false, viewingRegionId: 'all-leaf', viewingParentId: 100 },

    // Custom world view — no selection
    { name: 'custom root, no selection',
      isCustom: true, viewingRegionId: 'all-leaf', viewingParentId: 'root' },

    // Custom — root-level non-leaf selected (the scenario that triggered the original bug)
    { name: 'custom root-level non-leaf selected (e.g. Europe)',
      isCustom: true, viewingRegionId: 5, viewingParentId: 'root',
      breadcrumbs: [{ id: 5, parentRegionId: null }], hasSubregions: true },

    // Custom — nested non-leaf selected
    { name: 'custom nested non-leaf selected (e.g. Western Europe)',
      isCustom: true, viewingRegionId: 10, viewingParentId: 'root',
      breadcrumbs: [{ id: 5, parentRegionId: null }, { id: 10, parentRegionId: 5 }], hasSubregions: true },

    // Custom — leaf region selected
    { name: 'custom leaf selected (e.g. France)',
      isCustom: true, viewingRegionId: 5, viewingParentId: 'root',
      breadcrumbs: [{ id: 5, parentRegionId: null }, { id: 20, parentRegionId: 5 }], hasSubregions: false },

    // Custom — root-level leaf selected
    { name: 'custom root-level leaf (e.g. Antarctica)',
      isCustom: true, viewingRegionId: 'all-leaf', viewingParentId: 'root',
      breadcrumbs: [{ id: 30, parentRegionId: null }], hasSubregions: false },
  ];

  for (const s of scenarios) {
    it(`all Source keys are unique: ${s.name}`, () => {
      mockNavigation.selectedWorldViewId = s.isCustom ? 2 : 1;
      mockNavigation.isCustomWorldView = s.isCustom;

      const { result } = renderHook(() =>
        useTileUrls(s.viewingRegionId, s.viewingParentId, s.breadcrumbs, s.hasSubregions),
      );

      const keys = sourceKeys(result.current);
      const unique = new Set(keys);
      expect(keys.length).toBe(unique.size);
    });
  }

  it('detects collision when keys are NOT prefixed (regression guard)', () => {
    // Simulate the bug: compute keys WITHOUT prefixes and show they collide
    // in the transition scenario (root → root-level non-leaf).
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    // State A: root level — rootRegionsBorderUrl is active
    const { result: a } = renderHook(() => useTileUrls('all-leaf', 'root'));
    // State B: root-level non-leaf — contextLayers is active
    const { result: b } = renderHook(() =>
      useTileUrls(5, 'root', [{ id: 5, parentRegionId: null }], true),
    );

    // Without prefixes, the raw URLs share the same endpoint across states.
    // This is what caused react-map-gl's "source id changed" error.
    const rawUrlA = a.current.rootRegionsBorderUrl;
    const rawUrlB = b.current.contextLayers[0]?.url;
    expect(rawUrlA).toContain('tile_world_view_root_regions');
    expect(rawUrlB).toContain('tile_world_view_root_regions');
  });
});

describe('useTileUrls — tileUrl', () => {
  it('returns null when no world view is selected', () => {
    const { result } = renderHook(() => useTileUrls('all-leaf', 'root'));
    expect(result.current.tileUrl).toBeNull();
  });

  it('returns leaf regions URL for custom world view at root', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() => useTileUrls('all-leaf', 'root'));

    expect(result.current.tileUrl).toContain('tile_world_view_all_leaf_regions');
    expect(result.current.tileUrl).toContain('world_view_id=2');
  });

  it('returns subregions URL for custom world view with parent', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() => useTileUrls(5, 'root'));

    expect(result.current.tileUrl).toContain('tile_region_subregions');
    expect(result.current.tileUrl).toContain('parent_id=5');
  });

  it('returns GADM root URL for non-custom world view at root', () => {
    mockNavigation.selectedWorldViewId = 1;
    mockNavigation.isCustomWorldView = false;

    const { result } = renderHook(() => useTileUrls('all-leaf', 'root'));

    expect(result.current.tileUrl).toContain('tile_gadm_root_divisions');
  });

  it('returns GADM subdivisions URL for non-custom world view with parent', () => {
    mockNavigation.selectedWorldViewId = 1;
    mockNavigation.isCustomWorldView = false;

    const { result } = renderHook(() => useTileUrls('all-leaf', 100));

    expect(result.current.tileUrl).toContain('tile_gadm_subdivisions');
    expect(result.current.tileUrl).toContain('parent_id=100');
  });
});

describe('useTileUrls — rootRegionsBorderUrl', () => {
  it('returns URL only at root level in custom world view', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() => useTileUrls('all-leaf', 'root'));

    expect(result.current.rootRegionsBorderUrl).toContain('tile_world_view_root_regions');
  });

  it('returns null when not at root level', () => {
    mockNavigation.selectedWorldViewId = 2;
    mockNavigation.isCustomWorldView = true;

    const { result } = renderHook(() => useTileUrls(5, 'root'));

    expect(result.current.rootRegionsBorderUrl).toBeNull();
  });

  it('returns null for GADM world view', () => {
    mockNavigation.selectedWorldViewId = 1;
    mockNavigation.isCustomWorldView = false;

    const { result } = renderHook(() => useTileUrls('all-leaf', 'root'));

    expect(result.current.rootRegionsBorderUrl).toBeNull();
  });
});

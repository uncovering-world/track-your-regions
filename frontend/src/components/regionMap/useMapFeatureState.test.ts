import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';

import { useMapFeatureState } from './useMapFeatureState';
import { RegionHoverProvider, useRegionHoverActions } from '../../hooks/useRegionHover';

/**
 * The blocking overlay is raised on every tile URL change and lowered only by an
 * `isSourceLoaded` event. Nothing guarantees that event: a source whose tile
 * request errors, or one that never answers, leaves `isSourceLoaded` false for
 * good, and the overlay covers the entire canvas. The map was then unusable with
 * no way back — the symptom that made the 1-1 base layer look like it loaded
 * forever, even though the underlying tiles were merely slow.
 */
type Handler = (e: unknown) => void;

function makeMap() {
  const handlers = new Map<string, Set<Handler>>();
  const map = {
    on: vi.fn((event: string, fn: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: Handler) => {
      handlers.get(event)?.delete(fn);
    }),
    getSource: vi.fn(() => undefined),
    isSourceLoaded: vi.fn(() => false),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    getLayer: vi.fn(() => undefined),
    querySourceFeatures: vi.fn(() => []),
    getStyle: vi.fn(() => ({ layers: [] })),
  };
  const emit = (event: string, payload: unknown) => {
    for (const fn of handlers.get(event) ?? []) fn(payload);
  };
  return { map, emit, handlers };
}

/** The store's setter, for the hover tests below; null between renders. */
let hoverActions: ReturnType<typeof useRegionHoverActions> | null = null;
function GrabHoverActions() {
  hoverActions = useRegionHoverActions();
  return null;
}

function renderState(
  map: ReturnType<typeof makeMap>['map'],
  mapLoaded = true,
  tileUrl: string | null = 'http://martin.test/tiles/{z}/{x}/{y}',
) {
  hoverActions = null;
  const mapRef = { current: { getMap: () => map } as unknown as MapRef };
  return renderHook(
    ({ url }: { url: string | null }) =>
      useMapFeatureState({
        mapRef: mapRef as React.RefObject<MapRef | null>,
        mapLoaded,
        isCustomWorldView: true,
        isExploring: false,
        visitedRegionIds: undefined,
        sourceLayerName: 'regions',
        tileUrl: url,
        viewingRegionId: 'all-leaf',
        contextLayerCount: 0,
      }),
    {
      initialProps: { url: tileUrl },
      // The hover arrives from the region hover store's subscription now, so
      // the hook needs the provider even where a test never hovers anything.
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(RegionHoverProvider, null, createElement(GrabHoverActions), children),
    },
  );
}

describe('useMapFeatureState tile readiness', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gives up blocking the map when the source never finishes loading', () => {
    const { map } = makeMap();
    const { result } = renderState(map);

    expect(result.current.tilesReady).toBe(false);
    expect(result.current.tilesStalled).toBe(false);

    act(() => { vi.advanceTimersByTime(30_000); });

    // Still not ready — the point is that the overlay comes down anyway.
    expect(result.current.tilesReady).toBe(false);
    expect(result.current.tilesStalled).toBe(true);
  });

  it('gives up even when the map itself never finishes loading', () => {
    // Observed in the browser: not one tile request was made, because the map
    // never reached `load`. A guard that waits for the map cannot help there,
    // and that is exactly when the overlay has nothing else to bring it down.
    const { map } = makeMap();
    const { result } = renderState(map, false);

    act(() => { vi.advanceTimersByTime(30_000); });

    expect(result.current.tilesStalled).toBe(true);
  });

  it('gives up when there is no tile URL to wait for', () => {
    // The first paint, and permanent if /api/world-views never answers: no world
    // view is picked, so useTileUrls returns null forever. The overlay is bound
    // to tilesReady and tilesStalled, not to tileUrl, so without a timer here it
    // covers the canvas of the landing page with nothing able to lower it.
    const { map } = makeMap();
    const { result } = renderState(map, true, null);

    act(() => { vi.advanceTimersByTime(30_000); });

    expect(result.current.tilesStalled).toBe(true);
  });

  it('gives up immediately when the source reports an error', () => {
    const { map, emit } = makeMap();
    const { result } = renderState(map);

    act(() => { emit('error', { sourceId: 'regions-vt' }); });

    expect(result.current.tilesStalled).toBe(true);
    expect(result.current.tilesReady).toBe(false);
  });

  it('still resolves when tiles arrive after an error', () => {
    // MapLibre reports one error per failed tile, so a single transient failure
    // must not cost the readiness signal — the notice would then outlive the
    // condition it describes, and the metadata indicator, gated on tilesReady,
    // would never render again.
    const { map, emit } = makeMap();
    const { result } = renderState(map);

    act(() => { emit('error', { sourceId: 'regions-vt' }); });
    expect(result.current.tilesStalled).toBe(true);

    act(() => { emit('sourcedata', { sourceId: 'regions-vt', isSourceLoaded: true }); });
    expect(result.current.tilesReady).toBe(true);
  });

  it('ignores errors from other sources', () => {
    const { map, emit } = makeMap();
    const { result } = renderState(map);

    act(() => { emit('error', { sourceId: 'experiences' }); });

    expect(result.current.tilesStalled).toBe(false);
  });

  it('does not raise the stall notice when tiles arrive in time', () => {
    const { map, emit } = makeMap();
    const { result } = renderState(map);

    act(() => { emit('sourcedata', { sourceId: 'regions-vt', isSourceLoaded: true }); });
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(result.current.tilesReady).toBe(true);
    expect(result.current.tilesStalled).toBe(false);
  });
});

/**
 * The hover half: painted from a store subscription now, which has no retry of
 * its own — the pre-store effect re-ran on every pointer move, so a source that
 * appeared late or was replaced was healed by the next hover. These pin the two
 * substitutes for that retry: the per-event source check, and the re-subscribe
 * on `tileUrl` whose call-once repaints the hover that was already standing.
 */
describe('useMapFeatureState hover painting', () => {
  it('paints a hover that arrived before the source, once the source lands', () => {
    const { map, emit } = makeMap();
    renderState(map);

    // Sources are added by react-map-gl after `load`: at subscribe time there
    // is nothing to paint on, and that must not end the story — the pointer
    // has not moved, so no later hover event will carry this id.
    act(() => { hoverActions!.setHoveredRegionId(7); });
    expect(map.setFeatureState).not.toHaveBeenCalled();

    map.getSource.mockReturnValue({} as never);
    act(() => { emit('sourcedata', { sourceId: 'regions-vt', isSourceLoaded: true }); });
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'regions-vt', sourceLayer: 'regions', id: 7 },
      { hovered: true },
    );
  });

  it('repaints the standing hover when the tile source is replaced', () => {
    const { map } = makeMap();
    map.getSource.mockReturnValue({} as never);
    const { rerender } = renderState(map);

    act(() => { hoverActions!.setHoveredRegionId(42); });
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'regions-vt', sourceLayer: 'regions', id: 42 },
      { hovered: true },
    );

    // Replacing the source wipes its feature state; the pointer has not moved,
    // so only the re-subscription's call-once can put the hover back.
    map.setFeatureState.mockClear();
    rerender({ url: 'http://martin.test/v2/{z}/{x}/{y}' });
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'regions-vt', sourceLayer: 'regions', id: 42 },
      { hovered: true },
    );
  });
});

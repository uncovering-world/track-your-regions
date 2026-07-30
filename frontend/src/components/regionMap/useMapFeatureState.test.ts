import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MapRef } from 'react-map-gl/maplibre';

import { useMapFeatureState } from './useMapFeatureState';

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

function renderState(
  map: ReturnType<typeof makeMap>['map'],
  mapLoaded = true,
  tileUrl: string | null = 'http://martin.test/tiles/{z}/{x}/{y}',
) {
  const mapRef = { current: { getMap: () => map } as unknown as MapRef };
  return renderHook(() =>
    useMapFeatureState({
      mapRef: mapRef as React.RefObject<MapRef | null>,
      mapLoaded,
      isCustomWorldView: true,
      isExploring: false,
      visitedRegionIds: undefined,
      hoveredRegionId: null,
      sourceLayerName: 'regions',
      tileUrl,
      viewingRegionId: 'all-leaf',
      contextLayerCount: 0,
    }),
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

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MapRef } from 'react-map-gl/maplibre';
import { selectionDuration, useMapInteractions, WORLD_ZOOM } from './useMapInteractions';

const mockNavigation = {
  selectedDivision: null,
  selectedWorldView: { id: 9001 },
  setSelectedDivision: vi.fn(),
  isCustomWorldView: true,
  selectedRegion: null as Record<string, unknown> | null,
  setSelectedRegion: vi.fn(),
  regionBreadcrumbs: [],
};

vi.mock('../../hooks/useNavigation', () => ({ useNavigation: () => mockNavigation }));
vi.mock('../../hooks/useRegionHover', () => ({ useRegionHoverActions: () => ({ setHoveredRegionId: vi.fn() }) }));
vi.mock('../../hooks/useExperienceContext', () => ({ useExperienceContext: () => ({ isExploring: false }) }));
vi.mock('../../api', () => ({ fetchDivision: vi.fn() }));
vi.mock('../../utils/mapUtils', () => ({ smartFitBounds: vi.fn() }));

import { smartFitBounds } from '../../utils/mapUtils';

const mockedFit = smartFitBounds as unknown as ReturnType<typeof vi.fn>;

/** A map whose camera stands at `zoom` in a container `height` CSS pixels tall. */
const at = (zoom: number, height = 800) => ({
  getZoom: () => zoom,
  getContainer: () => ({ clientHeight: height }) as HTMLElement,
});

/** The map the hook is handed, with the listeners its hover effect adds. */
function mapAt(zoom: number, height = 800): MapRef {
  const container = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  return { ...at(zoom, height), getMap: () => ({ getContainer: () => container }), flyTo: vi.fn() } as unknown as MapRef;
}

/** Open the map on Testland, as a page opened on its address does. */
function openOnRegion(map: MapRef): void {
  mockNavigation.selectedRegion = {
    id: 9001, name: 'Testland', focusBbox: [10, 40, 20, 50], anchorPoint: [15, 45],
  };
  renderHook(() => useMapInteractions({
    mapRef: { current: map }, mapLoaded: true, metadataById: {}, viewingRegionId: 9001, contextLayerCount: 0,
  }));
}

beforeEach(() => {
  mockedFit.mockReset();
  mockNavigation.selectedRegion = null;
});

describe('the flight to a selection (#1842)', () => {
  it('frames the region at once from the whole world the map opens on', () => {
    expect(selectionDuration(at(WORLD_ZOOM), 400)).toBe(0);
    expect(selectionDuration(at(0.4), 500)).toBe(0);
  });

  it('frames it at once from the whole world of a container taller than the world at zoom 1', () => {
    // 1 440 px tall: MapLibre opens on log2(1440 / 512) ≈ 1.49, the world filling the height.
    expect(selectionDuration(at(Math.log2(1440 / 512), 1440), 400)).toBe(0);
    expect(selectionDuration(at(2, 1440), 400)).toBe(400);
  });

  it('flies from a region, so the movement says where the next one lies', () => {
    expect(selectionDuration(at(4.2), 400)).toBe(400);
    expect(selectionDuration(at(WORLD_ZOOM + 0.1), 500)).toBe(500);
  });

  it('is the duration the region selection is framed with', () => {
    openOnRegion(mapAt(WORLD_ZOOM));
    expect(mockedFit).toHaveBeenCalledWith(expect.anything(), [10, 40, 20, 50], expect.objectContaining({ duration: 0 }));

    mockedFit.mockReset();
    openOnRegion(mapAt(5));
    expect(mockedFit).toHaveBeenCalledWith(expect.anything(), [10, 40, 20, 50], expect.objectContaining({ duration: 400 }));
  });
});

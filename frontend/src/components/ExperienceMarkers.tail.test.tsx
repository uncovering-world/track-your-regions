/**
 * What Map mode draws for an open tail's places (ADR-0172, #2122). The region's
 * batch leaves a crowded-out place out, so a tail's place of its own is one pin
 * at its own point, and a tail's place made of parts, which has no point of its
 * own, is drawn by the points of its card once the reader has opened it — the
 * answer the list's row reads too (`tailPoints`, `useTailLocations`).
 *
 * The map is a stub; the marker source's data is what is read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HoverProvider } from '../hooks/useHoverContext';
import type { Experience, RegionExperienceLocation } from '../api/experiences';

const drawn = vi.hoisted(() => ({ sources: {} as Record<string, GeoJSON.FeatureCollection> }));
const state = vi.hoisted(() => ({
  tailPlaces: [] as Experience[],
  tailPoints: {} as Record<number, RegionExperienceLocation[]>,
}));

vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: undefined }),
  Source: ({ id, data, children }: { id: string; data: GeoJSON.FeatureCollection; children?: ReactNode }) => {
    drawn.sources[id] = data;
    return <div>{children}</div>;
  },
  Layer: () => <div />,
}));
vi.mock('./experienceMarkers/useMarkerInteractions', () => ({ useMarkerInteractions: () => {} }));
vi.mock('../hooks/useExperienceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useExperienceContext')>()),
  useExperienceContext: () => ({
    experiences: [],
    experiencesLoading: false,
    selectedExperienceId: null,
    toggleSelectedExperience: () => {},
    flyToExperienceId: null,
    clearFlyTo: () => {},
    getExperienceById: (id: number) => state.tailPlaces.find(place => place.id === id),
    expandedKindNames: new Set<string>(),
    showLost: false,
    tail: { places: new Map([[5, state.tailPlaces]]) },
    tailPoints: state.tailPoints,
  }),
}));
vi.mock('../hooks/useRegionLocations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useRegionLocations')>()),
  useRegionLocations: () => ({ locationsByExperience: {} }),
}));

import { ExperienceMarkers } from './ExperienceMarkers';

/**
 * The Prehistoric Pile Dwellings around the Alps as an archaeology tail's place
 * made of parts, with two of its pile-dwelling sites (See in Austria, Riesi in
 * Switzerland). The coordinate its row carries is no point a traveller goes to.
 */
const PILE_DWELLINGS = {
  id: 418, name: 'Prehistoric Pile Dwellings around the Alps', kind_name: 'Archaeology', kind_id: 5,
  has_parts: true, longitude: 8.201, latitude: 47.317,
} as Experience;

/** A place of its own crowded out of Rome's archaeology. */
const OWN_PLACE = {
  id: 13472, name: 'Temple of Saturn', kind_name: 'Archaeology', kind_id: 5,
  has_parts: false, longitude: 12.4841, latitude: 41.8924,
} as Experience;

const part = (id: number, longitude: number, latitude: number) =>
  ({ id, experience_id: PILE_DWELLINGS.id, name: null, longitude, latitude, in_region: true }) as RegionExperienceLocation;

function drawWith(tailPlaces: Experience[], tailPoints: Record<number, RegionExperienceLocation[]> = {}) {
  state.tailPlaces = tailPlaces;
  state.tailPoints = tailPoints;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HoverProvider>
        <ExperienceMarkers regionId={1} />
      </HoverProvider>
    </QueryClientProvider>,
  );
  return drawn.sources['exp-markers'].features.map(feature => (feature.geometry as GeoJSON.Point).coordinates);
}

beforeEach(() => {
  drawn.sources = {};
});

describe("an open tail's places on the map", () => {
  it('draws a place made of parts by the points of its opened card', () => {
    const pins = drawWith([PILE_DWELLINGS], {
      [PILE_DWELLINGS.id]: [part(35267, 13.4493, 47.8039), part(35268, 8.201, 47.317)],
    });
    expect(pins).toEqual([[13.4493, 47.8039], [8.201, 47.317]]);
  });

  it('draws nothing for it at a point of its own while its card was never opened', () => {
    expect(drawWith([PILE_DWELLINGS])).toEqual([]);
  });

  it('draws a place of its own at its own point', () => {
    expect(drawWith([OWN_PLACE])).toEqual([[12.4841, 41.8924]]);
  });
});

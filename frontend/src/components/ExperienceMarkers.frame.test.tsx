/**
 * What a click in the list frames (#2122): what the map is drawing. An object
 * made of parts has no coordinate of its own, and the map draws nothing for it
 * while the region's batch holds none of its parts, so the click moves nothing
 * rather than flying to a point with nothing on it.
 *
 * The map is a stub that records what the camera was asked to do.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HoverProvider } from '../hooks/useHoverContext';
import type { Experience, ExperienceLocation } from '../api/experiences';

const camera = vi.hoisted(() => ({ cameraForBounds: [] as unknown[], flyTo: [] as unknown[] }));
const map = vi.hoisted(() => ({
  cameraForBounds: (bounds: [[number, number], [number, number]]) => {
    camera.cameraForBounds.push(bounds);
    const [[w, s], [e, n]] = bounds;
    return { center: [(w + e) / 2, (s + n) / 2], zoom: 9 };
  },
  flyTo: (options: unknown) => { camera.flyTo.push(options); },
  getZoom: () => 5,
  getSource: () => undefined,
}));
const state = vi.hoisted(() => ({
  place: undefined as Experience | undefined,
  locations: {} as Record<number, ExperienceLocation[]>,
}));

vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: { getMap: () => map } }),
  Source: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Layer: () => <div />,
}));
vi.mock('./experienceMarkers/useMarkerInteractions', () => ({ useMarkerInteractions: () => {} }));
vi.mock('./experienceMarkers/useExtentLayer', () => ({ useExtentLayer: () => ({ extentDataRef: { current: null } }) }));
vi.mock('./experienceMarkers/scene', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./experienceMarkers/scene')>()),
  addSplitPinImages: () => undefined,
}));
vi.mock('../hooks/useExperienceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useExperienceContext')>()),
  useExperienceContext: () => ({
    experiences: state.place ? [state.place] : [],
    experiencesLoading: false,
    selectedExperienceId: null,
    toggleSelectedExperience: () => {},
    flyToExperienceId: state.place?.id ?? null,
    clearFlyTo: () => {},
    getExperienceById: () => state.place,
    expandedKindNames: new Set<string>(),
    showLost: false,
    tail: { places: new Map() },
    tailPoints: {},
  }),
}));
vi.mock('../hooks/useRegionLocations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useRegionLocations')>()),
  useRegionLocations: () => ({ locationsByExperience: state.locations }),
}));

import { ExperienceMarkers } from './ExperienceMarkers';

/** Seville's site: the cathedral, the Alcázar and the Archivo de Indias. */
const SEVILLE = {
  id: 1175, name: 'Cathedral, Alcázar and Archivo de Indias in Seville', kind_name: 'World Heritage Sites', kind_id: 1,
  has_parts: true, longitude: -5.992326, latitude: 37.384788,
} as Experience;

const at = (id: number, longitude: number, latitude: number) =>
  ({ id, experience_id: 1175, name: null, longitude, latitude, in_region: true }) as ExperienceLocation;

function clickInTheList(place: Experience, locations: Record<number, ExperienceLocation[]> = {}) {
  state.place = place;
  state.locations = locations;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HoverProvider>
        <ExperienceMarkers regionId={1} />
      </HoverProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  camera.cameraForBounds.length = 0;
  camera.flyTo.length = 0;
});

describe('a click in the list frames what the map draws', () => {
  it('frames Seville by its three places once the batch holds them', () => {
    clickInTheList(SEVILLE, { 1175: [at(1, -5.9931, 37.3858), at(2, -5.9910, 37.3833), at(3, -5.9925, 37.3846)] });
    expect(camera.cameraForBounds).toEqual([[[-5.9931, 37.3833], [-5.991, 37.3858]]]);
    expect(camera.flyTo).toHaveLength(1);
  });

  it('moves nothing for an object made of parts while the batch holds none of them', () => {
    clickInTheList(SEVILLE);
    expect(camera.cameraForBounds).toEqual([]);
    expect(camera.flyTo).toEqual([]);
  });

  it('flies a place of its own to its own coordinate', () => {
    clickInTheList({ ...SEVILLE, id: 13223, name: 'Seville Cathedral', has_parts: false, longitude: -5.9931, latitude: 37.3858 });
    expect(camera.flyTo).toEqual([{ center: [-5.9931, 37.3858], zoom: 8, duration: 800 }]);
  });
});

/**
 * What a click in the list frames (#2122): a whole is framed by its places, or
 * by the frame of them its row carries while the region's batch holds none,
 * and never flown to a coordinate of its own, which it does not have.
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

/** Seville's site: the cathedral, the Alcázar and the Archivo de Indias, and no coordinate of its own. */
const SEVILLE = {
  id: 1175, name: 'Cathedral, Alcázar and Archivo de Indias in Seville', kind_name: 'World Heritage Sites', kind_id: 1,
  has_parts: true, longitude: null, latitude: null,
  focus: { bbox: [-5.993096, 37.383833, -5.991556, 37.385742], anchorPoint: [-5.992326, 37.384788] },
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

describe('a click in the list frames a whole by its places', () => {
  it('frames Seville by its three places once the batch holds them', () => {
    clickInTheList(SEVILLE, { 1175: [at(1, -5.9931, 37.3858), at(2, -5.9910, 37.3833), at(3, -5.9925, 37.3846)] });
    expect(camera.cameraForBounds).toEqual([[[-5.9931, 37.3833], [-5.991, 37.3858]]]);
    expect(camera.flyTo).toHaveLength(1);
  });

  it('frames it by the frame of its places while the batch holds none', () => {
    clickInTheList(SEVILLE);
    expect(camera.cameraForBounds).toEqual([[[-5.993096, 37.383833], [-5.991556, 37.385742]]]);
    expect(camera.flyTo).toHaveLength(1);
  });

  it('flies a whole across the antimeridian through its anchor', () => {
    clickInTheList({ ...SEVILLE, focus: { bbox: [179.5, -16.8, -179.6, -16.5], anchorPoint: [179.95, -16.65] } });
    expect((camera.flyTo[0] as { center: [number, number] }).center).toEqual([179.95, -16.65]);
  });

  it('moves nothing for a whole that shows no place', () => {
    clickInTheList({ ...SEVILLE, focus: undefined });
    expect(camera.flyTo).toEqual([]);
  });

  it('flies a place of its own to its own coordinate', () => {
    clickInTheList({ ...SEVILLE, id: 13223, name: 'Seville Cathedral', has_parts: false, longitude: -5.9931, latitude: 37.3858, focus: undefined });
    expect(camera.flyTo).toEqual([{ center: [-5.9931, 37.3858], zoom: 8, duration: 800 }]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { Experience } from '../../api/experiences';
import type { MarkerData } from './buildMarkers';
import { LAYER_HIGHLIGHT_POINT, LAYER_MARKERS } from './scene';
import { useMarkerInteractions } from './useMarkerInteractions';

vi.mock('maplibre-gl', () => ({
  Popup: class {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() { return this; }
  },
}));

/**
 * What a pointer on the pins and the selected object's dots does (#1916): the
 * hover card and the click read the same feature, and the card carries what
 * the list's hover card carries — the one-line subtitle among it.
 */

type Handler = (e: unknown) => void;

function fakeMap(under: () => MapGeoJSONFeature[]) {
  const handlers = new Map<string, Set<Handler>>();
  const key = (event: string, layer?: string) => (layer ? `${event}:${layer}` : event);
  const map = {
    on: vi.fn((event: string, a: string | Handler, b?: Handler) => {
      const k = typeof a === 'string' ? key(event, a) : key(event);
      const fn = (typeof a === 'string' ? b : a) as Handler;
      if (!handlers.has(k)) handlers.set(k, new Set());
      handlers.get(k)!.add(fn);
    }),
    off: vi.fn(),
    getLayer: vi.fn((id: string) => ({ id })),
    queryRenderedFeatures: vi.fn(() => under()),
    getCanvas: () => ({ style: {} as CSSStyleDeclaration }),
  };
  const emit = (event: string, layer: string | undefined, payload: unknown) => {
    for (const fn of handlers.get(key(event, layer)) ?? []) fn(payload);
  };
  return { map, emit };
}

const feature = (layer: string, properties: Record<string, unknown>, coordinates: [number, number]) => ({
  type: 'Feature', layer: { id: layer }, properties, geometry: { type: 'Point', coordinates },
} as unknown as MapGeoJSONFeature);

const serapeum = {
  id: 13926, name: 'Serapeum of Alexandria', subtitle: 'temple in Alexandria', kind_id: 4, kind_name: 'Places of worship',
  treasure_count: 0, finds_count: 0, image_url: null, image_credit: null,
} as unknown as Experience;
const pillar = {
  id: 11671, name: "Pompey's Pillar", subtitle: 'Roman triumphal column in Alexandria, Egypt', kind_id: 3,
  kind_name: 'Public art', treasure_count: 0, finds_count: 0, image_url: null, image_credit: null,
} as unknown as Experience;
const BY_ID = new Map<number, Experience>([[13926, serapeum], [11671, pillar]]);
const PILLAR: [number, number] = [29.8964, 31.1825];
const SERAPEUM: [number, number] = [29.8969, 31.1819];

const pillarPin = feature(LAYER_MARKERS, { experienceId: 11671, locationId: 777, experienceName: "Pompey's Pillar" }, PILLAR);
const serapeumDot = feature(LAYER_HIGHLIGHT_POINT, { locationId: 501, name: 'Serapeum of Alexandria' }, SERAPEUM);

const markers: MarkerData[] = [{
  id: '11671:777', experienceId: 11671, locationId: 777, experience: pillar, longitude: PILLAR[0], latitude: PILLAR[1],
  locationName: null, locationCount: 1,
}];

const point = { x: 10, y: 10 };
const event = { point, originalEvent: { type: 'mousemove' } };

describe('useMarkerInteractions', () => {
  const setHoverPreview = vi.fn();
  const setHoveredFromMarker = vi.fn();
  const openPart = vi.fn(() => false);
  const toggleSelectedExperience = vi.fn();
  const toggleCollapsedExperience = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  function mount(under: () => MapGeoJSONFeature[]) {
    const { map, emit } = fakeMap(under);
    const mapRef = { getMap: () => map } as unknown as MapRef;
    renderHook(() => useMarkerInteractions({
      mapRef,
      markersRef: { current: markers },
      selectedExperienceId: 13926,
      getExperienceById: (id: number) => BY_ID.get(id),
      getLocation: () => undefined,
      openPart,
      toggleSelectedExperience,
      toggleCollapsedExperience,
      setHoveredFromMarker,
      setHoverPreview,
      setHoverData: vi.fn(),
    }));
    return { emit };
  }

  it("names the dot's place on hover and keeps it on click where the dot covers a pin", () => {
    const { emit } = mount(() => [serapeumDot, pillarPin]);
    emit('mousemove', LAYER_MARKERS, event);
    expect(setHoveredFromMarker).toHaveBeenCalledWith(13926, 501);
    expect(setHoverPreview).toHaveBeenCalledWith(expect.objectContaining({
      experienceId: 13926, experienceName: 'Serapeum of Alexandria', subtitle: 'temple in Alexandria', locationId: 501,
    }));
    emit('click', undefined, event);
    expect(openPart).toHaveBeenCalledWith(13926, 501);
    expect(toggleSelectedExperience).not.toHaveBeenCalled();
  });

  it("names the pin's place on hover and selects it on click where the pin is alone", () => {
    const { emit } = mount(() => [pillarPin]);
    emit('mousemove', LAYER_HIGHLIGHT_POINT, event);
    expect(setHoveredFromMarker).toHaveBeenCalledWith(11671, 777);
    expect(setHoverPreview).toHaveBeenCalledWith(expect.objectContaining({
      experienceId: 11671, subtitle: 'Roman triumphal column in Alexandria, Egypt', locationId: 777,
    }));
    emit('click', undefined, event);
    expect(openPart).toHaveBeenCalledWith(11671, 777);
    expect(toggleSelectedExperience).toHaveBeenCalledWith(11671);
  });

  it("names no part on the dot of a one-point place, and reads the place in the popup (#1917)", () => {
    // The Serapeum's one point carries no name of its own: the card shows the
    // place, no part line and no "whole site's picture" note.
    const ownPoint = feature(LAYER_HIGHLIGHT_POINT, { locationId: 14249, name: null }, SERAPEUM);
    const { emit } = mount(() => [ownPoint]);
    emit('mousemove', LAYER_HIGHLIGHT_POINT, event);
    expect(setHoverPreview).toHaveBeenCalledWith(expect.objectContaining({
      experienceId: 13926, experienceName: 'Serapeum of Alexandria', locationId: 14249, locationName: null,
    }));
  });

  it('does nothing over empty map', () => {
    const { emit } = mount(() => []);
    emit('mousemove', LAYER_MARKERS, event);
    emit('click', undefined, event);
    expect(setHoverPreview).not.toHaveBeenCalled();
    expect(openPart).not.toHaveBeenCalled();
    expect(toggleSelectedExperience).not.toHaveBeenCalled();
  });
});

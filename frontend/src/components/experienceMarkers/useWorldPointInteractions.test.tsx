import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { MapRef } from 'react-map-gl/maplibre';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { WORLD_MARKER_LAYERS } from './worldPointLayers';
import { PICTURE_REST_MS, useWorldPointInteractions } from './useWorldPointInteractions';
import { fetchExperiencePicture } from '../../api/experiences';
import type { HoverPreview } from '../../hooks/useHoverContext';

vi.mock('maplibre-gl', () => ({
  Popup: class {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() { return this; }
  },
}));

vi.mock('../../api/experiences', () => ({ fetchExperiencePicture: vi.fn() }));

/**
 * The world map's hover card and its picture (#927): the picture is asked for
 * once the pointer rests on a pin, never on a sweep, once per place, a part's
 * own before its site's, and drawn only while the pointer is still on the
 * place it was asked for.
 */

type Handler = (e: unknown) => void;

function fakeMap() {
  const handlers = new Map<string, Set<Handler>>();
  let under: MapGeoJSONFeature[] = [];
  const map = {
    on: vi.fn((event: string, fn: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    }),
    off: vi.fn(),
    getLayer: vi.fn((id: string) => ({ id })),
    queryRenderedFeatures: vi.fn(() => under),
    getCanvas: () => ({ style: {} as CSSStyleDeclaration }),
  };
  /** Moves the pointer onto `features`, or off every pin with none. */
  const moveOnto = (...features: MapGeoJSONFeature[]) => {
    under = features;
    for (const fn of handlers.get('mousemove') ?? []) fn({ point: { x: 10, y: 10 } });
  };
  return { map, moveOnto };
}

const pin = (experienceId: number, locationId: number, experienceName: string, coordinates: [number, number]) => ({
  type: 'Feature', layer: { id: WORLD_MARKER_LAYERS[0] },
  properties: { experienceId, locationId, experienceName, kindId: 1 },
  geometry: { type: 'Point', coordinates },
} as unknown as MapGeoJSONFeature);

// Two stations of the Struve Geodetic Arc, one serial World Heritage site, and
// a cathedral of its own.
const ARC = 501;
const tartu = pin(ARC, 9001, 'Struve Geodetic Arc', [26.7197, 58.3787]);
const hammerfest = pin(ARC, 9002, 'Struve Geodetic Arc', [23.6826, 70.6727]);
const cologne = pin(77, 9100, 'Cologne Cathedral', [6.9583, 50.9413]);

const credit = { author: 'A Commons photographer', license: 'CC BY-SA 3.0', licenseUrl: null, detailsUrl: null };
const arcPicture = {
  image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Struve_Geodetic_Arc_map.jpg',
  image_credit: credit,
  point: null as { image_url: string | null; image_credit: typeof credit | null } | null,
};

const mockedFetch = fetchExperiencePicture as unknown as ReturnType<typeof vi.fn>;

describe('useWorldPointInteractions — the hover card picture', () => {
  const setHoverPreview = vi.fn();
  let queryClient: QueryClient;
  let unmount: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue(arcPicture);
  });
  afterEach(() => { vi.useRealTimers(); });

  function mount() {
    const { map, moveOnto } = fakeMap();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    ({ unmount } = renderHook(() => useWorldPointInteractions({
      mapRef: { getMap: () => map } as unknown as MapRef,
      queryClient,
      kindNameOf: () => 'World Heritage Sites',
      setHoverPreview,
      setHoverData: vi.fn(),
      openPoint: vi.fn(),
    })));
    return moveOnto;
  }

  const lastPreview = () => setHoverPreview.mock.calls.at(-1)?.[0] as HoverPreview | null;

  it('asks nothing while the pointer only crosses pins', async () => {
    const moveOnto = mount();
    moveOnto(tartu);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS - 20);
    moveOnto(cologne);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS - 20);
    moveOnto();
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS * 3);

    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('asks once the pointer rests, and draws the picture with its credit', async () => {
    const moveOnto = mount();
    moveOnto(tartu);
    expect(lastPreview()?.imageUrl).toBeNull();

    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(ARC, 9001);
    expect(lastPreview()).toMatchObject({ imageUrl: arcPicture.image_url, imageCredit: credit });
  });

  it('answers a place already asked from the cache, at once', async () => {
    const moveOnto = mount();
    moveOnto(tartu);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);
    moveOnto(cologne);
    moveOnto(tartu);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(lastPreview()).toMatchObject({ locationId: 9001, imageUrl: arcPicture.image_url });
  });

  it('asks again, after a rest, once an edit has made the object stale', async () => {
    const edited = 'https://commons.wikimedia.org/wiki/Special:FilePath/Struve_arc_station.jpg';
    const moveOnto = mount();
    moveOnto(tartu);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);
    mockedFetch.mockResolvedValueOnce({ ...arcPicture, image_url: edited });
    await queryClient.invalidateQueries({ queryKey: ['experience', ARC], refetchType: 'none' });
    moveOnto(cologne);
    moveOnto(tartu);
    expect(lastPreview()).toMatchObject({ locationId: 9001, imageUrl: null });

    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);
    expect(mockedFetch).toHaveBeenLastCalledWith(ARC, 9001);
    expect(lastPreview()).toMatchObject({ imageUrl: edited });
  });

  it('shows a part\'s own picture, and says so when it is the whole site\'s instead', async () => {
    const tartuOwn = 'https://commons.wikimedia.org/wiki/Special:FilePath/Tartu_observatory.jpg';
    mockedFetch
      .mockResolvedValueOnce({ ...arcPicture, point: { image_url: tartuOwn, image_credit: credit } })
      .mockResolvedValueOnce({ ...arcPicture, point: { image_url: null, image_credit: null } });
    const moveOnto = mount();
    moveOnto(tartu);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);
    expect(lastPreview()).toMatchObject({ imageUrl: tartuOwn, pictureOfObject: false });

    moveOnto(hammerfest);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);
    expect(mockedFetch).toHaveBeenLastCalledWith(ARC, 9002);
    expect(lastPreview()).toMatchObject({ locationId: 9002, imageUrl: arcPicture.image_url, pictureOfObject: true });
  });

  it('draws nothing after the map is gone', async () => {
    let answer!: (value: typeof arcPicture) => void;
    mockedFetch.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
    const moveOnto = mount();
    moveOnto(tartu);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);
    unmount();
    answer(arcPicture);
    await vi.advanceTimersByTimeAsync(0);

    expect(lastPreview()).toBeNull();
  });

  it('never draws an answer on a place the pointer has left', async () => {
    let answer!: (value: typeof arcPicture) => void;
    mockedFetch.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
    const moveOnto = mount();
    moveOnto(tartu);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);
    moveOnto(cologne);
    answer(arcPicture);
    await vi.advanceTimersByTimeAsync(0);

    expect(lastPreview()).toMatchObject({ experienceName: 'Cologne Cathedral', imageUrl: null });
  });

  it('leaves the card without a picture when the read is refused', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('429'));
    const moveOnto = mount();
    moveOnto(cologne);
    await vi.advanceTimersByTimeAsync(PICTURE_REST_MS);

    expect(lastPreview()).toMatchObject({ experienceName: 'Cologne Cathedral', imageUrl: null });
  });
});

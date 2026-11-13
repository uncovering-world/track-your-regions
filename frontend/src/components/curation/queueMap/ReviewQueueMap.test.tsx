/**
 * The review queue's map (#2477), with the map mocked: what it is handed to draw, what
 * a click on a place opens, the short list of a place several questions are about, the
 * line under the map, the line after a walk to the next question, and where the camera goes. The markers' own data is
 * `queueMapData.test.ts`'s.
 */

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  act, cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as webgl from '../../../utils/webgl';
import { EMPTY_REVIEW, type ReviewAddress } from '../../../utils/appUrl';
import type { QueueMapPlace, ReviewQueueMap as QueueMapRead } from '../../../api/reviewQueue';

/** What the mocked map was last handed, so a test can click it as MapLibre would. */
const { theMap, mockFetchMap, mockAncestors } = vi.hoisted(() => {
  const state = {
    props: {} as Record<string, unknown>,
    zoom: 3,
    // The view the camera shows, west to east and south to north: central Rome.
    view: [12.46, 41.89, 12.49, 41.905],
    easeTo: vi.fn(),
    getBounds: () => ({
      getWest: () => state.view[0],
      getSouth: () => state.view[1],
      getEast: () => state.view[2],
      getNorth: () => state.view[3],
    }),
  };
  return { theMap: state, mockFetchMap: vi.fn(), mockAncestors: vi.fn() };
});

vi.mock('react-map-gl/maplibre', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react');
  const MapGL = forwardRef(function MapGL(props: Record<string, unknown> & { children?: ReactNode }, ref) {
    theMap.props = props;
    useImperativeHandle(ref, () => ({
      getMap: () => ({ id: 'the-map' }),
      getZoom: () => theMap.zoom,
      getBounds: theMap.getBounds,
      easeTo: theMap.easeTo,
    }));
    const { onLoad } = props as { onLoad?: () => void };
    useEffect(() => { onLoad?.(); }, [onLoad]);
    return <div data-testid="the-map">{props.children}</div>;
  });
  return {
    default: MapGL,
    NavigationControl: () => null,
    Source: ({ id, data, children }: { id: string; data: unknown; children?: ReactNode }) => (
      <div data-testid={`source-${id}`} data-features={JSON.stringify(data)}>{children}</div>
    ),
    Layer: () => null,
  };
});

vi.mock('../../../api/reviewQueue', () => ({ fetchReviewQueueMap: mockFetchMap }));
vi.mock('../../../api/regions', () => ({ fetchRegionAncestors: mockAncestors }));
vi.mock('../../../utils/mapUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/mapUtils')>()),
  frameGeoJson: vi.fn(),
  smartFitBounds: vi.fn(),
}));

import { frameGeoJson, smartFitBounds } from '../../../utils/mapUtils';
import { ReviewQueueMap } from './ReviewQueueMap';
import type { MapStep } from './queueMapData';

/** Two places in Rome, their ids and questions made up: one two kinds ask about, and one arrival. */
const PANTHEON: QueueMapPlace = {
  placeId: 4120, lon: 12.47685, lat: 41.89861,
  questions: [{ kind: 'conflict', subs: [] }, { kind: 'waiting', subs: ['held'] }],
};
const SANTA_PRASSEDE: QueueMapPlace = {
  placeId: 88213, lon: 12.49845, lat: 41.89622,
  questions: [{ kind: 'waiting', subs: ['arrival'] }],
};
const ROME: QueueMapRead = { places: [PANTHEON, SANTA_PRASSEDE], unplaced: 0 };

function renderMap(address: Partial<ReviewAddress> = {}) {
  const onOpen = vi.fn();
  const onShowList = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewQueueMap
        address={{ ...EMPTY_REVIEW, view: 'map', ...address }}
        placeName={id => (id === 4120 ? 'Pantheon' : undefined)}
        onOpen={onOpen}
        onShowList={onShowList}
      />
    </QueryClientProvider>,
  );
  return { onOpen, onShowList, client };
}

/** The map under one query client, so a change of chips keeps what the client already read. */
function renderChanging() {
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (address: Partial<ReviewAddress>) => (
    <QueryClientProvider client={client}>
      <ReviewQueueMap address={{ ...EMPTY_REVIEW, view: 'map', ...address }} placeName={() => undefined} onOpen={onOpen} onShowList={vi.fn()} />
    </QueryClientProvider>
  );
  const { rerender } = render(view({}));
  return { onOpen, rerender: (address: Partial<ReviewAddress>) => rerender(view(address)) };
}

/** A click on the map as react-map-gl reports one: the features under the pointer. */
function clickPlace(placeId: number | undefined | number[]) {
  const onClick = theMap.props.onClick as (event: unknown) => void;
  let ids: number[] = [];
  if (Array.isArray(placeId)) ids = placeId;
  else if (placeId !== undefined) ids = [placeId];
  act(() => onClick({
    features: ids.map(id => ({ id })),
    originalEvent: { clientX: 200, clientY: 150 },
  }));
}

function drawn(sourceId: string): GeoJSON.FeatureCollection {
  return JSON.parse(screen.getByTestId(`source-${sourceId}`).dataset.features ?? '{}');
}

beforeEach(() => {
  vi.spyOn(webgl, 'isWebGLAvailable').mockReturnValue(true);
  mockFetchMap.mockReset().mockResolvedValue(ROME);
  theMap.zoom = 3;
  theMap.view = [12.46, 41.89, 12.49, 41.905];
  theMap.easeTo.mockReset();
  mockAncestors.mockReset();
  vi.mocked(frameGeoJson).mockReset();
  vi.mocked(smartFitBounds).mockReset();
});

afterEach(cleanup);

describe('the review queue’s map', () => {
  it('reads the points under the address’s chips, and draws a marker per place with the open one selected', async () => {
    renderMap({ kinds: ['conflict', 'arrival'], row: 'waiting:4120' });

    await screen.findByTestId('source-review-questions');
    expect(mockFetchMap).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['conflict', 'arrival'] }));
    expect(drawn('review-questions').features.map(f => f.id)).toEqual([4120, 88213]);
    expect(drawn('review-question-selected').features.map(f => f.id)).toEqual([4120]);
    expect(theMap.props.interactiveLayerIds).toContain('review-questions-pin');
  });

  it('draws no place as selected while no question is open', async () => {
    renderMap();

    await screen.findByTestId('source-review-questions');
    expect(screen.queryByTestId('source-review-question-selected')).toBeNull();
  });

  it('opens the card of a place’s one question by its row', async () => {
    const { onOpen } = renderMap();
    await screen.findByTestId('source-review-questions');

    clickPlace(88213);

    expect(onOpen).toHaveBeenCalledWith('waiting:88213');
    expect(screen.queryByRole('presentation')).toBeNull();
  });

  it('lists a place’s several questions in the chip’s words, and opens the one picked', async () => {
    const { onOpen } = renderMap({ row: 'conflicts:4120' });
    await screen.findByTestId('source-review-questions');

    clickPlace(4120);

    expect(onOpen).not.toHaveBeenCalled();
    const list = await screen.findByRole('presentation');
    expect(within(list).getByText('2 questions about Pantheon')).toBeInTheDocument();
    const choices = within(list).getAllByRole('button');
    expect(choices.map(choice => choice.textContent)).toEqual(['disagreements', 'holding a change']);
    // The open question is marked in the list.
    expect(choices[0]).toHaveClass('Mui-selected');

    fireEvent.click(choices[1]);
    expect(onOpen).toHaveBeenCalledWith('waiting:4120');
    await waitFor(() => expect(screen.queryByText('2 questions about Pantheon')).toBeNull());
  });

  it('opens nothing while it still draws the chips before a change', async () => {
    const { onOpen, rerender } = renderChanging();
    await screen.findByTestId('source-review-questions');
    // The read for the new chips never settles: the old markers stay drawn as placeholders.
    mockFetchMap.mockReturnValue(new Promise(() => undefined));
    rerender({ kinds: ['arrival'] });
    await waitFor(() => expect(mockFetchMap).toHaveBeenCalledTimes(2));
    expect(drawn('review-questions').features).toHaveLength(2);
    clickPlace(SANTA_PRASSEDE.placeId);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('comes closer to several places a click lands on, the whole of Rome under one pin, rather than open one', async () => {
    const { onOpen } = renderMap();
    await screen.findByTestId('source-review-questions');
    vi.mocked(frameGeoJson).mockClear();
    clickPlace([SANTA_PRASSEDE.placeId, PANTHEON.placeId]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(frameGeoJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(frameGeoJson).mock.calls[0][1]).toMatchObject({
      geometry: { coordinates: [[SANTA_PRASSEDE.lon, SANTA_PRASSEDE.lat], [PANTHEON.lon, PANTHEON.lat]] },
    });
  });

  it('lists the places under one pin once the map is as close as it frames, a square and its fountain', async () => {
    const { onOpen } = renderMap();
    await screen.findByTestId('source-review-questions');
    vi.mocked(frameGeoJson).mockClear();
    theMap.zoom = 16;
    clickPlace([SANTA_PRASSEDE.placeId, PANTHEON.placeId]);
    expect(await screen.findByText('3 questions about 2 places here')).toBeInTheDocument();
    expect(frameGeoJson).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('says where the walk after an answer went, and pans to a place out of view at the same zoom', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (step: MapStep | null) => (
      <QueryClientProvider client={client}>
        <ReviewQueueMap
          address={{ ...EMPTY_REVIEW, view: 'map', row: step?.row ?? 'conflicts:4120' }}
          placeName={() => undefined}
          onOpen={vi.fn()}
          onShowList={vi.fn()}
          step={step}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(view(null));
    await screen.findByTestId('source-review-questions');
    expect(screen.queryByText(/^Next:/)).toBeNull();

    // The Pantheon's other question, on the point the camera already shows: no move.
    rerender(view({
      row: 'waiting:4120', placeId: 4120, lon: PANTHEON.lon, lat: PANTHEON.lat, samePlace: true, meters: 0,
    }));
    expect(await screen.findByText('Next: another question about this place.')).toBeInTheDocument();
    expect(theMap.easeTo).not.toHaveBeenCalled();

    // Santa Prassede, east of the view: the map pans to it and keeps its zoom.
    vi.mocked(frameGeoJson).mockClear();
    rerender(view({
      row: 'waiting:88213', placeId: 88213, lon: SANTA_PRASSEDE.lon, lat: SANTA_PRASSEDE.lat, samePlace: false, meters: 1807,
    }));
    expect(await screen.findByText('Next: the nearest open question, 1.8 km away.')).toBeInTheDocument();
    expect(theMap.easeTo).toHaveBeenCalledTimes(1);
    expect(theMap.easeTo).toHaveBeenCalledWith({ center: [SANTA_PRASSEDE.lon, SANTA_PRASSEDE.lat], duration: 400 });
    expect(frameGeoJson).not.toHaveBeenCalled();
    expect(smartFitBounds).not.toHaveBeenCalled();
  });

  it('drops from an open list a question a refresh no longer holds', async () => {
    const { client } = renderMap();
    await screen.findByTestId('source-review-questions');
    clickPlace(PANTHEON.placeId);
    expect(await screen.findByText('2 questions about Pantheon')).toBeInTheDocument();
    mockFetchMap.mockResolvedValue({ places: [{ ...PANTHEON, questions: PANTHEON.questions.slice(1) }, SANTA_PRASSEDE], unplaced: 0 });
    await act(async () => { await client.refetchQueries(); });
    expect(await screen.findByText('1 question about Pantheon')).toBeInTheDocument();
  });

  it('lists the questions of places that stand on one point, by place', async () => {
    const twin: QueueMapPlace = { ...SANTA_PRASSEDE, placeId: 4121, lon: PANTHEON.lon, lat: PANTHEON.lat };
    mockFetchMap.mockResolvedValue({ places: [PANTHEON, twin], unplaced: 0 });
    renderMap();
    await screen.findByTestId('source-review-questions');
    clickPlace([PANTHEON.placeId, twin.placeId]);
    expect(await screen.findByText('3 questions about 2 places here')).toBeInTheDocument();
    expect(screen.getAllByRole('button').filter(b => /Pantheon/.test(b.textContent ?? ''))).toHaveLength(2);
  });

  it('does nothing for a click on no place', async () => {
    const { onOpen } = renderMap();
    await screen.findByTestId('source-review-questions');

    clickPlace(undefined);

    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('presentation')).toBeNull();
  });

  it('says every question is on the map, and names the kinds it draws', async () => {
    renderMap();

    expect(await screen.findByText('3 open questions, all on the map.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See them in the list' })).toBeNull();
    const legend = screen.getByLabelText('What the colours mean');
    expect(legend).toHaveTextContent('disagreements');
    expect(legend).toHaveTextContent('new arrivals');
    expect(legend).toHaveTextContent('holding a change');
  });

  it('says how many have no point, and leads to the list', async () => {
    mockFetchMap.mockResolvedValue({ places: [SANTA_PRASSEDE], unplaced: 2 });
    const { onShowList } = renderMap();

    expect(await screen.findByText(/^3 open questions\. 2 have no point on the map\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See them in the list' }));
    expect(onShowList).toHaveBeenCalled();
  });

  it('says it when only one has no point', async () => {
    mockFetchMap.mockResolvedValue({ places: [], unplaced: 1 });
    renderMap();

    expect(await screen.findByText(/^1 open question\. 1 has no point on the map\./)).toBeInTheDocument();
  });

  it('frames every point without a region chip', async () => {
    renderMap();

    await waitFor(() => expect(frameGeoJson).toHaveBeenCalledTimes(1));
    const [, shape] = vi.mocked(frameGeoJson).mock.calls[0];
    expect((shape as GeoJSON.Feature<GeoJSON.MultiPoint>).geometry.coordinates).toHaveLength(2);
    expect(smartFitBounds).not.toHaveBeenCalled();
  });

  it('frames a region chip by the region’s stored frame and anchor, measuring nothing', async () => {
    // Fiji crosses the antimeridian: its frame runs west past east.
    mockAncestors.mockResolvedValue([
      { id: 1, focusBbox: [-180, -90, 180, 90], anchorPoint: [0, 0] },
      { id: 6737, focusBbox: [176.9, -19.2, -178.2, -12.4], anchorPoint: [179.4, -16.6] },
    ]);
    renderMap({ regionId: 6737 });

    await waitFor(() => expect(smartFitBounds).toHaveBeenCalledTimes(1));
    expect(mockAncestors).toHaveBeenCalledWith(6737);
    const [, bbox, options] = vi.mocked(smartFitBounds).mock.calls[0];
    expect(bbox).toEqual([176.9, -19.2, -178.2, -12.4]);
    expect(options).toEqual(expect.objectContaining({ anchorPoint: [179.4, -16.6] }));
    expect(frameGeoJson).not.toHaveBeenCalled();
  });

  it('keeps the map and its points when a refresh fails, and says so', async () => {
    const { client } = renderMap();
    await screen.findByTestId('source-review-questions');
    mockFetchMap.mockRejectedValue(new Error('down'));
    await act(async () => { await client.refetchQueries(); });

    expect(await screen.findByText(/The map could not refresh/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not read where the questions are/)).toBeNull();
    expect(drawn('review-questions').features).toHaveLength(2);
  });

  it('frames the map again when it comes back after a failed first read', async () => {
    const { rerender } = renderChanging();
    await screen.findByTestId('source-review-questions');
    act(() => (theMap.props.onLoad as () => void)());
    await waitFor(() => expect(frameGeoJson).toHaveBeenCalledTimes(1));

    // A new search whose read fails takes the map away; the search before it brings it back.
    mockFetchMap.mockRejectedValueOnce(new Error('down'));
    rerender({ q: 'Prassede' });
    expect(await screen.findByText(/Could not read where the questions are/)).toBeInTheDocument();
    rerender({});
    await screen.findByTestId('source-review-questions');
    act(() => (theMap.props.onLoad as () => void)());
    await waitFor(() => expect(frameGeoJson).toHaveBeenCalledTimes(2));
  });

  it('says so when the points cannot be read, and leads to the list', async () => {
    mockFetchMap.mockRejectedValue(new Error('down'));
    const { onShowList } = renderMap();

    expect(await screen.findByText(/Could not read where the questions are/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show the list' }));
    expect(onShowList).toHaveBeenCalled();
  });
});

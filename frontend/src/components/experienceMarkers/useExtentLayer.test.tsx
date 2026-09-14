/**
 * The extent follows the reader: what is hovered, else what is selected, else
 * nothing — and a hover that could not have an outline, or that the pointer is
 * only passing over, costs no request at all.
 *
 * The single-experience read is mocked rather than the cache seeded wherever the
 * count of reads is the claim: the hover path's whole job is to not issue one,
 * and a seeded cache cannot tell "asked and answered from memory" from "never
 * asked".
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useExtentLayer } from './useExtentLayer';
import { HoverProvider, useHoverActions } from '../../hooks/useHoverContext';
import type { Experience, ExperienceDetail } from '../../api/experiences';

const { fetchExperience, fetchExperienceTreasures } = vi.hoisted(() => ({
  fetchExperience: vi.fn(),
  fetchExperienceTreasures: vi.fn(),
}));
vi.mock('../../api/experiences', () => ({ fetchExperience, fetchExperienceTreasures }));

const ARCHAEOLOGY = 5;
const ART_MUSEUMS = 2;

const POLYGON: GeoJSON.Geometry = {
  type: 'Polygon',
  coordinates: [[[26.23, 39.95], [26.24, 39.95], [26.24, 39.96], [26.23, 39.95]]],
};

const detail = (id: number, boundary: GeoJSON.Geometry | null) =>
  ({
    id,
    kind_id: ARCHAEOLOGY,
    type: 'site',
    boundary_geojson: boundary,
    area_km2: boundary ? 0.94 : null,
  } as unknown as ExperienceDetail);

/** Troy and Pompeii are sites; the Egyptian Museum is a museum of the same kind. */
const ROWS: Record<number, Pick<Experience, 'kind_id' | 'type'>> = {
  7: { kind_id: ARCHAEOLOGY, type: 'site' },
  8: { kind_id: ARCHAEOLOGY, type: 'site' },
  9: { kind_id: ARCHAEOLOGY, type: 'site' },
  20: { kind_id: ARCHAEOLOGY, type: 'museum' },
  21: { kind_id: ART_MUSEUMS, type: null },
};

function harness(
  seed: (client: QueryClient) => void,
  options: { sourceReady?: () => boolean } = {},
) {
  const setData = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  // The map as the hook uses it: the source, and the events it listens to for
  // the moment one appears. `sourceReady` stands in for a style that has not
  // finished loading, which is what a deep link races.
  const listeners: Record<string, (() => void)[]> = {};
  const ready = options.sourceReady ?? (() => true);
  const map = {
    getSource: () => (ready() ? { setData } : undefined),
    on: (event: string, handler: () => void) => {
      listeners[event] = [...(listeners[event] ?? []), handler];
    },
    off: (event: string, handler: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    },
  };
  const fire = (event: string) => { for (const handler of listeners[event] ?? []) handler(); };
  const mapRef = { getMap: () => map } as never;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <HoverProvider>{children}</HoverProvider>
    </QueryClientProvider>
  );
  return { setData, mapRef, wrapper, fire };
}

const placeOf = (id: number) => ROWS[id];

const lastWrite = (setData: ReturnType<typeof vi.fn>) =>
  setData.mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection;

describe('useExtentLayer', () => {
  it('draws the selected place\'s extent, in the colour of its pin', async () => {
    const { setData, mapRef, wrapper } = harness((client) => {
      client.setQueryData(['experience', 7], detail(7, POLYGON));
    });

    renderHook(
      () => useExtentLayer({
        mapRef, hoverStore: useHoverActions().store,
        selectedExperienceId: 7, placeOf,
      }),
      { wrapper },
    );

    await waitFor(() => {
      const last = lastWrite(setData);
      expect(last.features).toHaveLength(1);
      // Archaeology's amber-brown, off the answer's own kind and type.
      expect(last.features[0].properties).toEqual({ color: '#B45309' });
    });
  });

  it('drops a read that lands after the hook has unmounted', async () => {
    // A region change remounts the markers: the map that replaces this one
    // must not be handed Troy's outline by a promise that outlived its owner.
    let answer: (detail: ExperienceDetail) => void = () => {};
    fetchExperience.mockClear();
    fetchExperience.mockReturnValue(new Promise<ExperienceDetail>((resolve) => { answer = resolve; }));
    const { setData, mapRef, wrapper } = harness(() => {});
    const { unmount } = renderHook(
      () => useExtentLayer({
        mapRef, hoverStore: useHoverActions().store,
        selectedExperienceId: 7, placeOf,
      }),
      { wrapper },
    );
    await waitFor(() => expect(fetchExperience).toHaveBeenCalledWith(7));
    setData.mockClear();

    unmount();
    answer(detail(7, POLYGON));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(setData).not.toHaveBeenCalled();
  });

  it('clears the source when the selection goes', async () => {
    const { setData, mapRef, wrapper } = harness((client) => {
      client.setQueryData(['experience', 7], detail(7, POLYGON));
    });

    const { rerender } = renderHook(
      ({ selected }: { selected: number | null }) => useExtentLayer({
        mapRef, hoverStore: useHoverActions().store,
        selectedExperienceId: selected, placeOf,
      }),
      { wrapper, initialProps: { selected: 7 as number | null } },
    );
    await waitFor(() => expect(setData).toHaveBeenCalled());

    setData.mockClear();
    rerender({ selected: null });
    await waitFor(() => expect(lastWrite(setData).features).toEqual([]));
  });

  it('draws the outline that arrived before the style did, once the source exists', async () => {
    // A deep link: the address already names the selected place, the read
    // answers in a few hundred milliseconds, and the map's style may still be
    // loading. Nothing here re-renders on purpose, so the source is created
    // from the parent's last render — the empty collection — and without this
    // the outline waited for the next thing that moved.
    let styleLoaded = false;
    const { setData, mapRef, wrapper, fire } = harness((client) => {
      client.setQueryData(['experience', 7], detail(7, POLYGON));
    }, { sourceReady: () => styleLoaded });

    const { result } = renderHook(
      () => useExtentLayer({
        mapRef, hoverStore: useHoverActions().store,
        selectedExperienceId: 7, placeOf,
      }),
      { wrapper },
    );

    // The answer is in hand — the ref holds the outline — and there was nowhere
    // to put it.
    await waitFor(() => expect(result.current.extentDataRef.current.features).toHaveLength(1));
    expect(setData).not.toHaveBeenCalled();

    styleLoaded = true;
    act(() => fire('styledata'));

    expect(lastWrite(setData).features).toHaveLength(1);
    expect(lastWrite(setData).features[0].properties).toEqual({ color: '#B45309' });

    // And a second event does not re-write what is already drawn.
    setData.mockClear();
    act(() => fire('styledata'));
    expect(setData).not.toHaveBeenCalled();
  });

  it('draws nothing for a place with no extent', async () => {
    const { setData, mapRef, wrapper } = harness((client) => {
      client.setQueryData(['experience', 9], detail(9, null));
    });

    renderHook(
      () => useExtentLayer({
        mapRef, hoverStore: useHoverActions().store,
        selectedExperienceId: 9, placeOf,
      }),
      { wrapper },
    );

    await waitFor(() => expect(lastWrite(setData).features).toEqual([]));
  });
});

describe('what a hover costs', () => {
  /** Renders the hook and hands back the setters, so a test can hover a row. */
  function hovering(selected: number | null) {
    const { setData, mapRef, wrapper } = harness(() => {});
    const { result } = renderHook(
      () => {
        const actions = useHoverActions();
        useExtentLayer({
          mapRef, hoverStore: actions.store, selectedExperienceId: selected, placeOf,
        });
        return actions;
      },
      { wrapper },
    );
    return { setData, actions: result };
  }

  it('reads nothing for a museum, a monument or anything else without an outline', async () => {
    fetchExperience.mockClear();
    fetchExperience.mockResolvedValue(detail(20, null));
    const { actions } = hovering(null);

    // The Egyptian Museum, then an art museum: both are places at an address,
    // and asking the server what shape they are is the request that must not
    // exist (`publicReadLimiter`, the note in `experienceCardQueries.ts`).
    act(() => actions.current.setHoveredFromList(20));
    act(() => actions.current.setHoveredFromMarker(21));

    await new Promise(resolve => setTimeout(resolve, 250));
    expect(fetchExperience).not.toHaveBeenCalled();
  });

  it('follows a new selection while a museum is under the pointer', async () => {
    // The Egyptian Museum under the pointer answers for nothing, so Troy's
    // outline is drawn under it; then the reader selects Pompeii without moving
    // the pointer. The hover store says nothing about a selection, so the
    // selection effect has to see through the museum to the new place.
    fetchExperience.mockClear();
    fetchExperience.mockImplementation((id: number) => Promise.resolve(detail(id, POLYGON)));
    const { setData, mapRef, wrapper } = harness(() => {});
    const { result, rerender } = renderHook(
      ({ selected }: { selected: number | null }) => {
        const actions = useHoverActions();
        useExtentLayer({
          mapRef, hoverStore: actions.store, selectedExperienceId: selected, placeOf,
        });
        return actions;
      },
      { wrapper, initialProps: { selected: 7 } },
    );
    await waitFor(() => expect(fetchExperience).toHaveBeenCalledWith(7));
    act(() => result.current.setHoveredFromList(20));

    rerender({ selected: 8 });

    await waitFor(() => expect(fetchExperience).toHaveBeenCalledWith(8));
    await waitFor(() => expect(lastWrite(setData).features).toHaveLength(1));
    expect(fetchExperience).not.toHaveBeenCalledWith(20);
  });

  it('reads once for a list of sites swept by the cursor, and only the row rested on', async () => {
    fetchExperience.mockClear();
    fetchExperience.mockResolvedValue(detail(9, POLYGON));
    const { actions } = hovering(null);

    act(() => actions.current.setHoveredFromList(7));
    act(() => actions.current.setHoveredFromList(8));
    act(() => actions.current.setHoveredFromList(9));

    // Nothing has been asked while the pointer was still moving.
    expect(fetchExperience).not.toHaveBeenCalled();

    await waitFor(() => expect(fetchExperience).toHaveBeenCalledTimes(1));
    expect(fetchExperience).toHaveBeenCalledWith(9);
  });
});

/**
 * Which place's extent the map is drawing, and the writing of it.
 *
 * **Written straight to the source, never held as state**, for the reason the
 * hover ring is (`ExperienceMarkers`): this component owns the map's sources and
 * layers, so a re-render reconciles every one of them, and a hover that
 * re-rendered it would rebuild the whole map on every mouse move across the
 * list.
 *
 * **Hovered first, then selected.** A reader moving down the list is asking
 * "how big is this one?" of each row in turn; when they stop, the selected
 * place's outline is what stays. That is the same priority the paint rules use
 * in reverse (`docs/tech/maplibre-patterns.md` § Paint expression priority)
 * and for the same reason — one thing is drawn, so the order has to be stated.
 *
 * **A hover costs a request, so a hover is asked twice before it makes one.**
 * The extent lives on the single-experience read, which sits under
 * `publicReadLimiter` beside the reads that draw the list itself — warming that
 * route on hover was tried once and removed, because two requests per row a
 * reader pauses over is how a list refuses to load itself (the note at the foot
 * of `api/experienceCardQueries.ts`). This feature would have brought it
 * straight back. So the hover path asks two questions of the row it already
 * has, before any request exists:
 *
 *   1. *Can this place have an outline at all?* Only an archaeology site can
 *      (`hasExtent`), which is a fact of the loaded row — a museum, a monument
 *      and a church are read for nothing and are never read.
 *   2. *Has the pointer stopped?* A list swept by the cursor schedules and
 *      cancels, and only the row the reader rests on is ever fetched.
 *
 * A selection is one read and is neither gated nor delayed: selecting a row
 * opens its card, and the card issues this very query under this very key.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapRef } from 'react-map-gl/maplibre';
import type * as maplibregl from 'maplibre-gl';
import { buildExtentData, EMPTY_FC, SOURCE_EXTENT } from './layers';
import { experienceDetailsQuery } from '../../api/experienceCardQueries';
import { subscribeToHoverTarget, type HoverStore } from '../../hooks/useHoverContext';
import type { Experience } from '../../api/experiences';
import { experienceColor } from '../../utils/kindColors';
import { hasExtent } from '../../utils/experienceTypes';

/**
 * How long the pointer rests on a row before the map asks what shape it is.
 *
 * 150 ms is below the ~200 ms a deliberate pause takes and well above the few
 * milliseconds a row spends under a cursor crossing the list, so resting on a
 * site costs one request and sweeping past forty costs none.
 */
const HOVER_SETTLE_MS = 150;

/** Only what the extent rule reads, so a caller may hand over its list row. */
type PlaceForExtent = Pick<Experience, 'kind_id' | 'type'>;

export function useExtentLayer({
  mapRef,
  hoverStore,
  selectedExperienceId,
  placeOf,
}: {
  mapRef: MapRef | undefined;
  hoverStore: HoverStore;
  selectedExperienceId: number | null;
  /**
   * The row the list already holds, for the one question that has to be
   * answered before a request exists: is this a place that can have an outline?
   * A row this does not know is read as one that cannot, which costs a reader
   * nothing — selecting it still draws it.
   */
  placeOf: (experienceId: number) => PlaceForExtent | undefined;
}): { extentDataRef: React.MutableRefObject<GeoJSON.FeatureCollection> } {
  const queryClient = useQueryClient();
  const extentDataRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);
  const mapRefLatest = useRef(mapRef);
  mapRefLatest.current = mapRef;

  /**
   * The place currently being drawn, so an answer that arrives after the reader
   * has moved on is dropped rather than painted. A ref rather than state: the
   * whole point is that none of this re-renders.
   */
  const showing = useRef<number | null>(null);

  // A read still in flight when this hook unmounts is about nobody: the map
  // that replaces this one (a region change remounts the markers) must not be
  // handed the previous place's outline by a promise that outlived its owner.
  // Clearing the ref is what makes the "reader has moved on" check below hold.
  useEffect(() => () => { showing.current = null; }, []);

  /**
   * Whether the last write found no source to write to, so the outline is in
   * the ref and on nothing else.
   *
   * A deep link is the case: the URL already names the selected place, the read
   * resolves in a few hundred milliseconds, and the map's style may not have
   * loaded yet — nothing here re-renders on purpose, so the `<Source>` is later
   * created from whatever the *parent's* last render passed, which was the
   * empty collection. The extent then drew nothing until something else moved.
   */
  const unwritten = useRef(false);

  const write = useCallback((data: GeoJSON.FeatureCollection) => {
    extentDataRef.current = data;
    const source = mapRefLatest.current?.getMap().getSource(SOURCE_EXTENT) as
      maplibregl.GeoJSONSource | undefined;
    // Absent while the map is still loading, or between regions: this
    // component unmounts its sources while a region loads. The ref keeps the
    // value and the effect below puts it on the source the moment one exists.
    unwritten.current = !source;
    source?.setData(data);
  }, []);

  // And the moment the style has one: `styledata` is what MapLibre fires when a
  // source is added, which is the event react-map-gl itself waits for to create
  // this one. Only a write that missed is re-applied, so a map firing the event
  // for its own reasons costs nothing.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return undefined;
    const reapply = () => {
      if (!unwritten.current) return;
      const source = map.getSource(SOURCE_EXTENT) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      unwritten.current = false;
      source.setData(extentDataRef.current);
    };
    reapply();
    map.on('styledata', reapply);
    return () => { map.off('styledata', reapply); };
  }, [mapRef]);

  const show = useCallback(async (experienceId: number | null) => {
    showing.current = experienceId;
    if (experienceId == null) {
      write(EMPTY_FC);
      return;
    }
    try {
      const detail = await queryClient.fetchQuery(experienceDetailsQuery(experienceId));
      // The reader has moved on; this answer is about the previous place.
      if (showing.current !== experienceId) return;
      write(buildExtentData(
        detail.boundary_geojson,
        experienceColor(detail.kind_id, detail.type),
      ));
    } catch {
      // A read that failed is no outline, and nothing to say about it: the
      // card issues the same query and is where an error belongs on screen.
      if (showing.current === experienceId) write(EMPTY_FC);
    }
  }, [queryClient, write]);

  // One rule for what the map draws, read by both effects below: the place
  // under the pointer if it can have an outline, else the selected one. A
  // hovered place that can have no outline — a museum, a monument — answers
  // for nothing, so the selection is drawn under it; and a selection that
  // changes while such a row is under the pointer is drawn too, rather than
  // the previous place's outline staying up until the pointer moves.
  const selectedRef = useRef(selectedExperienceId);
  selectedRef.current = selectedExperienceId;
  const placeOfRef = useRef(placeOf);
  placeOfRef.current = placeOf;
  const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const targetOf = useCallback((hoveredExperienceId: number | null): number | null => {
    const hovered = hoveredExperienceId != null
      ? placeOfRef.current(hoveredExperienceId)
      : undefined;
    return hasExtent(hovered?.kind_id, hovered?.type) ? hoveredExperienceId : selectedRef.current;
  }, []);

  // The selected place, whenever the hover is not answering for one.
  useEffect(() => {
    if (targetOf(hoverStore.getState().hoveredExperienceId) !== selectedExperienceId) return;
    // A fallback still settling was aimed at the previous selection.
    clearTimeout(settling.current);
    void show(selectedExperienceId);
  }, [selectedExperienceId, hoverStore, show, targetOf]);

  // And the hovered one, straight from the store. Subscribed rather than
  // depended on, for the reason the hover ring is: these values change on every
  // mouse move across the list.
  useEffect(() => {
    const unsubscribe = subscribeToHoverTarget(hoverStore, ({ hoveredExperienceId }) => {
      const target = targetOf(hoveredExperienceId);
      clearTimeout(settling.current);
      if (target === showing.current) return;
      settling.current = setTimeout(() => void show(target), HOVER_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(settling.current);
    };
  }, [hoverStore, show, targetOf]);

  return { extentDataRef };
}

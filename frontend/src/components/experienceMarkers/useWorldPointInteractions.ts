/**
 * What a pointer on the world layer does: the popup, the hover ring and the
 * preview card, and the click that takes the reader to the place (#910).
 *
 * The imperative half of `WorldExperiencePoints`, split out for the reason
 * `useMarkerInteractions` was split out of `ExperienceMarkers`: these are
 * MapLibre listeners registered on the map object rather than rendered, and
 * they read what they need through refs, because they outlive many renders and
 * a listener re-registered per render is one the map spends its frame budget
 * swapping.
 *
 * Two things differ from a region's markers, and both follow from there being
 * no region.
 *
 * **The picture is asked for when the pointer rests** (#927). A region's
 * marker is built from a row the list already fetched, picture and credit
 * included; a world pin comes from `GET /api/experiences/points`, whose marker
 * tier selects what a pin needs and no more — the identity, the name, the kind
 * and the type. A URL and a credit per point across the viewport would be most
 * of that read (`experiencePictureController` has the measurement), so the card
 * opens with the object, the place and the kind, and once the pointer has
 * stayed on the pin for `PICTURE_REST_MS` it asks
 * `GET /api/experiences/:id/picture` for that one place. A sweep across a
 * city asks nothing; a place already asked is answered from the cache at once.
 * The read names the point, because a serial site's part has a photograph of
 * its own — the Church of the Intercession on the Nerl, not its site's montage —
 * and `pointPicture` picks between the two as a region's card does, saying so
 * when the picture is the whole site's. The picture and its credit arrive
 * together and the card draws them together (`CLAUDE.md` § Experience Images),
 * and only while the pointer is still on the place it was asked for: an answer
 * that lands after the pointer moved on is cached and not drawn.
 *
 * **A click is a way in, not a selection.** There is no list to select into.
 * The click asks the object where it can be opened — the same read the search
 * and every card-to-card link ask (`readerRegionsJsonSql`, ADR-0042) — and
 * writes the whole address: this world view, the smallest region that holds the
 * object, the card. Where this world view holds it nowhere, which is the state
 * of the places that sit in no region at all, the click flies to the point
 * instead, so no pin on this map is a dead click.
 */

import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { MapRef } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import { buildPointHoverData, EMPTY_FC } from './layers';
import { WORLD_MARKER_LAYERS } from './worldPointLayers';
import { isAnswerablePin } from '../../api/worldPoints';
import { fetchExperiencePicture, type ExperiencePicture } from '../../api/experiences';
import { queryKeys } from '../../api/queryKeys';
import { pointPicture } from '../../utils/pointPicture';
import type { HoverPreview } from '../../hooks/useHoverContext';

/**
 * How long the pointer stays on a pin before its picture is asked for: the
 * list's hover intent (`ExperienceListItem`), so a pointer crossing pins on its
 * way elsewhere asks for none of them.
 */
export const PICTURE_REST_MS = 140;

/**
 * A picture changes only when a curator edits it, and an edit invalidates the
 * object (`queryKeys.experience.picture` sits under `one`), which `askPicture`
 * honours. Kept as long as it is fresh: a read with no observer would
 * otherwise be dropped at the default five minutes.
 */
const PICTURE_STALE_TIME_MS = 10 * 60 * 1000;

/** The one read of a place's picture, so the cache check and the request name the same answer. */
export const experiencePictureQuery = (id: number, locationId: number | null) => ({
  queryKey: queryKeys.experience.picture(id, locationId),
  queryFn: () => fetchExperiencePicture(id, locationId),
  staleTime: PICTURE_STALE_TIME_MS,
  gcTime: PICTURE_STALE_TIME_MS,
});

/** What a feature of that read says about the place under the pointer. */
export interface WorldPoint {
  experienceId: number;
  /** The place itself, which only the marker tier carries. */
  locationId: number | null;
  experienceName: string;
  locationName: string | null;
  kindId: number | null;
  /** Every kind of a place in more than one; the pin's own kind alone otherwise. */
  kindIds: number[];
  coordinates: [number, number];
}

/**
 * What the hover is deduped by: the place, never the object.
 *
 * An object is many pins here as it is on a region's map, and keyed by the
 * object the ring and the popup stay on the first part the pointer touched
 * while it crosses the other thirty-nine — the failure `useMarkerInteractions`
 * records. A string of both, so the two id spaces cannot collide.
 */
function hoverKey(point: WorldPoint): string {
  return `${point.experienceId}:${point.locationId ?? ''}`;
}

export interface WorldPointInteractionsParams {
  mapRef: MapRef | undefined;
  /** Where the hover card's picture is asked for and kept. */
  queryClient: QueryClient;
  /** A kind's own name, for the card's second line; a feature carries only ids. */
  kindNameOf: (kindId: number | null) => string | null;
  setHoverPreview: (preview: HoverPreview | null) => void;
  /** Writes the ring straight to the map's source, without a re-render. */
  setHoverData: (data: GeoJSON.FeatureCollection) => void;
  /** Take the reader to this place. */
  openPoint: (point: WorldPoint) => void;
}

/** The popup body as text, never as markup — see `useMarkerInteractions`. */
function popupContent(name: string): HTMLElement {
  const strong = document.createElement('strong');
  strong.textContent = name;
  return strong;
}

/** A point's kinds, off the text its feature carries them as (`WorldPointProperties.kindIds`). */
function kindIdsOf(properties: maplibregl.MapGeoJSONFeature['properties']): number[] {
  const listed = typeof properties?.kindIds === 'string' ? properties.kindIds.split(',').map(Number) : [];
  if (listed.length > 0) return listed;
  return typeof properties?.kindId === 'number' ? [properties.kindId] : [];
}

function pointOf(feature: maplibregl.MapGeoJSONFeature): WorldPoint | null {
  // The same predicate `useMapInteractions` asks before it claims the gesture
  // for this layer at all. One rule, one home: two spellings of it drifted, and
  // the truncated overview became a dead click that also blocked the region.
  if (!isAnswerablePin(feature.properties)) return null;
  const experienceId = feature.properties.experienceId as number;
  return {
    experienceId,
    // The property. `worldPointsCollection` also sets `feature.id` to the same
    // value, but nothing here reads it: this hook builds its ring into a source
    // of its own from the point's coordinates rather than through feature
    // state, and everything a card is built from is read out of the properties.
    // That builder says why the id is set anyway.
    locationId: (feature.properties?.locationId as number | undefined) ?? null,
    experienceName: String(feature.properties?.experienceName ?? ''),
    locationName: (feature.properties?.name as string | undefined) ?? null,
    kindId: (feature.properties?.kindId as number | undefined) ?? null,
    kindIds: kindIdsOf(feature.properties),
    coordinates: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
  };
}

export function useWorldPointInteractions({
  mapRef, queryClient, kindNameOf, setHoverPreview, setHoverData, openPoint,
}: WorldPointInteractionsParams) {
  const kindNameOfRef = useRef(kindNameOf);
  kindNameOfRef.current = kindNameOf;
  const openPointRef = useRef(openPoint);
  openPointRef.current = openPoint;

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return undefined;

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'exp-marker-popup',
    });

    /** The place the popup and the ring are currently on; see `hoverKey`. */
    let hovered: string | null = null;
    /** The picture read waiting for the pointer to rest; cancelled when it moves on. */
    let resting: ReturnType<typeof setTimeout> | undefined;

    /** The card with the object's picture, drawn only while the pointer is still on the place it was asked for. */
    const withPicture = (key: string, preview: HoverPreview, answer: ExperiencePicture) => {
      const picture = pointPicture(answer, answer.point);
      if (hovered !== key || !picture.imageUrl) return;
      setHoverPreview({ ...preview, ...picture });
    };

    const fetchPicture = async (key: string, preview: HoverPreview) => {
      try {
        withPicture(key, preview, await queryClient.fetchQuery(experiencePictureQuery(preview.experienceId, preview.locationId)));
      } catch {
        // A refused or failed read leaves the card as it is: named, with no picture.
      }
    };

    /**
     * The place's picture: from the cache at once while that answer is fresh and
     * no edit has invalidated it, or asked for once the pointer has rested.
     */
    const askPicture = (key: string, preview: HoverPreview) => {
      const query = experiencePictureQuery(preview.experienceId, preview.locationId);
      const state = queryClient.getQueryState<ExperiencePicture>(query.queryKey);
      const fresh = state?.data !== undefined && !state.isInvalidated
        && Date.now() - state.dataUpdatedAt < PICTURE_STALE_TIME_MS;
      if (fresh) {
        withPicture(key, preview, state.data!);
        return;
      }
      resting = setTimeout(() => { void fetchPicture(key, preview); }, PICTURE_REST_MS);
    };

    // Registered on the map rather than per layer, which is what the region
    // markers do — and here it is not a preference. The pin layers exist only
    // at the tiers that draw pins (`worldLayersFor`), so a registration that
    // waited for all of them waited for ever, and naming a layer the style does
    // not hold makes `queryRenderedFeatures` fire an error.
    // Asking the map which of them are drawn, per event, is what survives a
    // layer arriving and leaving under it.
    const drawnLayers = () => WORLD_MARKER_LAYERS.filter(id => map.getLayer(id));

    /** The place under a point, and the key the hover is deduped by. */
    const pointAt = (at: maplibregl.Point): { point: WorldPoint; key: string } | null => {
      const layers = drawnLayers();
      if (layers.length === 0) return null;
      const features = map.queryRenderedFeatures(at, { layers });
      if (features.length === 0) return null;
      const point = pointOf(features[0]);
      return point ? { point, key: hoverKey(point) } : null;
    };

    /**
     * Takes the popup, the ring and the card down — and deliberately leaves the
     * cursor alone.
     *
     * The map's own move handler runs on the same event and sets the cursor for
     * whatever is under the pointer now (`useMapInteractions`); writing '' here
     * afterwards would take the pointer off a region the reader has just moved
     * on to. Setting it is this hook's business only while a pin is under the
     * pointer, which is the one case that handler stands aside for.
     */
    const clear = () => {
      clearTimeout(resting);
      if (hovered === null) return;
      popup.remove();
      hovered = null;
      setHoverData(EMPTY_FC);
      setHoverPreview(null);
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const under = pointAt(e.point);
      if (!under) {
        clear();
        return;
      }
      map.getCanvas().style.cursor = 'pointer';
      if (under.key === hovered) return;
      clearTimeout(resting);
      hovered = under.key;

      const { point } = under;
      setHoverData(buildPointHoverData(point.coordinates));
      popup.setLngLat(point.coordinates).setDOMContent(popupContent(point.experienceName)).addTo(map);
      const preview: HoverPreview = {
        experienceId: point.experienceId,
        experienceName: point.experienceName,
        locationId: point.locationId,
        locationName: point.locationName,
        kindName: point.kindIds.map(id => kindNameOfRef.current(id)).filter(Boolean).join(' · ') || null,
        // The card reads this only to decide whether to draw the treasures
        // chip, which is silent without a count — and this read carries none.
        // A row whose membership names another source has no kind at all here,
        // exactly as a region's list row has none (`rowKindJoinSql`).
        kindId: point.kindId ?? 0,
        treasureCount: undefined,
        findsCount: undefined,
        // Asked for below, once the pointer rests; see the note at the top of this file.
        imageUrl: null,
        imageCredit: null,
        longitude: point.coordinates[0],
        latitude: point.coordinates[1],
      };
      setHoverPreview(preview);
      askPicture(under.key, preview);
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const under = pointAt(e.point);
      if (under) openPointRef.current(under.point);
    };

    map.on('mousemove', onMouseMove);
    map.on('mouseout', clear);
    map.on('click', onClick);

    return () => {
      clearTimeout(resting);
      // An answer still in flight finds no place hovered, so it draws nothing on a map that is gone.
      hovered = null;
      popup.remove();
      setHoverPreview(null);
      setHoverData(EMPTY_FC);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', clear);
      map.off('click', onClick);
    };
  }, [mapRef, queryClient, setHoverPreview, setHoverData]);
}

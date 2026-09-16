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
 * **The card has no picture.** A region's marker is built from a row the list
 * already fetched, picture and credit included; a world pin comes from
 * `GET /api/experiences/points`, whose marker tier selects what a pin needs and
 * no more — the identity, the name, the kind and the type. A picture is the one
 * column that would carry a URL per point across the whole viewport, for a
 * thumbnail on a hover card, so the tier does not select it and the card names
 * the object, the place and the kind, showing no picture rather than a broken
 * one. Nothing here renders a credit, which is
 * the rule (`CLAUDE.md` § Experience Images) rather than an omission: a credit
 * beside no picture credits nobody.
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
import type { MapRef } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import { buildPointHoverData, EMPTY_FC } from './layers';
import { WORLD_MARKER_LAYERS } from './worldPointLayers';
import { isAnswerablePin } from '../../api/worldPoints';
import type { HoverPreview } from '../../hooks/useHoverContext';

/** What a feature of that read says about the place under the pointer. */
export interface WorldPoint {
  experienceId: number;
  /** The place itself, which only the marker tier carries. */
  locationId: number | null;
  experienceName: string;
  locationName: string | null;
  kindId: number | null;
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
  /** The kind's own name, for the card's second line; a feature carries only its id. */
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
    coordinates: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
  };
}

export function useWorldPointInteractions({
  mapRef, kindNameOf, setHoverPreview, setHoverData, openPoint,
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

    // Registered on the map rather than per layer, which is what the region
    // markers do — and here it is not a preference. The badge layers exist only
    // while the reader has folded, so a registration that waited for all three
    // waited for ever and the pins answered no hover at all; and naming a layer
    // the style does not hold makes `queryRenderedFeatures` fire an error.
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
      hovered = under.key;

      const { point } = under;
      setHoverData(buildPointHoverData(point.coordinates));
      popup.setLngLat(point.coordinates).setDOMContent(popupContent(point.experienceName)).addTo(map);
      setHoverPreview({
        experienceId: point.experienceId,
        experienceName: point.experienceName,
        locationId: point.locationId,
        locationName: point.locationName,
        kindName: kindNameOfRef.current(point.kindId),
        // The card reads this only to decide whether to draw the treasures
        // chip, which is silent without a count — and this read carries none.
        // A row whose membership names another source has no kind at all here,
        // exactly as a region's list row has none (`rowKindJoinSql`).
        kindId: point.kindId ?? 0,
        treasureCount: undefined,
        // No picture and so no credit; see the note at the top of this file.
        imageUrl: null,
        imageCredit: null,
        longitude: point.coordinates[0],
        latitude: point.coordinates[1],
      });
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const under = pointAt(e.point);
      if (under) openPointRef.current(under.point);
    };

    map.on('mousemove', onMouseMove);
    map.on('mouseout', clear);
    map.on('click', onClick);

    return () => {
      popup.remove();
      setHoverPreview(null);
      setHoverData(EMPTY_FC);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', clear);
      map.off('click', onClick);
    };
  }, [mapRef, setHoverPreview, setHoverData]);
}

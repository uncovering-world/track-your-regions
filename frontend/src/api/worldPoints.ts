/**
 * The catalogue's places across the whole world, as the map's source (#910).
 *
 * Two reads and one build. The reads are the endpoint's two tiers — coordinates
 * for the heat below the marker band, a pin's identity and name above it — and
 * the build is the only place the columnar answer becomes the FeatureCollection
 * MapLibre wants.
 *
 * **Why columnar on the wire and GeoJSON only here.** Measured over the
 * development catalogue on 2026-09-16 with brotli: the same values as GeoJSON are 267 kB and
 * as arrays 125 kB, because a Feature repeats its own keys once per place. The
 * shape MapLibre needs is built once per read, in one pass, and handed to the
 * source by reference — never rebuilt in a render, which would re-parse the
 * whole collection on the GPU thread for nothing.
 */

import { API_URL, fetchJson } from './fetchUtils';

/** How much of each point the answer carries; the endpoint's two tiers. */
export type PointsDetail = 'overview' | 'markers';

/** A box as the endpoint spells it. */
export interface PointsBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WorldPointsQuery {
  kindId: number | null;
  detail: PointsDetail;
  folded: boolean;
  box: PointsBox | null;
}

/** One array per field, all of them the same length. */
export interface WorldPointsResponse {
  detail: PointsDetail;
  folded: boolean;
  count: number;
  /**
   * Present, and true, only when the endpoint hit its row cap.
   *
   * It cannot fire on the catalogue as it stands — the cap is more than twice
   * its size (8 842 places on 2026-09-22) — and it is
   * in the type so that the day it does, the layer is drawing a subset
   * knowingly rather than a wrong density picture silently.
   */
  truncated?: true;
  lng: number[];
  lat: number[];
  locationId?: number[];
  experienceId?: number[];
  name?: (string | null)[];
  experienceName?: string[];
  kindId?: (number | null)[];
  type?: (string | null)[];
  locationCount?: number[];
}

/** What a pin carries into hover, the popup and the address. */
export interface WorldPointProperties {
  locationId: number;
  experienceId: number;
  name: string | null;
  experienceName: string;
  kindId: number | null;
  type: string | null;
  /**
   * How many places this pin stands for; 1 unless the answer is folded.
   *
   * The region layer's own property name, so the badge that draws it
   * (`markerCountBadgeBgLayer`) is reused rather than restated.
   */
  locationCount: number;
}

/**
 * Whether a feature of this source is a pin that can answer a pointer.
 *
 * **One predicate because it is one rule asked in two places**, and they are
 * two places that never import each other: `useMapInteractions` decides whether
 * a gesture belongs to the world layer rather than to the region under it, and
 * `useWorldPointInteractions` decides whether it can build a card from the
 * feature. If those two ever disagree the gesture is claimed by the side that
 * cannot answer it, and the pin becomes a dead click that also blocks the
 * region — which is precisely what happened while the question was spelled
 * twice.
 *
 * What makes a feature answerable is identity, and identity is what the
 * **markers** tier adds: below the marker band a point is a coordinate and
 * nothing else (`worldPointsCollection` gives it no properties at all), which
 * is what makes the first screen 37 kB rather than 267. So the pins a capped
 * read draws below the band are positions without names, and they answer
 * nothing — the same as the heat they stand in for.
 */
export function isAnswerablePin(
  properties: Partial<WorldPointProperties> | null | undefined,
): boolean {
  return properties?.experienceId != null;
}

export function worldPointsUrl(query: WorldPointsQuery): string {
  const params = new URLSearchParams({ detail: query.detail });
  if (query.kindId !== null) params.set('kindId', String(query.kindId));
  if (query.folded) params.set('folded', 'true');
  if (query.box) {
    const { west, south, east, north } = query.box;
    params.set('bbox', [west, south, east, north].join(','));
  }
  return `${API_URL}/api/experiences/points?${params}`;
}

export async function fetchWorldPoints(query: WorldPointsQuery): Promise<WorldPointsResponse> {
  return fetchJson<WorldPointsResponse>(worldPointsUrl(query));
}

/**
 * The answer as a FeatureCollection, built in one pass.
 *
 * `id` is the place's own id, set at the top of the feature as well as in its
 * properties. Nothing in this layer reads it today — the hover ring is drawn
 * into a source of its own from the point's coordinates (`buildPointHoverData`),
 * so no feature state is involved — and it is set anyway because that is the
 * only place MapLibre would look if any ever were: `['feature-state', …]` is
 * keyed on `feature.id` and never on a property. The place's id rather than the
 * object's, for the reason `discover/discoverMapLayers.ts` records about
 * `promoteId`: an object's id repeats across every place of a serial site, and
 * one feature-state write against it would highlight all of them.
 *
 * There is no id at the overview and no hover either — the heat is not a thing
 * a pointer can be over.
 *
 * Overview features each have an empty properties object. Names and identity
 * are populated only for the markers tier.
 */
export function worldPointsCollection(
  answer: WorldPointsResponse,
): GeoJSON.FeatureCollection<GeoJSON.Point, Partial<WorldPointProperties>> {
  const { count, lng, lat } = answer;
  const features = new Array<GeoJSON.Feature<GeoJSON.Point, Partial<WorldPointProperties>>>(count);
  const labelled = answer.detail === 'markers' && answer.locationId !== undefined;
  for (let index = 0; index < count; index += 1) {
    const geometry: GeoJSON.Point = { type: 'Point', coordinates: [lng[index], lat[index]] };
    features[index] = labelled
      ? {
        type: 'Feature',
        id: answer.locationId![index],
        geometry,
        properties: {
          locationId: answer.locationId![index],
          experienceId: answer.experienceId![index],
          name: answer.name![index],
          experienceName: answer.experienceName![index],
          kindId: answer.kindId![index],
          type: answer.type![index],
          locationCount: answer.locationCount?.[index] ?? 1,
        },
      }
      : { type: 'Feature', geometry, properties: {} };
  }
  return { type: 'FeatureCollection', features };
}

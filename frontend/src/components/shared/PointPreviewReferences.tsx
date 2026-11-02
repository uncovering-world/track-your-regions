/**
 * The two references a point dialog draws beside the claims it compares (#2206).
 *
 * Two pins say where two claims put a place, not what stands at either point.
 * The Church of the Acheiropoietos's catalogue point is on Αχιλλέα, a street in
 * Άγιος Παύλος, while its Wikipedia article's coordinate is a building in
 * Kamara, by the church in central Thessaloniki: the labels say which point is
 * on the place, and the article's point is one more pin to compare.
 *
 * - **What stands at each pin**: the object OpenStreetMap holds nearest it,
 *   read by Nominatim's reverse lookup through the backend, which queues it
 *   behind the product's one request a second. Asked once per pin when a
 *   curator opens the dialog, kept for the session by the coordinate to about
 *   a metre, and credited "© OpenStreetMap contributors" under the rows, since
 *   the names are OpenStreetMap's data under the ODbL (ADR-0059 decision 3).
 *   A curator's only: the lookup asks a third party on the product's behalf.
 * - **Where the article says it is**: for each place the dialog is about, the
 *   primary coordinate of the article it links to, drawn as a pin labelled
 *   "Wikipedia", or by the article's title where the dialog is about several
 *   places. An article that states none (the Brâncuși ensemble at Târgu Jiu's)
 *   draws nothing.
 */

import { Box, Link, Typography } from '@mui/material';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchArticlePoint, fetchPlaceAtPoint, type PlaceAtPoint } from '../../api/geocode';
import { queryKeys } from '../../api/queryKeys';
import type { MapPin } from './PointPreviewPins';

/**
 * A colour no claim's pin wears (`PIN_COLOURS`) and none sits near: Wikipedia's
 * own near-black read as the second claim's brown on the sources card, where the
 * article's pin stood 15 m from Places of worship's.
 */
export const ARTICLE_PIN_COLOUR = '#AD1457';
/** Nothing at a point or in an article changes while a dialog is open; a session reads each once. */
const REFERENCE_STALE_MS = 24 * 60 * 60 * 1000;
/** The ways OpenStreetMap files a path rather than a street, which are named as what they are. */
const PATHS = new Set(['footway', 'path', 'pedestrian', 'steps', 'track', 'cycleway', 'bridleway']);

/** What the object is, in a word a curator reads: `street` for a road, `building` for a building of no stated kind. */
export function groundKind(place: Pick<PlaceAtPoint, 'category' | 'type'>): string | null {
  const { category, type } = place;
  if (category === 'highway') return type && PATHS.has(type) ? type : 'street';
  const word = !type || type === 'yes' ? category : type;
  return word ? word.replace(/_/g, ' ') : null;
}

/**
 * What stands at a pin, in one line: the object's name and kind, or the kind
 * and its address for an unnamed one, then the area — `Αχιλλέα (street) ·
 * Άγιος Παύλος`, `building at 6 Π. Παπαγεωργίου · Kamara`. Null where
 * OpenStreetMap holds nothing there.
 */
function objectLabel(place: PlaceAtPoint, kind: string | null): string {
  if (!place.name) return [kind, place.street && `at ${place.street}`].filter(Boolean).join(' ');
  return kind ? `${place.name} (${kind})` : place.name;
}

export function groundLabel(place: PlaceAtPoint): string | null {
  const what = objectLabel(place, groundKind(place));
  const parts = [what, place.area !== place.name ? place.area : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** What stands at each point, in the points' order: a line per point, undefined while it loads or where nothing does. */
export function useGroundLabels(
  points: readonly { latitude: number; longitude: number }[],
  enabled: boolean,
): Array<string | undefined> {
  return useQueries({
    queries: points.map(point => ({
      queryKey: queryKeys.placeAtPoint(point.latitude, point.longitude),
      queryFn: () => fetchPlaceAtPoint(point.latitude, point.longitude),
      staleTime: REFERENCE_STALE_MS,
      retry: false,
      enabled,
    })),
    combine: results => results.map(result => (result.data ? groundLabel(result.data) ?? undefined : undefined)),
  });
}

/** An article's title as its link names it: `Church_of_the_Acheiropoietos` read as *Church of the Acheiropoietos*. */
export function articleTitle(url: string): string {
  const last = url.split('/wiki/')[1] ?? url;
  try {
    return decodeURIComponent(last).replace(/_/g, ' ');
  } catch {
    return last.replace(/_/g, ' ');
  }
}

/**
 * The pins the places' articles add, in the places' order: labelled
 * "Wikipedia" for one place, and by the article's title where the dialog is
 * about several — the near-places pair's two articles say whose each point is
 * without waiting on anything else. Two places whose articles put them on one
 * point are one pin, named for both.
 */
export function useArticlePins(placeIds: readonly number[], enabled: boolean): MapPin[] {
  const articles = useQueries({
    queries: placeIds.map(id => ({
      queryKey: queryKeys.experience.articlePoint(id),
      queryFn: () => fetchArticlePoint(id),
      staleTime: REFERENCE_STALE_MS,
      retry: false,
      enabled,
    })),
    combine: results => results.map(result => result.data),
  });
  return useMemo(() => {
    const byPoint = new Map<string, { latitude: number; longitude: number; titles: string[] }>();
    for (const article of articles) {
      const at = article?.coordinate;
      if (!at || !article.article) continue;
      const key = `${at.latitude.toFixed(5)},${at.longitude.toFixed(5)}`;
      const title = articleTitle(article.article);
      const pin = byPoint.get(key) ?? { latitude: at.latitude, longitude: at.longitude, titles: [] };
      if (!pin.titles.includes(title)) pin.titles.push(title);
      byPoint.set(key, pin);
    }
    return [...byPoint.values()].map(pin => ({
      latitude: pin.latitude,
      longitude: pin.longitude,
      label: placeIds.length > 1 ? `Wikipedia: ${pin.titles.join(' / ')}` : 'Wikipedia',
    }));
  }, [articles, placeIds.length]);
}

/** The credit for the names the rows read off OpenStreetMap: shown with them, or not at all. */
export function GroundCredit({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <Box sx={{ px: 2.5, pb: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        {'What stands at each point: '}
        <Link href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">
          © OpenStreetMap contributors
        </Link>
      </Typography>
    </Box>
  );
}

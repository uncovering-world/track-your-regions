/**
 * The links that hand one point to a maps app (#1194, ADR-0115).
 *
 * Built here and nowhere else. A visitor is offered several, since no one
 * address suits everyone and the choice is theirs (a setting for it is #1604):
 *
 * - **the device's own maps app first**, where there is one: Apple Maps through
 *   `maps.apple.com`, a universal link that opens the app on iOS, iPadOS and
 *   macOS; on Android, RFC 5870's `geo:` URI, which the system hands to the maps
 *   app the visitor chose, or asks which;
 * - **OpenStreetMap**, with a marker on the point: the open map the catalogue's
 *   own basemap and outlines come from;
 * - **Google Maps**, through its Maps URLs (`api=1`), which opens its app on a
 *   phone that has it and the web map elsewhere.
 *
 * Nothing is sent to any of them before the visitor presses one: each is a
 * plain `href`, with no preload and no tile from the provider on our page.
 */

import { safeHref } from './safeHref';

export type MapsPlatform = 'apple' | 'android' | 'other';

/** Which kind of device this is, for the maps target; `other` when it cannot tell. */
export function mapsPlatform(): MapsPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform ?? '';
  const agent = navigator.userAgent ?? '';
  if (/android/i.test(platform) || /android/i.test(agent)) return 'android';
  if (/mac|iphone|ipad|ipod|ios/i.test(platform) || /iphone|ipad|ipod|macintosh/i.test(agent)) return 'apple';
  return 'other';
}

/** A coordinate as a maps app reads it: six decimals, about ten centimetres. */
function degrees(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** One way to open the point: who opens it, and the link. */
export interface MapsTarget {
  id: 'device' | 'osm' | 'google';
  /** What the link says. */
  name: string;
  href: string;
}

/**
 * The ways to open a point, the device's own app first, or none for a coordinate
 * that is no place on Earth. The name labels the pin where a target takes one.
 */
export function mapsTargets(
  point: { latitude: number; longitude: number },
  label: string,
  platform: MapsPlatform = mapsPlatform(),
): MapsTarget[] {
  const { latitude, longitude } = point;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
  const lat = degrees(latitude);
  const lng = degrees(longitude);
  // Parentheses too, which `encodeURIComponent` leaves: Android's `q=lat,lng(label)`
  // has no escape of its own, and a part's name carries its reference in brackets
  // ("See (1363-061)"), which a handler would read as the end of the label.
  const name = encodeURIComponent(label).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const targets: Array<{ id: MapsTarget['id']; name: string; href: string | null }> = [];
  // `geo:` is a scheme `safeHref` refuses, as it refuses every scheme but http(s)
  // for a stored link; this one is spelled here from two checked numbers and an
  // encoded name, so nothing in it can execute.
  if (platform === 'android') targets.push({ id: 'device', name: 'Maps app', href: `geo:${lat},${lng}?q=${lat},${lng}(${name})` });
  if (platform === 'apple') targets.push({ id: 'device', name: 'Apple Maps', href: safeHref(`https://maps.apple.com/?ll=${lat},${lng}&q=${name}`) });
  targets.push({ id: 'osm', name: 'OpenStreetMap', href: safeHref(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`) });
  targets.push({ id: 'google', name: 'Google Maps', href: safeHref(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`) });
  return targets.filter((t): t is MapsTarget => t.href !== null);
}

/**
 * The Wikimedia Commons files geotagged near a point, for a curator to pick a
 * component's picture from (#1341).
 *
 * A component with no Wikidata item has no picture of its own, and Commons
 * often holds photographs taken beside it: the survey of #1306 found files
 * within 300 m for 11 of the 13 Aalto Works and 68 of 111 Pile Dwellings. A
 * geotag says where the camera stood, not what it shows — on a lakeshore the
 * files are of the lake — so what this answers is an offer a curator picks
 * from, never a write (`docs/sources/global/wikimedia-commons-geosearch.md`).
 *
 * One request per ask, asked only when a curator opens the offer: the
 * `geosearch` generator in the File namespace, with each file's credit
 * (`extmetadata`, reduced the way every stored credit is) and its distance
 * from the point in the same answer, under the project's User-Agent.
 */

import { namesAPictureFile } from '@tyr/shared/pictures';
import { abortOn } from './sourceRetry.js';
import { commonsFilePath } from './componentItemQueries.js';
import { authorText, creditText, safeHttpUrl, type ImageCredit } from './imageCredit.js';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_FILE_PAGE = 'https://commons.wikimedia.org/wiki/';

/** How far from the point a file may stand: the radius the #1306 survey measured with. */
export const NEARBY_RADIUS_M = 300;
/** How many files the offer shows, nearest first. */
export const NEARBY_SHOWN = 12;
/** How many it asks for: more than it shows, since a map, a PDF or a sound file is not a picture. */
const NEARBY_ASKED = 30;
/** A curator is waiting on the answer. */
const NEARBY_TIMEOUT_MS = 8000;

export interface NearbyPicture {
  /** The file's name on Commons, without the namespace. */
  file: string;
  /** The address the catalogue stores a picture by. */
  url: string;
  /** Metres from the point to where the file is geotagged. */
  distanceM: number;
  credit: ImageCredit;
}

interface GeoPage {
  title?: string;
  coordinates?: Array<{ dist?: number }>;
  imageinfo?: Array<{ extmetadata?: Record<string, { value?: string } | undefined> }>;
}

/** The answer read into the offer: picture files only, nearest first, at most `NEARBY_SHOWN`. */
export function readNearby(pages: readonly GeoPage[]): NearbyPicture[] {
  const pictures: NearbyPicture[] = [];
  for (const page of pages) {
    const file = page.title?.replace(/^File:/, '');
    const distance = page.coordinates?.[0]?.dist;
    if (!file || distance === undefined || !namesAPictureFile(`/${encodeURIComponent(file)}`)) continue;
    const meta = page.imageinfo?.[0]?.extmetadata ?? {};
    pictures.push({
      file,
      url: commonsFilePath(file),
      distanceM: Math.round(distance),
      credit: {
        author: authorText(meta.Artist?.value),
        license: creditText(meta.LicenseShortName?.value),
        licenseUrl: safeHttpUrl(meta.LicenseUrl?.value),
        detailsUrl: `${COMMONS_FILE_PAGE}File:${encodeURIComponent(file.replace(/ /g, '_'))}`,
      },
    });
  }
  return pictures.sort((a, b) => a.distanceM - b.distanceM || a.file.localeCompare(b.file)).slice(0, NEARBY_SHOWN);
}

/** The picture files geotagged within `NEARBY_RADIUS_M` of a point, nearest first. */
export async function commonsPicturesNear(
  latitude: number,
  longitude: number,
  userAgent: string,
): Promise<NearbyPicture[]> {
  const at = `${latitude}|${longitude}`;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'geosearch',
    ggscoord: at,
    ggsradius: String(NEARBY_RADIUS_M),
    ggsnamespace: '6',
    ggslimit: String(NEARBY_ASKED),
    prop: 'coordinates|imageinfo',
    codistancefrompoint: at,
    colimit: 'max',
    iiprop: 'extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
  });
  const { signal, release } = abortOn(NEARBY_TIMEOUT_MS);
  try {
    const response = await fetch(`${COMMONS_API}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal,
    });
    if (!response.ok) throw new Error(`Commons answered ${response.status}`);
    const data = await response.json() as { query?: { pages?: GeoPage[] }; error?: { code?: string; info?: string } };
    // MediaWiki answers a refused request with 200 and an `error`: that is no answer, not "nothing nearby".
    if (data.error) throw new Error(`Commons refused the request: ${data.error.code ?? 'unknown'}`);
    return readNearby(data.query?.pages ?? []);
  } finally {
    release();
  }
}

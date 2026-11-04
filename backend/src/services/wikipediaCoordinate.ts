/**
 * Where a Wikipedia article says its subject stands: the article's primary
 * coordinate, as the wiki's own API states it (`prop=coordinates`, the
 * GeoData extension behind the `{{coord}}` template), for a curator holding a
 * point dialog open (#2206).
 *
 * A third reference where two claims disagree: the Church of the
 * Acheiropoietos's catalogue point and its article's stand 1.6 km apart, and the
 * article's is the church in central Thessaloniki. An article that states no
 * coordinate — the Brâncuși ensemble at Târgu Jiu's, 1.5 km of sculpture — has
 * none to draw, and that is an answer, not a failure.
 *
 * Only a `<wiki>.wikipedia.org/wiki/<title>` link is read, and only the one a
 * place holds: the caller passes the place, never a URL, so the server asks no
 * host a request named. Asked while a curator waits, so one request with a
 * short deadline and no retry, rather than the runs' client that waits out a
 * `Retry-After`; an answer is kept for a day, by article.
 */

import { actionApiFetch } from './wikimediaApi.js';
import { userAgent } from '../config/userAgent.js';

// No bot marker: a curator opened the dialog and waits on it.
const USER_AGENT = userAgent();
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
/** A wiki's code: letters and hyphens, `zh-min-nan` included; `m.` is the mobile site of the same wiki. */
const ARTICLE_URL = /^https:\/\/([a-z][a-z-]{1,15})\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)$/;

export interface ArticleCoordinate {
  latitude: number;
  longitude: number;
}

const cache = new Map<string, { at: number; answer: ArticleCoordinate | null }>();

/** The wiki and the title a place's article link names, or null for anything that is not one. */
export function articleOf(url: string): { wiki: string; title: string } | null {
  const match = ARTICLE_URL.exec(url.trim());
  if (!match) return null;
  let title: string;
  try {
    title = decodeURIComponent(match[2]).replace(/_/g, ' ');
  } catch {
    return null;
  }
  // A pipe would ask for a second title; a slash-led path is no article.
  if (!title || title.includes('|') || title.startsWith('/')) return null;
  return { wiki: match[1], title };
}

/**
 * The article's primary coordinate on the Earth, or null where the link names
 * no article, the article states none, or the wiki does not answer in time.
 */
export async function articleCoordinate(url: string): Promise<ArticleCoordinate | null> {
  const article = articleOf(url);
  if (!article) return null;
  const key = `${article.wiki}|${article.title}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) return hit.answer;

  const endpoint = new URL(`https://${article.wiki}.wikipedia.org/w/api.php`);
  for (const [name, value] of Object.entries({
    action: 'query', prop: 'coordinates', coprimary: 'primary', redirects: '1',
    format: 'json', formatversion: '2', titles: article.title,
  })) endpoint.searchParams.set(name, value);
  let answer: ArticleCoordinate | null = null;
  try {
    const response = await actionApiFetch(endpoint.toString(), {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    }, { timeoutMs: REQUEST_TIMEOUT_MS });
    // A refusal or an outage is no coordinate this time, and not remembered.
    if (!response.ok) return null;
    const body = await response.json() as {
      query?: { pages?: Array<{ coordinates?: Array<{ lat?: unknown; lon?: unknown; globe?: unknown }> }> };
    };
    const point = body.query?.pages?.[0]?.coordinates?.[0];
    if (point && typeof point.lat === 'number' && typeof point.lon === 'number'
      && (point.globe === undefined || point.globe === 'earth')
      && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180) {
      answer = { latitude: point.lat, longitude: point.lon };
    }
  } catch {
    return null;
  }
  cache.delete(key);
  cache.set(key, { at: Date.now(), answer });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return answer;
}

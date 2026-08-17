/**
 * Fetching a card's picture before the card is asked for.
 *
 * An expanded card reserves 250 px for its picture, which is only honest once the
 * bytes are here: a picture that arrives after the card has opened grows a row
 * whose height is measured, and that moves every row below it. Measured on a
 * live card, the picture landed 1.3 s after the click and shifted the list by
 * 250 px — long after the reader had started reading.
 *
 * Hovering a row is the one thing that reliably happens before opening it, so
 * that is when the fetch starts. By the click the bytes are usually in the
 * browser's cache, which takes the picture out of the wait — the card still waits
 * for its two queries, which are deliberately not warmed (`experienceCardQueries`
 * says why), so this shortens the wait rather than removing it.
 *
 * Two things this deliberately does not do. It does not preload every row in the
 * window: most of these urls do not resolve at all (of 1604 experiences, 1260
 * carry `whc.unesco.org/document/<id>`, which answers 403 at the source and 404
 * through the thumbnail proxy — see #557), and spraying requests while a reader
 * scrolls past 467 rows spends someone else's bandwidth to no purpose. And it
 * does not retry: a url that failed once stays failed for the session, because
 * the only thing a retry buys is a second chance to move the list.
 *
 * `useExperienceContext` used to do the opposite — one `new Image()` per
 * experience the moment a region was explored, ~670 requests for Europe, and of
 * the *original* url rather than the thumbnail any view renders, so none of those
 * bytes were ever displayed. It was removed alongside this file, which is why the
 * position above is now the repository's rather than a claim contradicted a few
 * modules away.
 */

import { extractImageUrl, toThumbnailUrl } from './imageUrl';

/** The width an expanded card asks the thumbnail proxy for. */
const CARD_IMAGE_WIDTH = 330;

/**
 * The url an expanded card renders — and therefore the only one worth fetching
 * early. Defined here so the row that preloads and the card that draws cannot
 * drift onto different widths, which would preload one file and render another.
 */
export function cardImageUrl(rawImageUrl: string | null | undefined): string {
  const url = extractImageUrl(rawImageUrl ?? null);
  return url ? toThumbnailUrl(url, CARD_IMAGE_WIDTH) : '';
}

/** Fire-and-forget preload of a card's picture, straight from the raw field. */
export function preloadCardImage(rawImageUrl: string | null | undefined): void {
  const url = cardImageUrl(rawImageUrl);
  if (url) void preloadImage(url);
}

const loaded = new Set<string>();
const failed = new Set<string>();
const inFlight = new Map<string, Promise<boolean>>();

/** True when this url's bytes are already here, so a card can size its box now. */
export function isImagePreloaded(url: string): boolean {
  return loaded.has(url);
}

/**
 * True when this url's answer is known, refusal included — which is what a card
 * deciding whether it can open needs, as opposed to one deciding whether to draw
 * a picture. Four of these urls in five never resolve (#557), and under windowing
 * a row is mounted afresh every time a reader scrolls back to it; treating a known
 * refusal as pending would close such a card for a commit, let its collapsed height
 * be measured, and move every row below it twice on the way back.
 */
export function isImageSettled(url: string): boolean {
  return loaded.has(url) || failed.has(url);
}

/**
 * Starts fetching, or joins a fetch already running, and resolves with whether
 * the picture can be shown. Safe to call on every hover: the answer for a url is
 * remembered, so the second call costs nothing.
 */
export function preloadImage(url: string): Promise<boolean> {
  if (!url) return Promise.resolve(false);
  if (loaded.has(url)) return Promise.resolve(true);
  if (failed.has(url)) return Promise.resolve(false);

  const existing = inFlight.get(url);
  if (existing) return existing;

  const request = new Promise<boolean>((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      loaded.add(url);
      inFlight.delete(url);
      resolve(true);
    };
    probe.onerror = () => {
      failed.add(url);
      inFlight.delete(url);
      resolve(false);
    };
    probe.src = url;
  });
  inFlight.set(url, request);
  return request;
}

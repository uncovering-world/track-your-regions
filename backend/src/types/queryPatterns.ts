/**
 * What a query parameter the handler parses accepts, as a pattern the OpenAPI
 * document carries (#2515): a client generated from the document sends only
 * what the route reads, and the API contract lane draws only values the route
 * accepts. Each is no wider than the route's own reading. Where that reading
 * takes more spellings than a pattern says well — `parseBbox` reads anything
 * `Number` makes finite, the language list skips an empty entry,
 * `pictureFetchUrl` a raw character — the pattern goes to the document alone
 * (`meta`) and the reading stays the judge; a search's two characters are the
 * pattern itself, which the route also applies.
 */

import { z } from 'zod/v4';
import { MAX_READING_LANGUAGES, READING_LANGUAGE } from '@tyr/shared/preferences';
import { pictureFetchUrl, PICTURE_FETCH_URL_MESSAGE } from './urlSafety.js';

/** A number `parseBbox` reads as finite: a sign, digits with an optional fraction, and an exponent of at most two digits. */
const BBOX_NUMBER = String.raw`-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,2})?`;
export const BBOX_PATTERN = new RegExp(`^${BBOX_NUMBER},${BBOX_NUMBER},${BBOX_NUMBER},${BBOX_NUMBER}$`);
/** One to `MAX_READING_LANGUAGES` language codes, comma-separated, each as `READING_LANGUAGE` reads it. */
const LANGUAGE_CODE = READING_LANGUAGE.source.replace(/^\^|\$$/g, '');
export const LANGUAGES_PATTERN = new RegExp(`^${LANGUAGE_CODE}(?:,${LANGUAGE_CODE}){0,${MAX_READING_LANGUAGES - 1}}$`);
/**
 * An English Wikipedia article in its plainest spelling, at most 120
 * characters with nothing a query string escapes: a hundred of them, the most
 * one editions read takes, then fit in the 16 kB request line Node reads. The
 * route reads any article address and drops the rest, so this is the
 * document's alone.
 */
export const ARTICLE_PATTERN = /^https:\/\/en\.wikipedia\.org\/wiki\/[A-Za-z0-9_.~-]{1,90}$/;
/** Two characters other than whitespace, which a search trimmed to two characters needs. */
export const TWO_SEARCHED = /^\s*\S[\s\S]*\S\s*$/;
/**
 * A percent-escape `decodeURIComponent` reads: an ASCII byte, or a whole UTF-8
 * character of two, three or four bytes, never an overlong form or a
 * surrogate, which it refuses and `pictureFetchUrl` with it.
 */
const HEX = '[0-9A-Fa-f]';
const CONT = `%[89ABab]${HEX}`;
const ESCAPE = [
  `%[0-7]${HEX}`,
  `%(?:[Cc][2-9A-Fa-f]|[Dd]${HEX})${CONT}`,
  `%[Ee]0%[ABab]${HEX}${CONT}`,
  `%[Ee][1-9A-Ca-cEeFf]${CONT}${CONT}`,
  `%[Ee][Dd]%[89]${HEX}${CONT}`,
  `%[Ff]0%[9ABab]${HEX}${CONT}${CONT}`,
  `%[Ff][1-3]${CONT}${CONT}${CONT}`,
  `%[Ff]4%8${HEX}${CONT}${CONT}`,
].join('|');
/** A path character a URL carries as it is: unreserved, a sub-delimiter, `:` or `@` (RFC 3986). */
const PATH_CHAR = `(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|${ESCAPE})`;
/**
 * A Commons file address as the document states it: https, one of the two
 * Commons hosts, a path of encoded segments — `Special:FilePath/…` and a
 * thumbnail's `%C3%B6` among them — and an optional query, `?width=` among
 * them. Narrower than what `pictureFetchUrl` reads, which also takes a raw
 * `ö` and a fragment, so every address the document admits is one it fetches.
 */
const COMMONS_FILE_URL = new RegExp(
  `^https://(?:commons|upload)\\.wikimedia\\.org(?:/${PATH_CHAR}*)*(?:\\?(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|${ESCAPE})*)?$`,
);

/**
 * The image proxy's `url`: a Commons file address. `pictureFetchUrl` alone
 * judges it, since it reads more spellings than a pattern can say, raw
 * characters among them; the document carries the pattern of the encoded
 * spelling (`meta`), which every client that reads it can send.
 */
export const commonsFileUrlSchema = z.string().max(2000)
  .refine((value) => pictureFetchUrl(value) !== null, { message: PICTURE_FETCH_URL_MESSAGE })
  .meta({ pattern: COMMONS_FILE_URL.source });

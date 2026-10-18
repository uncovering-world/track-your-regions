/**
 * One line of a monthly `pageview_complete` user file (ADR-0055), read the way
 * readership needs it: which Wikipedia edition, which article, how it was read
 * and how many times.
 *
 *     en.wikipedia Cologne_Cathedral 6127 mobile-web 41267 A1328B1290C1411…
 *
 * The columns are the wiki code, the title, the page id (`null` where none),
 * the access method (`desktop`, `mobile-web`, `mobile-app`), the month's total
 * and the daily counts, a letter per day from `A` (the 1st) to `_` (the 31st)
 * followed by that day's count. Wikimedia's readme warns that a row with no
 * page id has five columns rather than six, so a line is read from its end.
 *
 * Nothing here touches the database; the build is `readershipBuild.ts`.
 */

/** Where a title's percent-escapes are: `%XX` (a byte of UTF-8) or `%uXXXX` (a UTF-16 code unit). */
const ESCAPE = /%(?:u([0-9A-Fa-f]{4})|([0-9A-Fa-f]{2}))/y;

const utf8 = new TextDecoder('utf-8', { fatal: false });
const REPLACEMENT = '�';
/** C0 and C1 control characters, and DEL: never in an article's title. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/** A title as a sitelink spells it: spaces for underscores, no control character. */
const readable = (title: string) => title.replace(CONTROL, REPLACEMENT).replaceAll('_', ' ');

/** UTF-16 code units as text: a high surrogate followed by a low one is one character, a lone one is unreadable. */
function unitsToText(units: number[]): string {
  let out = '';
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const next = units[i + 1];
    if (unit >= 0xd800 && unit <= 0xdbff && next !== undefined && next >= 0xdc00 && next <= 0xdfff) {
      out += String.fromCharCode(unit, next);
      i++;
    } else if (unit >= 0xd800 && unit <= 0xdfff) {
      out += REPLACEMENT;
    } else {
      out += String.fromCharCode(unit);
    }
  }
  return out;
}

/**
 * A title as its article is named, whichever of the dump's three spellings it
 * came in (ADR-0055): raw UTF-8, `%XX` percent-encoding, or the `%uXXXX` form
 * of old JavaScript `escape()`. Each spelling is its own row with its own
 * count, so they have to read as one title to be summed. The `%uXXXX` form
 * writes UTF-16 code units, so a character beyond the Basic Multilingual Plane
 * arrives as two (`%uD83D%uDE00`) and is one character; a lone surrogate, which
 * September 2026's file carries, is unreadable and becomes U+FFFD rather than
 * failing the line. A control character, which `%00` and its kind decode to
 * and which no article's title can hold, becomes U+FFFD as well: such a title
 * matches no sitelink, and PostgreSQL refuses a NUL in text outright (November
 * 2025's file carries one). Underscores are spaces, as Wikidata's sitelinks
 * write them.
 */
export function decodeTitle(raw: string): string {
  if (!raw.includes('%')) return readable(raw);
  let out = '';
  let bytes: number[] = [];
  let units: number[] = [];
  const flushBytes = () => { if (bytes.length) { out += utf8.decode(Uint8Array.from(bytes)); bytes = []; } };
  const flushUnits = () => { if (units.length) { out += unitsToText(units); units = []; } };
  let i = 0;
  while (i < raw.length) {
    ESCAPE.lastIndex = i;
    const match = ESCAPE.exec(raw);
    if (match) {
      if (match[1] !== undefined) {
        flushBytes();
        units.push(parseInt(match[1], 16));
      } else {
        flushUnits();
        bytes.push(parseInt(match[2], 16));
      }
      i = ESCAPE.lastIndex;
      continue;
    }
    flushBytes();
    flushUnits();
    out += raw[i];
    i++;
  }
  flushBytes();
  flushUnits();
  return readable(out);
}

export type Access = 'desktop' | 'mobile-web' | 'mobile-app';

export interface PageviewRow {
  /** The edition as the dump names it: `en.wikipedia`. */
  wiki: string;
  /** The title as the dump wrote it, before decoding. */
  rawTitle: string;
  access: Access;
  views: number;
  /** The daily counts as the dump encodes them, read only where they are kept (`dailySeries`). */
  daily: string;
}

const ACCESS = new Set<string>(['desktop', 'mobile-web', 'mobile-app']);

/**
 * A line of a Wikipedia edition, or null for anything else: another project
 * (Wiktionary, Commons), or a line too short or malformed to read. Read from
 * the end, since a row with no page id lacks that column.
 */
export function parsePageviewLine(line: string): PageviewRow | null {
  const parts = line.split(' ');
  if (parts.length < 5) return null;
  const wiki = parts[0];
  if (!wiki.endsWith('.wikipedia')) return null;
  const daily = parts[parts.length - 1];
  const views = Number(parts[parts.length - 2]);
  const access = parts[parts.length - 3];
  if (!Number.isInteger(views) || views < 0 || !ACCESS.has(access)) return null;
  return { wiki, rawTitle: parts[1], access: access as Access, views, daily };
}

/**
 * The editions whose site code is not their domain's. Belarusian in the
 * Taraškievica spelling is `be-tarask.wikipedia` and `be_x_oldwiki`, the
 * database it was created under, both in Wikidata's sitelinks and in its
 * dump directory.
 */
const SITE_CODES: Readonly<Record<string, string>> = { 'be-tarask': 'be_x_oldwiki' };

/**
 * The site code Wikidata's sitelinks use for an edition: `en.wikipedia` is
 * `enwiki`, `zh-min-nan.wikipedia` is `zh_min_nanwiki`.
 */
export function siteOf(wiki: string): string {
  const domain = wiki.slice(0, -'.wikipedia'.length);
  return SITE_CODES[domain] ?? `${domain.replaceAll('-', '_')}wiki`;
}

const FIRST_DAY = 'A'.charCodeAt(0);

/**
 * Add a row's encoded daily counts into `days` (index 0 is the 1st). A day
 * letter outside the month is ignored rather than trusted.
 */
export function addDaily(days: number[], encoded: string): void {
  let i = 0;
  while (i < encoded.length) {
    const day = encoded.charCodeAt(i) - FIRST_DAY;
    i++;
    let count = 0;
    while (i < encoded.length) {
      const c = encoded.charCodeAt(i);
      if (c < 48 || c > 57) break;
      count = count * 10 + (c - 48);
      i++;
    }
    if (day >= 0 && day < days.length) days[day] += count;
  }
}

/**
 * How the live query service writes the values the syncs compare, made from
 * the subset's compact entities (#1459, ADR-0105): which statements `wdt:`
 * reads, which of them still stand, and the spellings of a picture, an
 * English article, a coordinate and a year. A value spelled otherwise than
 * WDQS spells it would read as a change on every row of every run, with one
 * exception kept on purpose: a year before the common era (`yearOf`).
 */

import type { CompactStatement, CompactValue } from '../../dumps/wikidata/compactEntity.js';

/**
 * The statements `wdt:` reads: the preferred ones where there are any, the
 * normal ones otherwise, never a deprecated one. An unknown or no value
 * counts in choosing the rank, as it does for WDQS.
 */
export function bestStatements(statements: CompactStatement[] | undefined): CompactStatement[] {
  const all = statements ?? [];
  const preferred = all.filter(statement => statement.rank === 'preferred');
  return preferred.length ? preferred : all.filter(statement => statement.rank === undefined);
}

/** A value Wikidata records as *no value*, which WDQS writes as no triple at all. */
export function isNoValue(value: CompactValue): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.novalue === true;
}

/**
 * Whether a statement carries an end time (`pq:P582`): an end time of no value
 * is none, since WDQS writes it as `wdno:P582` rather than a `pq:` triple, and
 * `FILTER NOT EXISTS { ?st pq:P582 ?ended }` keeps the statement.
 */
export function hasEnded(statement: CompactStatement): boolean {
  return (statement.qualifiers?.P582 ?? []).some(value => !isNoValue(value));
}

/** The best statements that still hold: none carries an end time, as `standing` in the live kit asks. */
export function standingStatements(statements: CompactStatement[] | undefined): CompactStatement[] {
  return bestStatements(statements).filter(statement => !hasEnded(statement));
}

/** The item a value names, or null for a value that is no item id. */
export function itemOf(value: CompactValue): string | null {
  return typeof value === 'string' && /^Q\d+$/.test(value) ? value : null;
}

/** Every item the given statements name, in their order. */
export function itemsOf(statements: CompactStatement[]): string[] {
  return statements.map(statement => itemOf(statement.value)).filter((id): id is string => id !== null);
}

/** A Commons file's `Special:FilePath` URL as WDQS writes it: every character but the unreserved ones escaped. */
export function pictureUrl(file: string): string {
  const escaped = encodeURIComponent(file).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `http://commons.wikimedia.org/wiki/Special:FilePath/${escaped}`;
}

/**
 * Every picture of an item's best-ranked `P18` statements, as `pictureUrl` writes them,
 * deduplicated and in URL order, the order `preferredPicture` keeps the first of (#1778).
 */
export function picturesOf(statements: CompactStatement[] | undefined): string[] {
  const urls = bestStatements(statements).map(s => textOf(s.value)).filter((f): f is string => f !== null).map(pictureUrl);
  // By UTF-16 code unit, the order `preferredPicture`'s `<` compares in.
  return [...new Set(urls)].sort();
}

/**
 * An English Wikipedia article's URL as WDQS writes it (`schema:about`):
 * spaces as underscores, escaped as MediaWiki's `wfUrlencode` escapes a
 * title, which leaves `;:@$!*(),/~` as they are.
 */
export function articleUrl(title: string): string {
  const escaped = encodeURIComponent(title.replace(/ /g, '_'))
    .replace(/'/g, '%27')
    .replace(/%3B|%40|%24|%21|%2A|%28|%29|%2C|%2F|%7E|%3A/gi, code => decodeURIComponent(code));
  return `https://en.wikipedia.org/wiki/${escaped}`;
}

const EARTH = 'http://www.wikidata.org/entity/Q2';

/** A coordinate as WDQS writes it (WKT), its globe in front where it is not the Earth. */
export function wktOf(value: CompactValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { latitude, longitude, globe } = value as { latitude?: number; longitude?: number; globe?: string };
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  const point = `Point(${longitude} ${latitude})`;
  return globe && globe !== EARTH ? `<${globe}> ${point}` : point;
}

/**
 * The item's own year of a time value, before the common era negative: the Lion
 * Capital of Ashoka's `-0250` is -250. WDQS's `YEAR()` adds one to such a year
 * where the date has year precision or finer (-249 there), and leaves a coarser one as
 * it is (Yazılıkaya's century-precision -1300); the item's own is the one a
 * reader is told, and migration 106 brought the stored years to it (#1531).
 * Null for anything else.
 */
export function yearOf(value: CompactValue): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const time = (value as { time?: string }).time;
  const match = typeof time === 'string' ? /^([+-])(\d+)-/.exec(time) : null;
  if (!match) return null;
  const year = Number(match[2]);
  return match[1] === '-' ? -year : year;
}

/** A string value, or null. */
export function textOf(value: CompactValue): string | null {
  return typeof value === 'string' ? value : null;
}

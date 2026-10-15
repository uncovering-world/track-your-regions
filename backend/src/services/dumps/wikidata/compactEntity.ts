/**
 * The form an entity is kept in by the local Wikidata subset (ADR-0101
 * decision 2): every statement at every rank with its qualifiers and its
 * statement id, every sitelink, and labels and descriptions in the configured
 * languages. What no reader asks for is left out: references (about a third
 * of the dump's bytes), aliases, other languages' labels, and what the dump
 * repeats on every snak (its datatype, which the property says once, and the
 * item value's three spellings of one id).
 */


/** A snak's value: an item as its id, `somevalue` and `novalue` as themselves, anything else as the dump gives it. */
export type CompactValue = null | boolean | number | string | CompactValue[] | { [key: string]: CompactValue };

interface DumpSnak {
  snaktype: 'value' | 'somevalue' | 'novalue';
  property: string;
  datavalue?: { value: CompactValue; type: string };
}

interface DumpStatement {
  mainsnak: DumpSnak;
  id: string;
  rank: 'preferred' | 'normal' | 'deprecated';
  qualifiers?: Record<string, DumpSnak[]>;
}

export interface DumpEntity {
  type: 'item' | 'property';
  id: string;
  /** A property's: what its values are (`wikibase-item`, `string`, ...). */
  datatype?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, DumpStatement[]>;
  sitelinks?: Record<string, { title: string }>;
}


export interface CompactStatement {
  id: string;
  /** Absent for `normal`, the rank nearly every statement has. */
  rank?: 'preferred' | 'deprecated';
  value: CompactValue;
  qualifiers?: Record<string, CompactValue[]>;
}

export interface CompactEntity {
  id: string;
  /** A property's datatype, which tells an item value from a string that looks like one. */
  datatype?: string;
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  claims: Record<string, CompactStatement[]>;
  sitelinks: Record<string, string>;
}

// Postgres stores neither a NUL in `text` nor one in `jsonb` (`\u0000 cannot be
// converted to text`), and `jsonb` refuses a surrogate with no partner, and the
// dump holds both: one Arabic label ended in a NUL and stopped the first full
// build of the 2026-10-05 dump after hours of its second pass. Neither is a
// character anyone reads, so a NUL is dropped and a lone surrogate becomes
// U+FFFD, the replacement character, wherever a string is kept.
const NUL = /\0/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// What JSON.stringify writes for either: it escapes both, and only those (a
// pair it writes as the character). A literal backslash before "u0000" in a
// string also matches, which only costs the slow path below.
const ESCAPED_UNSTORABLE = /\\u(?:0000|d[89a-f][0-9a-f]{2})/i;

/** `text` as Postgres can store it: no NUL, no lone surrogate. */
export function storableText(text: string): string {
  return text.replace(NUL, '').replace(LONE_SURROGATE, '\uFFFD');
}

/** A parsed JSON value with every string in it, keys included, storable. */
function storableValue(value: unknown): unknown {
  if (typeof value === 'string') return storableText(value);
  if (Array.isArray(value)) return value.map(storableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [storableText(key), storableValue(inner)]));
  }
  return value;
}

/** JSON as `jsonb` can store it: every string in it, keys included, storable; nearly every entity passes untouched. */
export function storableJson(json: string): string {
  if (!ESCAPED_UNSTORABLE.test(json)) return json;
  return JSON.stringify(storableValue(JSON.parse(json)));
}

/** A string as an element of a Postgres array literal: in double quotes, its backslashes and quotes escaped. */
export function arrayItemOf(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&')}"`;
}

/** The languages the subset keeps labels and descriptions in; widening it needs no other change. */
export const SUBSET_LANGUAGES = ['en', 'mul', 'en-gb', 'de', 'fr', 'es', 'it', 'nl'] as const;

const SOME_VALUE = { somevalue: true };
const NO_VALUE = { novalue: true };

export function snakValue(snak: DumpSnak): CompactValue {
  if (snak.snaktype === 'somevalue') return SOME_VALUE;
  if (snak.snaktype === 'novalue') return NO_VALUE;
  const value = snak.datavalue?.value ?? null;
  if (snak.datavalue?.type === 'wikibase-entityid' && value && typeof value === 'object' && 'id' in value) {
    return (value as { id: CompactValue }).id;
  }
  return value;
}

function inLanguages(terms: Record<string, { value: string }> | undefined, languages: readonly string[]): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const language of languages) {
    const term = terms?.[language];
    if (term) kept[language] = term.value;
  }
  return kept;
}

function compactStatement(statement: DumpStatement): CompactStatement {
  const compact: CompactStatement = { id: statement.id, value: snakValue(statement.mainsnak) };
  if (statement.rank !== 'normal') compact.rank = statement.rank;
  if (statement.qualifiers) {
    compact.qualifiers = Object.fromEntries(
      Object.entries(statement.qualifiers).map(([property, snaks]) => [property, snaks.map(snakValue)]),
    );
  }
  return compact;
}

export function compactEntity(entity: DumpEntity, languages: readonly string[] = SUBSET_LANGUAGES): CompactEntity {
  return {
    id: entity.id,
    ...(entity.datatype ? { datatype: entity.datatype } : {}),
    labels: inLanguages(entity.labels, languages),
    descriptions: inLanguages(entity.descriptions, languages),
    claims: Object.fromEntries(
      Object.entries(entity.claims ?? {}).map(([property, statements]) => [property, statements.map(compactStatement)]),
    ),
    sitelinks: Object.fromEntries(Object.entries(entity.sitelinks ?? {}).map(([site, link]) => [site, link.title])),
  };
}

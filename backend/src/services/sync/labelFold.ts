/**
 * The label rules as SQL, and the set comparison a work's makers are judged by.
 *
 * The fold and the store rule themselves — `foldLabel`, `sameLabel`,
 * `tidyLabel` — are `@tyr/shared/labels` (ADR-0065): a form and an endpoint
 * have to answer "is this the same name" alike, so the one declaration is
 * imported by both sides rather than copied and pinned by a test reading the
 * other copy as text. What stays here is what only the storing side asks:
 * the rule spelled for Postgres, where `\s` stops at ASCII, and the set
 * comparison over a list of names.
 */

import { foldLabel } from '@tyr/shared/labels';

/**
 * Whether two lists of labels hold the same names, in any order.
 *
 * The comparison a work's makers are judged by (#720): the source states them in
 * an order and can restate them in another, and a run that reordered co-authors
 * has changed nothing about the work. Reported as a set, so the same question the
 * diff asks is the one the writer's guard asks — the record and the row cannot
 * then disagree about whether anything moved.
 */
export function sameLabelSet(
  before: readonly (string | null)[], after: readonly (string | null)[],
): boolean {
  if (before.length !== after.length) return false;
  const left = new Set(before.map(foldLabel));
  const right = new Set(after.map(foldLabel));
  if (left.size !== right.size) return false;
  for (const name of left) if (!right.has(name)) return false;
  return true;
}

/**
 * The code points JavaScript's `\s` matches beyond ASCII, as SQL spells them
 * — an `(\s|\u00a0|…)` alternation, never a bracket expression, since under
 * `en_US.utf8` a bracket expression over these code points also matches the
 * en dash (measured on the development catalogue: it named *MAK – Museum of
 * Applied Arts*). `tidyLabel` collapses `\s+`, so this is the same set the
 * store rule collapses, spelled for a runtime whose `\s` stops at ASCII.
 * Pinned to `\s` itself by `labelFold.test.ts`, which walks the Basic
 * Multilingual Plane.
 */
export const JS_WHITESPACE_CODE_POINTS: readonly number[] = [
  0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

/** One whitespace character, as a Postgres regular expression: `\s` or any of the code points above. */
export const SQL_WHITESPACE_ALTERNATION = `(\\s|${
  JS_WHITESPACE_CODE_POINTS.map(cp => `\\u${cp.toString(16).padStart(4, '0')}`).join('|')
})`;

/**
 * `tidyLabel` as SQL over a text expression, for what has to ask the rule of
 * stored rows: the catalogue check that names a row a writer left untidy, and
 * — spelled out in the file, which can import nothing — migration 047, which
 * tidied what was stored before the writers did. The check pins that the two
 * spellings agree. `btrim` on the plain space alone, because the replace
 * before it has already made every run a plain space.
 */
export const tidyLabelSql = (expression: string): string =>
  `btrim(regexp_replace(${expression}, '${SQL_WHITESPACE_ALTERNATION}+', ' ', 'g'), ' ')`;

/** One of the characters a list of code points names, as a Postgres alternation. */
const alternation = (codePoints: readonly number[]): string =>
  '(' + codePoints.map(cp => '\\u' + cp.toString(16).padStart(4, '0')).join('|') + ')';

/**
 * `foldTypography` (`@tyr/shared/labels`) as SQL over a text expression, for
 * the location writer's guard on a held point's name (#1834) and, spelled out
 * in the file, migration 154. Alternations rather than bracket expressions, for
 * the reason `SQL_WHITESPACE_ALTERNATION` gives. Pinned to the TypeScript rule
 * by `labelFold.db.test.ts`.
 */
export const typographyFoldSql = (expression: string): string => {
  const quotes = alternation([0x2018, 0x2019, 0x201a, 0x201b, 0x02bc, 0x2032]);
  const doubleQuotes = alternation([0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x00ab, 0x00bb]);
  const dashes = alternation([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]);
  const folded = `regexp_replace(regexp_replace(regexp_replace(normalize(${expression}, NFC),
      '${quotes}', '''', 'g'), '${doubleQuotes}', '"', 'g'), '${dashes}', '-', 'g')`;
  return tidyLabelSql(`regexp_replace(${folded}, '(${SQL_WHITESPACE_ALTERNATION}|\\\\[tn])+$', '')`);
};

/**
 * `sameTypography` as SQL: an incoming text that differs from the stored one,
 * ends in no literal escape, and folds to the same text. Null on either side
 * is no rewrite.
 */
export const sameTypographySql = (stored: string, incoming: string): string =>
  `COALESCE(${stored} <> ${incoming}
     AND ${incoming} !~ '\\\\[tn]${SQL_WHITESPACE_ALTERNATION}*$'
     AND ${typographyFoldSql(stored)} = ${typographyFoldSql(incoming)}, false)`;

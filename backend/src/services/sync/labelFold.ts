/**
 * Two labels that name the same thing.
 *
 * Unicode-normalised, dashes folded together, whitespace collapsed, compared
 * case-insensitively. Everything folded here is a typographic rewrite of one
 * name: `Boma-Badingilo` becoming `Boma–Badingilo` is the source's typesetting,
 * not a decision about a place, and nobody can answer a card that asks about it.
 *
 * Case is folded for the same reason and no further: a name that differs by more
 * than its punctuation is a real rename and is reported, minor.
 *
 * Its own module because three readings of the same rule now depend on it and
 * they sit in different layers: the contents diff asks whether a name changed,
 * the museum pool asks whether two creator statements name the same person —
 * Q2415079 (*The Washington Family*) lists "Edward Savage" twice under two QIDs
 * — and the landmark parse asks it of a monument's makers. A second fold would
 * be a second answer to "is this the same name", and the diff and the importer
 * disagreeing about that is a card raised about nothing.
 */

/** A label reduced to what it names, with its typesetting removed. */
export function foldLabel(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    // Every dash Unicode offers, to the plain one. `‐-―` covers hyphen
    // through horizontal bar; `−` is the minus sign, which sources use too.
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Whether two labels name the same thing. */
export function sameLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  return foldLabel(a) === foldLabel(b);
}

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
 * A label as a person would type it: the edges trimmed, a run of whitespace
 * inside it collapsed to one space. Case, dashes and accents stay — this is
 * the *store* rule, not the fold: what a row holds is still the source's
 * spelling, only without the typesetting nobody can see.
 *
 * Every source is a label service and a label service passes runs through:
 * Wikidata's English label for *St. John  on Patmos* (Q2390197) carries two
 * spaces and *Portrait of a Man (Self      Portrait?)* (Q2392901) six, the
 * World Heritage Centre's component names carry eighteen runs across the
 * catalogue, and four Arabic and Spanish local names hold a no-break space.
 * On screen HTML collapses all of it, so a reader types what they see and a
 * filter that compares the raw string finds nothing (#835). Applied by every
 * writer of a name — the three importers' writers and the curator's schemas
 * alike — *before* the diff, so a run compares tidied to tidied and reports no
 * rename for a label it only tidied.
 *
 * `\s` is JavaScript's class: ASCII whitespace and Unicode's spaces, the
 * no-break space included. `JS_WHITESPACE_CODE_POINTS` spells the same set out
 * for SQL, where `\s` stops at ASCII and a bracket expression over these code
 * points misfires under a locale collation.
 */
export function tidyLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The code points JavaScript's `\s` matches beyond ASCII, as SQL spells them
 * — an `(\s|\u00a0|…)` alternation, never a bracket expression, since under
 * `en_US.utf8` a bracket expression over these code points also matches the
 * en dash (measured on the development catalogue: it named *MAK – Museum of
 * Applied Arts*). Pinned to
 * `\s` itself by `labelFold.test.ts`, which walks the Basic Multilingual Plane.
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

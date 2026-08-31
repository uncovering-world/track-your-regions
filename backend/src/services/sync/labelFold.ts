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

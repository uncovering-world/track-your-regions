/**
 * Two labels that name the same thing, and a label as a person would type it.
 *
 * Unicode-normalised, dashes folded together, whitespace collapsed, compared
 * case-insensitively. Everything folded here is a typographic rewrite of one
 * name: `Boma-Badingilo` becoming `Boma–Badingilo` is the source's typesetting,
 * not a decision about a place, and nobody can answer a card that asks about it.
 *
 * Case is folded for the same reason and no further: a name that differs by more
 * than its punctuation is a real rename and is reported, minor.
 *
 * One declaration for both sides, because a form and an endpoint have to answer
 * "is this the same name" alike: the server refuses a maker list that names one
 * person twice, folded, and a form that asked a narrower question would let
 * through exactly what the server then refuses — as `{ error: 'Validation
 * error' }` with the reason in a `details` array no screen reads. It is
 * reachable with an ordinary paste: a work names *Vincent van Gogh* and a
 * curator pastes `Vincent  van Gogh` off a wrapped line, or `Jean‐Luc Godard`
 * with U+2010 where the stored name has a hyphen. Declared once so both sides
 * answer "is this the same name" alike (#789).
 *
 * On the storing side the same rule is also spelled for SQL
 * (`backend/src/services/sync/labelFold.ts`), where `\s` stops at ASCII.
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
 * rename for a label it only tidied; and asked by a form of what a curator
 * typed *and* of what is stored before it decides whether anything changed,
 * so a title pasted with two spaces over a stored one with one does not claim
 * the column over an edit nobody made.
 *
 * `\s` is JavaScript's class: ASCII whitespace and Unicode's spaces, the
 * no-break space included.
 */
export function tidyLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

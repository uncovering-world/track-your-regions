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
 * error' }` with the reason in Zod's words about a body path. It is
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

/**
 * A name with a capital first letter, unless its first word is spelled
 * lowercase on purpose (#2137, ADR-0160). Wikidata's English labels follow its
 * sentence-case style, which lowercases a common noun: *mortuary temple of
 * Hatshepsut*, *iron pillar of Delhi*, *place de la Concorde*. A reader
 * expects a name to start with a capital, and English writes these with one.
 * A first word that carries a capital of its own is spelled that way on
 * purpose and is kept: the particle of *al-Azhar Mosque*, the prefixes of
 * *iSimangaliso Wetland Park* and *uKhahlamba Drakensberg Park*,
 * *'s-Hertogenbosch*. Only the first letter changes, after whatever
 * punctuation opens the name (*[main complex of Mahabalipuram]*), and a name
 * that opens with a digit, or with a letter whose capital is two letters (ß, a
 * ligature), is kept: *1st Avenue*.
 *
 * Read off the word itself rather than a list or another language's label:
 * German writes *via Condotti*, and Wikipedia's titles start with a capital
 * whatever the name, *Al-Azhar Mosque* among them. Spelled for SQL in
 * `backend/src/services/sync/labelFold.ts` (`capitalizedNameSql`), pinned to
 * this one by `labelFold.db.test.ts`.
 */
export function capitalizedName(value: string): string {
  if (/^\S*\p{Lu}/u.test(value)) return value;
  // A letter whose capital is two letters (ß, a ligature) is kept, as Postgres's `upper` keeps it.
  return value.replace(/^([^\p{L}\p{N}]*)(\p{Ll})/u, (whole, lead: string, letter: string) =>
    ([...letter.toUpperCase()].length === 1 ? lead + letter.toUpperCase() : whole));
}

/** The Latin ligatures Unicode encodes, U+FB00–U+FB06. */
const LIGATURE = /[\uFB00-\uFB06]/g;

/**
 * A text with the World Heritage list's typesetting defects mended (#1965,
 * ADR-0147), the way the list's reader stores a component's name:
 * - a straight double quote with no opening one goes: every run of them that
 *   follows a letter before the first quote that opens
 *   (*Southern Kamchatka" Regional Nature Park*), and a last one that follows
 *   a letter at the very end of a text holding an odd number of them
 *   (*"Kluchevskoy" Regional Nature Park"*). A quote after a digit stays,
 *   since it is an inch or a second: *Battery of 12" guns*;
 * - a Latin ligature is spelled out, and a space the list put before it after
 *   a letter goes: *Dionysian forti ﬁcations* is *Dionysian fortifications*;
 * - a comma between two letters gets one space after it: *Shoal Tower,Kingston*
 *   is *Shoal Tower, Kingston*, while *Tombs No. 1,2,3* keeps its digits' comma.
 *
 * A quote in another shape counts when telling whether a quote opens, so
 * `the “Golden" Gate` keeps its straight one, and only a straight quote is
 * ever removed.
 *
 * In that order, so the text it returns is its own mend: a quote taken away
 * can bring a comma or a ligature next to a letter, and nothing after it
 * brings a quote back. Square brackets stay as the list writes them, and so
 * does everything else. Spelled for SQL in
 * `backend/src/services/sync/labelFold.ts` (`untypesetSql`), pinned to this
 * one by `labelFold.db.test.ts`.
 */
export function untypeset(value: string): string {
  // Whether a quote opens is read over every shape, and only a straight one
  // goes: one shape replaces one code unit, so the positions agree.
  const unopened = /^(?:[^"]|(?<=\p{L})"+)*/u.exec(withStraightDoubleQuotes(value))?.[0].length ?? 0;
  const unquoted = value.slice(0, unopened).replaceAll('"', '') + value.slice(unopened);
  const odd = (withStraightDoubleQuotes(unquoted).split('"').length - 1) % 2 === 1;
  const balanced = odd && /\p{L}"$/u.test(unquoted) ? unquoted.slice(0, -1) : unquoted;
  return balanced
    .replace(/(\p{L}) +(?=[\uFB00-\uFB06])/gu, '$1')
    .replace(LIGATURE, ligature => ligature.normalize('NFKC'))
    .replace(/(\p{L}),(?=\p{L})/gu, '$1, ');
}

/**
 * Whether a rewrite brings one of the list's defects into a text that held
 * none (`untypeset`): the one direction typography never passes.
 */
function addsDefect(stored: string, incoming: string): boolean {
  const defective = (text: string) => untypeset(withStraightDoubleQuotes(text)) !== withStraightDoubleQuotes(text);
  return defective(incoming) && !defective(stored);
}

/**
 * Every double quote shape folded to the straight one, before the list's
 * defects are read: `the “Golden" Gate` has an opening quote, only in another
 * shape, and *Kamchatka” Park* has none.
 */
function withStraightDoubleQuotes(value: string): string {
  return value.replace(/[“”„‟″«»]/g, '"');
}

/**
 * A text with its typesetting removed, for the gate's `typography` class
 * (#1834, ADR-0139, ADR-0147): canonically composed (NFC), a trailing literal
 * `\t` or `\n` escape dropped, every double quote shape folded to the plain
 * one, the list's defects mended (`untypeset`), every apostrophe shape folded
 * to the plain one and every dash to the hyphen, runs of whitespace collapsed to one space and the ends trimmed. Case
 * and accents stay, and so does every space between two characters but the
 * two `untypeset` mends: *Hollokö* written *Hollok ö* is a corruption, not
 * typesetting.
 *
 * The escape is the World Heritage list's: it once wrote some component names
 * with a backslash and a `t` at the end (*Maltepe Tumulus\t* at Pergamon), and
 * the stored names still carry them as text.
 *
 * Spelled for SQL in `backend/src/services/sync/labelFold.ts`
 * (`typographyFoldSql`), for the location writer and migration 154.
 */
export function foldTypography(value: string): string {
  return untypeset(withStraightDoubleQuotes(withoutTrailingEscapes(value.normalize('NFC'))))
    .replace(/[‘’‚‛ʼ′]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text without the whitespace and literal `\t` / `\n` escapes it ends in. */
function withoutTrailingEscapes(value: string): string {
  let end = value.length;
  for (;;) {
    if (end > 0 && /\s/.test(value[end - 1])) end -= 1;
    else if (end > 1 && value[end - 2] === '\\' && (value[end - 1] === 't' || value[end - 1] === 'n')) end -= 2;
    else return value.slice(0, end);
  }
}

/**
 * Whether `incoming` rewrites `stored` only in its typesetting (`foldTypography`).
 * One way only for the escape, the list's defects and the first capital: a
 * rewrite that drops a trailing literal `\t`, mends a defect or capitalizes a
 * name's first letter (`capitalizedName`, ADR-0160) is the source's correction,
 * and one that adds an escape or a defect to a text clear of it, or lowercases
 * a capital, would write what this rule exists to clear. A text that held a
 * defect and still does, rewritten in its quote shapes alone, passes as it did
 * before.
 */
export function sameTypography(stored: string | null | undefined, incoming: string | null | undefined): boolean {
  return typeof stored === 'string' && typeof incoming === 'string' && stored !== incoming
    && withoutTrailingEscapes(incoming) === incoming.trimEnd()
    && !addsDefect(stored, incoming)
    && (foldTypography(stored) === foldTypography(incoming)
      || foldTypography(capitalizedName(stored)) === foldTypography(incoming));
}

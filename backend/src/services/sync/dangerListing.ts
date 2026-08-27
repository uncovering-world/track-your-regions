/**
 * UNESCO's danger listing, read from the one field that survives import.
 *
 * The World Heritage export says a site is on the List of World Heritage in
 * Danger twice: `danger`, a flag, and `danger_list`, the dated record of it --
 * "Y 2013" for the Ancient City of Aleppo. Measured against whc001 on
 * 2026-08-27 the two agree exactly, on 58 of 1273 records, and a site removed
 * from the list has *both* emptied: Belize Barrier Reef Reserve System, off the
 * list since 2018, answers `danger: "False"` with `danger_list: null`. So the
 * dated field is a current listing rather than a history, and reading it is
 * reading the same fact the flag states.
 *
 * The source's flag does not survive the import: what is stored is the boolean
 * the importer worked out and this string, as it arrived. That is why the parser
 * is its own module rather than a private detail of the importer -- the importer
 * asks it whether a site is in danger, and the read that puts "since 2013" under
 * the badge asks it the same question of the same string months later. One rule,
 * one runtime.
 */

/** A listing as the field states it: whether it stands, and since when. */
export interface DangerListing {
  listed: boolean;
  /** The year the listing began, where the field carries one. */
  since: number | null;
}

/** A four-digit year, and nothing else in the token. */
const YEAR = /^\d{4}$/;

/**
 * The listing this field states, or `null` where it states none.
 *
 * Read as two tokens rather than matched as one pattern: the answer is the
 * field's *first* token and the year is the second, which is what a split says
 * plainly -- and a single anchored pattern over "a word, then optional spaces
 * and digits" is the shape the ReDoS linter objects to, for a value that
 * arrives from somebody else's server.
 *
 * A shape this does not recognise answers `null`: an unreadable field is not
 * evidence that a site is in danger, and the flag beside it in the source is
 * what the importer falls back on.
 */
export function parseDangerListing(value: unknown): DangerListing | null {
  if (typeof value !== 'string') return null;
  const [answer, year, ...rest] = value.trim().split(/\s+/);
  const listed = answer?.toUpperCase() === 'Y';
  if (!listed && answer?.toUpperCase() !== 'N') return null;
  // A third token means this is not the field's shape at all, and guessing at
  // half of it would be worse than saying nothing.
  if (rest.length > 0) return null;
  // A year on an N would be the year the listing *ended*, which is not what
  // `since` means. Nothing carries it today; saying so costs one condition.
  return { listed, since: listed && year && YEAR.test(year) ? Number(year) : null };
}

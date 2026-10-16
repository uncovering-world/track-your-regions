/**
 * The country a place is labelled with (#1533): its own country, unless the
 * point it is drawn at says which part of it stands there.
 *
 * Louise Bourgeois's *Maman* is cast in Bilbao, Ottawa, London and Tokyo, and
 * Wikidata states each cast as a coordinate qualified with the place it
 * applies to (P518) and four countries tied to none of them, so the first of
 * each drew it in London and called it Spain. Where the chosen point names
 * its parts, the country is the first of the place's own that one of those
 * parts stands in (`partCountries`), and none when no part agrees. A point
 * naming no part keeps the first country. Which countries count at all is
 * `standingCountries`'s, applied first.
 */
export function countryOfPlace(
  countries: readonly string[], partCountries: ReadonlySet<string> | null,
): string | null {
  const distinct = [...new Set(countries)];
  if (distinct.length <= 1 || partCountries === null) return distinct[0] ?? null;
  return distinct.find(country => partCountries.has(country)) ?? null;
}

/** One of a place's best countries, and whether it still holds today. */
export interface PlaceCountry {
  country: string;
  /** The country's item, where the reader keys countries by something else (the live query keys them by label). */
  qid?: string;
  /** Some statement of it carries no end time (`P582`), and the state was not dissolved (`P576`). */
  stands: boolean;
}

/**
 * The countries a place is in today (#757): the ones that still hold, or,
 * when none does, every one as before.
 *
 * Wikidata states a site in each state it has belonged to, at the same rank:
 * Ephesus in the Roman Empire, the Seljuk Empire and Turkey; the Stutthof camp
 * in Nazi Germany (ended 1945) and Poland; the Moslavina monument in Croatia
 * and Yugoslavia (dissolved 1992). A traveller standing there is in Turkey,
 * Poland and Croatia, which is the one statement neither ended nor naming a
 * state that is gone. A place stated only in states that are gone keeps them
 * here, for its point to settle (`openCountries`, then `settleCountriesByPoint`,
 * #1564): Mediolanum, stated only in Ancient Rome, ends up in Italy.
 */
export function standingCountries(countries: readonly PlaceCountry[]): string[] {
  const standing = countries.filter(c => c.stands).map(c => c.country);
  return standing.length ? standing : countries.map(c => c.country);
}

/** A country a place may be named in, as the reader knows it: its item, and its label. */
export interface CountryOption {
  qid: string | null;
  label: string;
}

/**
 * What the place's own statements leave for its point to decide (#1564): the
 * candidates, and whether any of them still stands.
 */
export interface CountryOptions {
  candidates: CountryOption[];
  noneStands: boolean;
}

/**
 * Whether the statements leave the country open, and among which of them.
 * Open when more than one country stands and no part of the point picked one —
 * Wikidata lists Russia before Italy on the Basilica of Sant'Ambrogio in Milan,
 * and statement order cannot tell an error from a second country — or when none
 * stands at all, as Mediolanum stands only in Ancient Rome. Null when the
 * statements decided: one standing country, or the part the point applies to.
 * The answer is in the reader's own keys, as `countries` gives them.
 */
export function openCountries(
  countries: readonly PlaceCountry[], partCountries: ReadonlySet<string> | null,
): { keys: string[]; noneStands: boolean } | null {
  const noneStands = countries.length > 0 && !countries.some(c => c.stands);
  const keys = [...new Set(standingCountries(countries))];
  if (noneStands) return { keys, noneStands };
  return keys.length > 1 && partCountries === null ? { keys, noneStands } : null;
}

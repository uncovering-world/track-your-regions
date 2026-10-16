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
 * state that is gone. A place stated only in states that are gone — Mediolanum
 * in Ancient Rome — keeps them rather than losing its country.
 */
export function standingCountries(countries: readonly PlaceCountry[]): string[] {
  const standing = countries.filter(c => c.stands).map(c => c.country);
  return standing.length ? standing : countries.map(c => c.country);
}

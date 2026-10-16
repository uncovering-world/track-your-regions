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
 * naming no part keeps the first country: two countries at one site are a
 * border it once had, Ephesus in the Roman Empire and in Turkey, and which of
 * them to show is #757's question.
 */
export function countryOfPlace(
  countries: readonly string[], partCountries: ReadonlySet<string> | null,
): string | null {
  const distinct = [...new Set(countries)];
  if (distinct.length <= 1 || partCountries === null) return distinct[0] ?? null;
  return distinct.find(country => partCountries.has(country)) ?? null;
}

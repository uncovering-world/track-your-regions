/**
 * What to call one of an experience's locations when the source did not name it.
 *
 * Four screens ask this — the expanded list, its out-of-region section, the map's
 * marker layer and Discover's detail panel — and they used to answer it with an
 * inline `Location ${ordinal + 1}`, which was the same expression four times and
 * has one case it cannot express.
 *
 * **`ordinal` is nullable, and a null one has no number to show.** It means the
 * source no longer lists this point: either the withdrawal is already recorded
 * (`missing_since`) and no reader-facing read returns the row at all, or it is a
 * point whose replacement is still waiting to be published, which readers do see
 * (ADR-0025 decision 5, `locationWriter.ts`). `${null + 1}` is `1`, so the obvious
 * arithmetic prints "Location 1" — and that label is already taken: a sync numbers
 * from 1, so its first component reads "Location 2", while a curator-created first
 * point sits at ordinal 0 and reads "Location 1". Two different places under one
 * name, one of them about to disappear, is worse than no number.
 *
 * So a point with no place in the list gets no number. The numbering of every
 * other row is left exactly as it was, off by one and all: changing it would
 * rename components that visitors and curators have been reading for months, which
 * is a product decision and not this function's to take.
 *
 * `ordinal` is optional here, not merely nullable, and the two are different
 * claims: nullable says the server may send `null`, optional says the key may be
 * absent. The value crosses the API boundary with no runtime validation, so a
 * payload that omits it reaches this function as `undefined` — and
 * `undefined === null` is false, so a check written against only `null` falls
 * through to `undefined + 1`, which is `NaN` rather than the label a held point
 * should get. `== null` catches both, and the signature now says so instead of
 * being contradicted by its own docstring.
 */
export function locationLabel(
  location: { name?: string | null; ordinal?: number | null },
): string {
  if (location.name) return location.name;
  if (location.ordinal == null) return 'Location';
  return `Location ${location.ordinal + 1}`;
}

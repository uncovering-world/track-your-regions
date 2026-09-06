/**
 * What a place's claims read as on a row: "name corrected", "pin corrected", or both.
 *
 * A correction claims the field it changed (`experience_locations.curated_fields`,
 * migration 027), and the source stops overwriting it. Without a word on the row a
 * curator cannot tell a pin they moved from one the source put there — and the same
 * row is drawn on the review page, on the object screen and on the map, so the word
 * is decided once. Only the two keys the endpoint writes are named; anything else in
 * the column is a claim this screen does not know how to describe, and is left to
 * the claims screen (#626) rather than guessed at.
 */
export function claimLabel(curatedFields: ReadonlyArray<string> | null | undefined): string | null {
  const claims = new Set(curatedFields ?? []);
  const name = claims.has('name');
  const pin = claims.has('location');
  if (name && pin) return 'name and pin corrected';
  if (name) return 'name corrected';
  if (pin) return 'pin corrected';
  return null;
}

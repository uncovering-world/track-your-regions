/**
 * A field's name as a person says it.
 *
 * The queue names fields the way the changeset does — `shortDescription`, `imageUrl`,
 * `metadata.dateInscribed` — because that is what the accept call takes and what the
 * curated-claim map is keyed by. Printing those on a card asks a curator to read the
 * schema: it is our word, not theirs, and "shortDescription" is not a thing anyone says.
 *
 * The mapping is deliberate rather than a mechanical de-camelCasing: `imageUrl` is *the
 * picture* to a curator, and `metadata.*` keys are worth marking as coming from the
 * source's own extra data, because those are exactly the ones whose acceptance lands at
 * the next sync rather than now.
 */
const LABELS: Record<string, string> = {
  name: 'name',
  nameLocal: 'local name',
  description: 'description',
  shortDescription: 'short description',
  category: 'category',
  tags: 'tags',
  location: 'coordinates',
  countryCodes: 'country codes',
  countryNames: 'countries',
  imageUrl: 'picture',
  metadata: 'source data',
};

export function fieldLabel(field: string): string {
  const known = LABELS[field];
  if (known) return known;
  // `metadata.dateInscribed` and its kin: name the key in words and say where it lives,
  // since a curator has no reason to know `metadata` is a column rather than a concept.
  if (field.startsWith('metadata.')) {
    const key = field.slice('metadata.'.length);
    return `${key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} (source data)`;
  }
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

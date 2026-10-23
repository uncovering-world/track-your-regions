/**
 * Which of a place's fields a reader is shown (#1834, ADR-0139).
 *
 * A gated source may not overwrite what a reader can already see (ADR-0025), so
 * the gate asks a curator about a rewrite of a field a reader is shown and
 * passes a rewrite of one no reader is shown (`unseen`), recording it as such.
 * The review card marks the second kind of row "readers do not see this". Both
 * read this mark, so marking a field shown is what makes the gate hold its next
 * rewrite. That change owes one more thing (ADR-0139 decision 3): the values
 * written while the field was unseen, filed with `passedTheGate: unseen`, go back
 * to a curator as one held question per place. Nothing does that yet; the
 * change that flips a mark builds it.
 *
 * Measured on 2026-10-23 against every surface a visitor reads a place on: the
 * expanded row in Map mode (`ExperienceExpandedDetails`), Discover's card and
 * detail panel (`ExperienceCard`, `ExperienceDetailPanel`), the hover cards
 * (`HoverPreviewCard`, `DiscoverHoverCard`), the point card (`PointCard`), the
 * place's links (`PlaceLinks`), the picture's credit (`ImageCreditLine`), the
 * extent (`ExtentLine`), and what the server derives for them from the stored
 * row (`danger_since` from `dangerList`, `experienceDanger.ts`). A field none
 * of them reads, directly or through the server, is `unseen`.
 *
 * Keyed by the name a run's change record gives the field: a column as
 * `computeChangeSet` names it, `metadata.<key>` for a metadata key, and
 * `nameLocal` for every language of the local names, which are reported as
 * `nameLocal.<lang>`. A field a run writes with no mark here fails
 * `readerFields.test.ts` in the backend.
 */

export type ReaderMark = 'shown' | 'unseen';

/** The mark of each field of a place a run writes. */
export const PLACE_FIELD_MARKS: Readonly<Record<string, ReaderMark>> = {
  name: 'shown',
  subtitle: 'shown',
  description: 'shown',
  type: 'shown',
  imageUrl: 'shown',
  location: 'shown',
  boundary: 'shown',
  // No surface draws a local name: the experience response carries the map and
  // nothing renders it (#734).
  nameLocal: 'unseen',
  // Labels the run derives from other facts; no read returns them (#570).
  tags: 'unseen',
  // The world view a reader browses says where a place is (#1579).
  countryCodes: 'unseen',
  countryNames: 'unseen',

  'metadata.dateInscribed': 'shown',
  'metadata.inDanger': 'shown',
  'metadata.dangerList': 'shown',
  'metadata.website': 'shown',
  'metadata.wikipediaUrl': 'shown',
  'metadata.unescoUrl': 'shown',
  'metadata.imageCredit': 'shown',

  'metadata.criteria': 'unseen',
  'metadata.region': 'unseen',
  'metadata.transboundary': 'unseen',
  'metadata.areaHectares': 'unseen',
  'metadata.wikidataQid': 'unseen',
  // A monument's inception year and its makers. A place's year is the item's
  // inception (`P571`), which for a memorial in an older building is the
  // building's year: the Genbaku Dome reads 1915. Settle what it means before
  // marking it shown.
  'metadata.year': 'unseen',
  'metadata.creators': 'unseen',
  // Two keys a few early public-art rows still carry, which no run writes now.
  'metadata.creator': 'unseen',
  'metadata.type': 'unseen',

  // What a run computes about its own pass. Never diffed, so never asked about
  // either way; marked so the mark is total.
  'metadata.artworkCount': 'unseen',
  'metadata.totalArtworkSitelinks': 'unseen',
  'metadata.sitelinksCount': 'unseen',
  'metadata.wikidataClasses': 'unseen',
  'metadata.wikidataArtwork': 'unseen',
  'metadata.archaeologyNature': 'unseen',
  'metadata.admissionNote': 'unseen',
  'metadata.wikipediaCategories': 'unseen',
  'metadata.museumReadershipNote': 'unseen',
  'metadata.worshipReadershipNote': 'unseen',
  'metadata.osm': 'unseen',
};

/** The local names' prefix: `nameLocal.ko` is marked as `nameLocal`. */
const NAME_LOCAL_PREFIX = 'nameLocal.';

/** A field's mark, or null where the field has none. */
export function placeFieldMark(field: string): ReaderMark | null {
  const key = field.startsWith(NAME_LOCAL_PREFIX) ? 'nameLocal' : field;
  return Object.hasOwn(PLACE_FIELD_MARKS, key) ? PLACE_FIELD_MARKS[key] : null;
}

/** Whether no reader is shown a field of a place. An unmarked field is not. */
export function placeFieldUnseen(field: string): boolean {
  return placeFieldMark(field) === 'unseen';
}

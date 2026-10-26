/**
 * The fields a run writes about a place: whose each one is, and whether a
 * reader is shown it (ADR-0153, ADR-0139).
 *
 * **Whose.** A field is the place's or one kind's, by what it means (ADR-0153).
 * The place's name, picture, coordinate, outline, Wikidata item and website are
 * the place's whichever kind offers it. A monument's year and makers, the
 * classes a kind's rule read, the counts a run makes of a venue's works and the
 * question a run asks a curator are one kind's: Places of worship has nothing
 * to say about Charminar's year, and a count of the works Art Museums placed is
 * not Archaeology's. A kind's field lives on that kind's membership
 * (`experience_kind_memberships.facts`) and the place's on the place, so two
 * kinds of one place never write over each other. UNESCO's facts about an
 * inscription are the World Heritage kind's and are still stored on the place
 * until they move to its membership (#1775).
 *
 * **Shown.** A gated source may not overwrite what a reader can already see
 * (ADR-0025), so the gate asks a curator about a rewrite of a field a reader is
 * shown and passes a rewrite of one no reader is shown (`unseen`), recording it
 * as such. The review card marks the second kind of row "readers do not see
 * this". Both read this mark, so marking a field shown is what makes the gate
 * hold its next rewrite. That change owes one more thing (ADR-0139 decision 3):
 * the values written while the field was unseen, filed with `passedTheGate:
 * unseen`, go back to a curator as one held question per place. Nothing does
 * that yet; the change that flips a mark builds it.
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
 * `computeChangeSet` names it, `metadata.<key>` for a key of the run's record,
 * which a kind's field keeps although it is stored on the membership, and
 * `nameLocal` for every language of the local names, which are reported as
 * `nameLocal.<lang>`. A field a run writes with no entry here fails
 * `placeFields.test.ts` in the backend.
 */

export type ReaderMark = 'shown' | 'unseen';

/** Whose a field is: the place's, or the kind's whose run writes it. */
export type FieldOwner = 'place' | 'kind';

export interface PlaceField {
  mark: ReaderMark;
  owner: FieldOwner;
}

const place = (mark: ReaderMark): PlaceField => ({ mark, owner: 'place' });
const kind = (mark: ReaderMark): PlaceField => ({ mark, owner: 'kind' });

/** Each field of a place a run writes. */
export const PLACE_FIELDS: Readonly<Record<string, PlaceField>> = {
  name: place('shown'),
  subtitle: place('shown'),
  description: place('shown'),
  // The type within the kind, which the run's record names as a column and the
  // membership stores (ADR-0084).
  type: kind('shown'),
  imageUrl: place('shown'),
  location: place('shown'),
  boundary: place('shown'),
  // No surface draws a local name: the experience response carries the map and
  // nothing renders it (#734).
  nameLocal: place('unseen'),
  // Labels the run derives from other facts; no read returns them (#570).
  tags: place('unseen'),
  // The world view a reader browses says where a place is (#1579).
  countryCodes: place('unseen'),
  countryNames: place('unseen'),

  'metadata.website': place('shown'),
  'metadata.wikipediaUrl': place('shown'),
  'metadata.imageCredit': place('shown'),
  'metadata.wikidataQid': place('unseen'),
  // How famous the item is, in Wikipedia editions: the item's, whichever kind
  // read it. Measured each pass, so never diffed.
  'metadata.sitelinksCount': place('unseen'),
  // What OpenStreetMap said about the outline (ADR-0059 decision 2), which goes
  // with the outline it describes (ADR-0146).
  'metadata.osm': place('unseen'),
  // The run's mark of what it took from UNESCO's dataset (ADR-0149); a reader
  // sees the credit it answers for, never the mark.
  'metadata.unesco': place('unseen'),

  // The inscription, the World Heritage kind's.
  'metadata.dateInscribed': kind('shown'),
  'metadata.inDanger': kind('shown'),
  'metadata.dangerList': kind('shown'),
  'metadata.unescoUrl': kind('shown'),
  'metadata.criteria': kind('unseen'),
  'metadata.region': kind('unseen'),
  'metadata.transboundary': kind('unseen'),
  'metadata.areaHectares': kind('unseen'),

  // A monument's inception year and its makers. A place's year is the item's
  // inception (`P571`), which for a memorial in an older building is the
  // building's year: the Genbaku Dome reads 1915. Settle what it means before
  // marking it shown.
  'metadata.year': kind('unseen'),
  'metadata.creators': kind('unseen'),

  // What a run computes about its own pass. Never diffed, so never asked about
  // either way; marked so the mark is total.
  'metadata.artworkCount': kind('unseen'),
  'metadata.totalArtworkSitelinks': kind('unseen'),
  'metadata.wikidataClasses': kind('unseen'),
  'metadata.wikidataArtwork': kind('unseen'),
  'metadata.archaeologyNature': kind('unseen'),
  'metadata.wikipediaCategories': kind('unseen'),
  // The run's question to a curator about the place's admission: Archaeology's
  // rule, or a readership door (ADR-0056).
  'metadata.admissionNote': kind('unseen'),
};

/** The local names' prefix: `nameLocal.ko` is marked as `nameLocal`. */
const NAME_LOCAL_PREFIX = 'nameLocal.';

/** A field's mark, or null where the field has none. */
export function placeFieldMark(field: string): ReaderMark | null {
  const key = field.startsWith(NAME_LOCAL_PREFIX) ? 'nameLocal' : field;
  return Object.hasOwn(PLACE_FIELDS, key) ? PLACE_FIELDS[key].mark : null;
}

/** Whether no reader is shown a field of a place. An unmarked field is not. */
export function placeFieldUnseen(field: string): boolean {
  return placeFieldMark(field) === 'unseen';
}

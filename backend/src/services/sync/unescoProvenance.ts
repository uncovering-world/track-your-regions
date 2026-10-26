/**
 * What the UNESCO run takes from UNESCO's dataset onto a row, marked so that
 * part of the catalogue can be named and offered on its own (ADR-0149).
 *
 * The run reads `whc001` on data.unesco.org, which UNESCO publishes under
 * CC BY-SA 4.0. A database holding a substantial part of it is Adapted
 * Material for the database right (CC BY-SA 4.0 § 4(b)), so the catalogue
 * keeps that part separable, as ADR-0059 does for OpenStreetMap: every row the
 * run writes carries `metadata.unesco`, naming the dataset, the property, the
 * date the run read it, the licence and the fields it took. The facts (names,
 * numbers, coordinates, references) are kept apart from the text, the one
 * field the licence reaches as an expression, and which a reader is shown with
 * its credit (`description_source`, `DescriptionText`).
 *
 * The mark names what the run read, not what the row holds: a field in the
 * row's `curated_fields` keeps the curator's value, and a field the sources
 * contradict keeps the place's own (`keptAsStored`), so the UNESCO-derived part
 * is the mark less the claims and less what differs from the UNESCO
 * membership's `reported_*` view, except for a description the curator said is
 * an edit of UNESCO's text (`descriptionSourceSql`).
 */

import { TEXT_CREDITS } from '@tyr/shared/textCredits';

export const UNESCO_DATASET = 'whc001';

/**
 * The facts the run takes from the dataset, as the run's record names them: a
 * column, or `metadata.<key>`. `location` is the place's point and `locations`
 * its components. The inscription's facts are stored on the World Heritage
 * membership (`kindFacts.ts`, #2068) under the same keys.
 */
export const UNESCO_FACT_FIELDS = [
  'name', 'nameLocal', 'type', 'tags', 'location', 'locations', 'countryCodes', 'countryNames',
  'metadata.dateInscribed', 'metadata.inDanger', 'metadata.dangerList', 'metadata.criteria',
  'metadata.region', 'metadata.areaHectares', 'metadata.transboundary', 'metadata.unescoUrl',
] as const;

/** The text the run takes from the dataset: the property's short description. */
export const UNESCO_TEXT_FIELDS = ['description'] as const;

export interface UnescoProvenance {
  dataset: typeof UNESCO_DATASET;
  /** UNESCO's id of the property (`id_no`). */
  id: string;
  /** The day the run read the dataset, as `YYYY-MM-DD`. */
  readAt: string;
  licence: string;
  facts: readonly string[];
  /** Empty where the dataset gave the property no description. */
  text: readonly string[];
}

/** The mark a row the run writes carries (`metadata.unesco`). */
export function unescoProvenance(id: string, readAt: string, hasText: boolean): UnescoProvenance {
  return {
    dataset: UNESCO_DATASET,
    id,
    readAt,
    licence: TEXT_CREDITS.unesco.licence,
    facts: UNESCO_FACT_FIELDS,
    text: hasText ? UNESCO_TEXT_FIELDS : [],
  };
}

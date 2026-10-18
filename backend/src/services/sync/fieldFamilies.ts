/**
 * Which family of sources brings each of a place's fields, and what a run does
 * about the fields another family brings (ADR-0109, #1534).
 *
 * A place in two kinds holds what two sources said about it: the Acropolis
 * carries UNESCO's inscription year, danger flag, official names and text, and
 * Archaeology's Wikidata item, classes and fame. Each run writes its own
 * record over the place, which would remove whatever only the other family
 * reports. A field listed here is the listed family's: a run of another
 * family writes it as the place holds it, so it proposes nothing about it,
 * while that family has a standing membership on the place. A field listed for no family follows the gate and
 * the claims as before, and the name, description, picture and coordinate
 * follow the source views (`sourceView.ts`, ADR-0084).
 */

import type { PoolClient } from 'pg';
import { MEMBERSHIPS } from '../../db/membership.js';
import { viewStandsSql } from '../../db/sourceViews.js';

export type SourceFamily = 'unesco' | 'wikidata';

/**
 * Each source's family: the World Heritage list, and the four kinds read from
 * Wikidata, which read one item each whichever of them reads it (ADR-0085).
 * A source in no family owns nothing and keeps nothing from another.
 */
const SOURCE_FAMILY: Readonly<Record<number, SourceFamily>> = { 1: 'unesco', 2: 'wikidata', 3: 'wikidata', 4: 'wikidata', 5: 'wikidata' };

/** The place's columns a family can own, as the run's record names them. */
export type FamilyColumn = 'nameLocal' | 'shortDescription' | 'countryCodes' | 'countryNames';

export interface FamilyFields {
  columns: readonly FamilyColumn[];
  metadata: readonly string[];
}

/**
 * The fields each family brings and no other does, read off the places one
 * source holds alone on 2026-10-15. UNESCO's official names in its six
 * languages, its own text, the states party's codes and the facts of the
 * inscription. Wikidata's item, the place's own website, its classes, fame and
 * the counts a run makes of it. UNESCO's page about a site is its own key
 * (`unescoUrl`, #1538). The country names both families write, but they name
 * UNESCO's codes, so they go with them (ADR-0111, #1553). The Wikipedia
 * article is written by both families and listed for neither.
 */
export const FAMILY_FIELDS: Readonly<Record<SourceFamily, FamilyFields>> = {
  unesco: {
    columns: ['nameLocal', 'shortDescription', 'countryCodes', 'countryNames'],
    metadata: ['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary', 'areaHectares', 'unescoUrl'],
  },
  wikidata: {
    columns: [],
    metadata: [
      'website', 'wikidataQid', 'sitelinksCount', 'wikidataClasses', 'wikidataArtwork', 'year', 'creators', 'creator', 'type',
      'artworkCount', 'totalArtworkSitelinks', 'admissionNote', 'osm', 'archaeologyNature', 'wikipediaCategories',
      'museumReadershipNote', 'worshipReadershipNote',
    ],
  },
};

const familyOf = (sourceId: number): SourceFamily | null => SOURCE_FAMILY[sourceId] ?? null;

/**
 * The question each source's run asks a curator about a place, one key per
 * source. The four Wikidata kinds share a family, so the family rule keeps
 * none of these: without this list a museum run on the Israel Museum would
 * write its record without Archaeology's question, and a worship run would
 * take the museum door's away. A run writes its own key every pass, null
 * when it asks nothing, and another source's as the place holds it while
 * that source's membership stands.
 */
const SOURCE_OWN_METADATA: Readonly<Record<number, readonly string[]>> = {
  2: ['museumReadershipNote'],
  4: ['worshipReadershipNote'],
  5: ['admissionNote'],
};

/**
 * The fields of the place that another family's standing membership brings
 * and the run's own family does not, and the questions another source of the
 * place asks: those the run writes as the place holds them. None for a place
 * no other source holds, or a source in no family.
 */
export async function otherFamiliesFields(
  query: Pick<PoolClient, 'query'>,
  placeId: number,
  sourceId: number,
): Promise<FamilyFields> {
  if (familyOf(sourceId) === null) return { columns: [], metadata: [] };
  const result = await query.query<{ source_id: number }>(
    `SELECT DISTINCT m.source_id FROM ${MEMBERSHIPS} m
      WHERE m.experience_id = $1 AND m.source_id <> $2 AND ${viewStandsSql('m')}`,
    [placeId, sourceId],
  );
  return fieldsOfOthers(sourceId, result.rows.map(row => row.source_id));
}

/**
 * What the run of `sourceId` writes as the place holds it, given the other
 * sources with a standing membership on it: their families' fields, and each
 * one's own question. Split from the read so the sequence of runs can be
 * stated without a database.
 */
export function fieldsOfOthers(sourceId: number, otherSourceIds: readonly number[]): FamilyFields {
  const own = familyOf(sourceId);
  if (own === null) return { columns: [], metadata: [] };
  const others = new Set(otherSourceIds.map(familyOf).filter((f): f is SourceFamily => f !== null && f !== own));
  return {
    columns: [...others].flatMap(family => FAMILY_FIELDS[family].columns),
    metadata: [...new Set([
      ...[...others].flatMap(family => FAMILY_FIELDS[family].metadata),
      ...otherSourceIds.filter(id => id !== sourceId).flatMap(id => SOURCE_OWN_METADATA[id] ?? []),
    ])],
  };
}

/** The part of a run's record the family fields are read from. */
export interface FamilyRecord {
  nameLocal: Record<string, string>;
  shortDescription: string | null;
  countryCodes: string[];
  countryNames: string[];
  metadata: Record<string, unknown>;
}

/** The stored columns `keptForFamilies` puts back, as the upsert's snapshot read them. */
export interface StoredFamilyFields {
  name_local: Record<string, string> | null;
  short_description: string | null;
  country_codes: string[] | null;
  country_names: string[] | null;
  metadata: Record<string, unknown> | null;
}

/** The run's record with every field another family brings as the place holds it. */
export function keptForFamilies<T extends FamilyRecord>(params: T, stored: StoredFamilyFields, others: FamilyFields): T {
  if (others.columns.length === 0 && others.metadata.length === 0) return params;
  const kept = { ...params, metadata: { ...params.metadata } };
  for (const column of others.columns) {
    if (column === 'nameLocal') kept.nameLocal = stored.name_local ?? {};
    if (column === 'shortDescription') kept.shortDescription = stored.short_description;
    if (column === 'countryCodes') kept.countryCodes = stored.country_codes ?? [];
    if (column === 'countryNames') kept.countryNames = stored.country_names ?? [];
  }
  const storedMetadata = stored.metadata ?? {};
  for (const key of others.metadata) {
    if (Object.hasOwn(storedMetadata, key)) kept.metadata[key] = storedMetadata[key];
    else delete kept.metadata[key];
  }
  return kept;
}

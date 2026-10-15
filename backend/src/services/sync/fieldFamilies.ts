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
export type FamilyColumn = 'nameLocal' | 'shortDescription' | 'countryCodes';

export interface FamilyFields {
  columns: readonly FamilyColumn[];
  metadata: readonly string[];
}

/**
 * The fields each family brings and no other does, read off the places one
 * source holds alone on 2026-10-15. UNESCO's official names in its six
 * languages, its own text, the states party and the facts of the inscription.
 * Wikidata's item, classes, fame and the counts a run makes of it. The
 * website, the Wikipedia article and the country names are written by both
 * families and listed for neither.
 */
export const FAMILY_FIELDS: Readonly<Record<SourceFamily, FamilyFields>> = {
  unesco: {
    columns: ['nameLocal', 'shortDescription', 'countryCodes'],
    metadata: ['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary', 'areaHectares'],
  },
  wikidata: {
    columns: [],
    metadata: [
      'wikidataQid', 'sitelinksCount', 'wikidataClasses', 'wikidataArtwork', 'year', 'creators', 'creator', 'type',
      'artworkCount', 'totalArtworkSitelinks', 'admissionNote', 'osm', 'archaeologyNature', 'wikipediaCategories',
    ],
  },
};

const familyOf = (sourceId: number): SourceFamily | null => SOURCE_FAMILY[sourceId] ?? null;

/**
 * The fields of the place that another family's standing membership brings
 * and the run's own family does not: those the run writes as the place holds
 * them. None for a place no other family holds, or a source in no family.
 */
export async function otherFamiliesFields(
  query: Pick<PoolClient, 'query'>,
  placeId: number,
  sourceId: number,
): Promise<FamilyFields> {
  const own = familyOf(sourceId);
  if (own === null) return { columns: [], metadata: [] };
  const result = await query.query<{ source_id: number }>(
    `SELECT DISTINCT m.source_id FROM ${MEMBERSHIPS} m
      WHERE m.experience_id = $1 AND m.source_id <> $2 AND ${viewStandsSql('m')}`,
    [placeId, sourceId],
  );
  const others = new Set(result.rows.map(row => familyOf(row.source_id)).filter((f): f is SourceFamily => f !== null && f !== own));
  return {
    columns: [...others].flatMap(family => FAMILY_FIELDS[family].columns),
    metadata: [...others].flatMap(family => FAMILY_FIELDS[family].metadata),
  };
}

/** The part of a run's record the family fields are read from. */
export interface FamilyRecord {
  nameLocal: Record<string, string>;
  shortDescription: string | null;
  countryCodes: string[];
  metadata: Record<string, unknown>;
}

/** The stored columns `keptForFamilies` puts back, as the upsert's snapshot read them. */
export interface StoredFamilyFields {
  name_local: Record<string, string> | null;
  short_description: string | null;
  country_codes: string[] | null;
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
  }
  const storedMetadata = stored.metadata ?? {};
  for (const key of others.metadata) {
    if (Object.hasOwn(storedMetadata, key)) kept.metadata[key] = storedMetadata[key];
    else delete kept.metadata[key];
  }
  return kept;
}

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
 * while that family has a standing membership on the place, and UNESCO's page
 * about a site whatever memberships stand (ADR-0138). A field listed for no family follows the gate and
 * the claims as before, and the name, subtitle, picture and coordinate
 * follow the source views (`sourceView.ts`, ADR-0084).
 */

import type { PoolClient } from 'pg';
import { MEMBERSHIPS } from '../../db/membership.js';
import { viewStandsSql } from '../../db/sourceViews.js';

export type SourceFamily = 'unesco' | 'wikidata';

/**
 * Each source's family: the World Heritage list, and the kinds read from
 * Wikidata, which read one item each whichever of them reads it (ADR-0085).
 * A source in no family owns nothing and keeps nothing from another.
 */
const SOURCE_FAMILY: Readonly<Record<number, SourceFamily>> = { 1: 'unesco', 2: 'wikidata', 3: 'wikidata', 4: 'wikidata', 5: 'wikidata', 6: 'wikidata', 7: 'wikidata', 8: 'wikidata', 9: 'wikidata' };

/** The place's columns a family can own, as the run's record names them. */
export type FamilyColumn = 'nameLocal' | 'description' | 'countryCodes' | 'countryNames';

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
 * (`unescoUrl`, #1538), and so is the run's mark of what it took from UNESCO's
 * dataset (`unesco`, ADR-0149). The country names both families write, but they name
 * UNESCO's codes, so they go with them (ADR-0111, #1553). The Wikipedia
 * article is written by both families and listed for neither.
 */
export const FAMILY_FIELDS: Readonly<Record<SourceFamily, FamilyFields>> = {
  unesco: {
    columns: ['nameLocal', 'description', 'countryCodes', 'countryNames'],
    metadata: ['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary', 'areaHectares', 'unescoUrl', 'unesco'],
  },
  wikidata: {
    columns: [],
    metadata: [
      'website', 'wikidataQid', 'sitelinksCount', 'wikidataClasses', 'wikidataArtwork', 'year', 'creators', 'creator', 'type',
      'artworkCount', 'totalArtworkSitelinks', 'admissionNote', 'osm', 'archaeologyNature', 'wikipediaCategories',
      'museumReadershipNote', 'worshipReadershipNote', 'publicArtReadershipNote',
    ],
  },
};

const familyOf = (sourceId: number): SourceFamily | null => SOURCE_FAMILY[sourceId] ?? null;

/**
 * A field one family alone ever writes, which every other family's run keeps as
 * the place holds it whatever memberships stand: UNESCO's page about a site
 * (#1851). Migration 107 moved the World Heritage Centre addresses Wikidata had
 * given as websites into it, on places no UNESCO membership holds (Khajuraho's
 * place of worship), and a Wikidata run, which never writes it, would otherwise
 * propose removing it (ADR-0138).
 */
const KEPT_BY_EVERY_OTHER_FAMILY: Readonly<Record<SourceFamily, readonly string[]>> = {
  unesco: ['unescoUrl'],
  wikidata: [],
};

/**
 * The metadata keys only some sources of a family write, by source. A run
 * writes its own every pass, null when it has nothing to say, and keeps
 * another source's as the place holds it while that source's membership
 * stands, as `keptKeysOf` decides: without this list one Wikidata kind's run would file another's key, which it
 * never reads, as removed.
 * - The question each source's run asks a curator about a place: a museum run
 *   on the Israel Museum would otherwise write its record without
 *   Archaeology's question, and a worship run would take the museum door's away.
 * - A monument's year and makers, which the place kinds write
 *   (`upsertLandmarkExperience`) and Art Museums, Places of worship and
 *   Archaeology never read: a worship run would otherwise propose removing
 *   Charminar's 1591 on every pass (#1879).
 */
const PLACE_FACTS = ['year', 'creators'] as const;
const SOURCE_OWN_METADATA: Readonly<Record<number, readonly string[]>> = {
  2: ['museumReadershipNote'],
  3: [...PLACE_FACTS, 'publicArtReadershipNote'],
  4: ['worshipReadershipNote'],
  5: ['admissionNote'],
  6: PLACE_FACTS,
  7: PLACE_FACTS,
  8: PLACE_FACTS,
  9: PLACE_FACTS,
};

/**
 * The keys of `SOURCE_OWN_METADATA` a source writes empty every pass, never
 * reading them: Towers, Bridges & engineering marvels and Squares & streets
 * write no makers (`placeLandmark`). Such a run keeps another source's value of
 * the key as the place holds it rather than writing its empty one over the
 * makers Monuments & memorials read, and a source that reads none keeps the
 * empty one, so neither asks about it.
 */
const WRITTEN_EMPTY_METADATA: Readonly<Record<number, readonly string[]>> = {
  7: ['creators'],
  8: ['creators'],
  9: ['creators'],
};

/** Whether the run of `sourceId` writes `key`, empty or not. */
const writesKey = (sourceId: number, key: string): boolean => (SOURCE_OWN_METADATA[sourceId] ?? []).includes(key);

/** Whether the run of `sourceId` writes `key` with a value of its own. */
const readsOwnKey = (sourceId: number, key: string): boolean =>
  writesKey(sourceId, key) && !(WRITTEN_EMPTY_METADATA[sourceId] ?? []).includes(key);

/**
 * The keys of `otherId` the run of `sourceId` keeps: those the other reads,
 * and those it writes empty where the run writes none of them. Two kinds that
 * both write makers empty keep neither's, so makers no standing source reads
 * leave the place on the next run of either.
 */
const keptKeysOf = (sourceId: number, otherId: number): string[] =>
  (SOURCE_OWN_METADATA[otherId] ?? [])
    .filter(key => !readsOwnKey(sourceId, key) && (readsOwnKey(otherId, key) || !writesKey(sourceId, key)));

/**
 * The fields of the place that another family's standing membership brings
 * and the run's own family does not, and the keys of another source of the
 * place that `keptKeysOf` keeps: those the run writes as the place holds them. On a place no other source holds, only the
 * fields another family alone writes (`KEPT_BY_EVERY_OTHER_FAMILY`, ADR-0138);
 * none for a source in no family.
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
 * sources with a standing membership on it: their families' fields, and the
 * keys of each one that `keptKeysOf` keeps. Split from the read so
 * the sequence of runs can be stated without a database.
 */
export function fieldsOfOthers(sourceId: number, otherSourceIds: readonly number[]): FamilyFields {
  const own = familyOf(sourceId);
  if (own === null) return { columns: [], metadata: [] };
  const others = new Set(otherSourceIds.map(familyOf).filter((f): f is SourceFamily => f !== null && f !== own));
  return {
    columns: [...others].flatMap(family => FAMILY_FIELDS[family].columns),
    metadata: [...new Set([
      ...[...others].flatMap(family => FAMILY_FIELDS[family].metadata),
      ...(Object.keys(KEPT_BY_EVERY_OTHER_FAMILY) as SourceFamily[])
        .filter(family => family !== own).flatMap(family => KEPT_BY_EVERY_OTHER_FAMILY[family]),
      ...otherSourceIds.filter(id => id !== sourceId).flatMap(id => keptKeysOf(sourceId, id)),
    ])],
  };
}

/** The part of a run's record the family fields are read from. */
export interface FamilyRecord {
  nameLocal: Record<string, string>;
  description: string | null;
  countryCodes: string[];
  countryNames: string[];
  metadata: Record<string, unknown>;
}

/** The stored columns `keptForFamilies` puts back, as the upsert's snapshot read them. */
export interface StoredFamilyFields {
  name_local: Record<string, string> | null;
  description: string | null;
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
    if (column === 'description') kept.description = stored.description;
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

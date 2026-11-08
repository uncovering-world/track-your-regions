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
 * the claims as before, and the fields of a source's view (`VIEW_FIELDS`)
 * follow the source views (`sourceView.ts`, ADR-0084).
 *
 * A kind's own field needs none of this: it lives on the kind's membership
 * (`kindFacts.ts`, ADR-0153), where no other run writes, and UNESCO's facts
 * about an inscription are one (#2068). What is left here are the place's
 * fields one family brings.
 */

import type { PoolClient } from 'pg';
import { MEMBERSHIPS, membershipAdmittedSql } from '../../db/membership.js';
import { viewStandsSql } from '../../db/sourceViews.js';
import { PUBLIC_ART_SOURCES } from './passes.js';

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
 * languages, its own text and the states party's codes. Wikidata's item, the place's own website, its fame and what
 * OpenStreetMap said about its outline. UNESCO's page about a site is its own key
 * (`unescoUrl`, #1538), and so is the run's mark of what it took from UNESCO's
 * dataset (`unesco`, ADR-0149). The country names both families write, but they name
 * UNESCO's codes, so they go with them (ADR-0111, #1553). The Wikipedia
 * article is no family's: each source's view of the place holds its own
 * (`VIEW_FIELDS`, #1975).
 */
export const FAMILY_FIELDS: Readonly<Record<SourceFamily, FamilyFields>> = {
  unesco: {
    columns: ['nameLocal', 'description', 'countryCodes', 'countryNames'],
    metadata: ['unescoUrl', 'unesco'],
  },
  wikidata: {
    columns: [],
    metadata: ['website', 'wikidataQid', 'sitelinksCount', 'osm'],
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
 * The place's fields only some sources write, by key, with the sources that
 * write it (ADR-0190): a run of any other source writes the field as the place
 * holds it while a writer's membership on the place stands and admits it, and as its own
 * record has it — absent — once none does, so a value no writer stands behind
 * goes to the gate as a removal. Whom or what a place commemorates is read by
 * Public art's and Monuments & memorials' runs alone (#2144), and every
 * Wikidata source is one family, so the rule is per source rather than per
 * family: a memorial church's Places of worship run, which never reads it,
 * would otherwise propose removing what Monuments & memorials' run wrote.
 * Towers, Bridges & engineering marvels and Squares & streets read nothing of
 * it either: their `named after` names the engineer or the patron, not whom
 * the place was raised to remember, and the Eiffel Tower does not commemorate
 * Gustave Eiffel, nor the Marco Polo Bridge (Lugou) Marco Polo.
 */
export const WRITTEN_BY_SOURCES: Readonly<Record<string, readonly number[]>> = {
  commemorates: PUBLIC_ART_SOURCES,
};

/** The keys of `WRITTEN_BY_SOURCES` the run of `sourceId` does not write and a writer of which admits the place. */
const keptFromSources = (sourceId: number, admittingSourceIds: readonly number[]): string[] => Object.entries(WRITTEN_BY_SOURCES)
  .filter(([, writers]) => !writers.includes(sourceId) && admittingSourceIds.some(other => writers.includes(other)))
  .map(([key]) => key);

/**
 * The fields of the place that another family's standing membership brings
 * and the run's own family does not: those the run writes as the place holds
 * them. On a place no other source holds, only the fields another family alone
 * writes (`KEPT_BY_EVERY_OTHER_FAMILY`, ADR-0138); none for a source in no
 * family.
 */
export async function otherFamiliesFields(
  query: Pick<PoolClient, 'query'>,
  placeId: number,
  sourceId: number,
): Promise<FamilyFields> {
  if (familyOf(sourceId) === null) return { columns: [], metadata: [] };
  // Whether the kind admits the place matters to the fields only some sources
  // write (ADR-0190): a refusal leaves the membership listed, and a refused
  // writer stands behind nothing it wrote.
  const result = await query.query<{ source_id: number; admitted: boolean }>(
    `SELECT m.source_id, bool_or(${membershipAdmittedSql('m')}) AS admitted FROM ${MEMBERSHIPS} m
      WHERE m.experience_id = $1 AND m.source_id <> $2 AND ${viewStandsSql('m')}
      GROUP BY m.source_id`,
    [placeId, sourceId],
  );
  return fieldsOfOthers(
    sourceId,
    result.rows.map(row => row.source_id),
    result.rows.filter(row => row.admitted).map(row => row.source_id),
  );
}

/**
 * What the run of `sourceId` writes as the place holds it, given the other
 * sources with a standing membership on it: their families' fields, and the
 * fields only some sources write where one of those admits the place
 * (`admittingSourceIds`, every standing one unless told otherwise). Split from
 * the read so the sequence of runs can be stated without a database.
 */
export function fieldsOfOthers(
  sourceId: number,
  otherSourceIds: readonly number[],
  admittingSourceIds: readonly number[] = otherSourceIds,
): FamilyFields {
  const own = familyOf(sourceId);
  if (own === null) return { columns: [], metadata: [] };
  const others = new Set(otherSourceIds.map(familyOf).filter((f): f is SourceFamily => f !== null && f !== own));
  return {
    columns: [...others].flatMap(family => FAMILY_FIELDS[family].columns),
    metadata: [...new Set([
      ...[...others].flatMap(family => FAMILY_FIELDS[family].metadata),
      ...(Object.keys(KEPT_BY_EVERY_OTHER_FAMILY) as SourceFamily[])
        .filter(family => family !== own).flatMap(family => KEPT_BY_EVERY_OTHER_FAMILY[family]),
      ...keptFromSources(sourceId, admittingSourceIds),
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

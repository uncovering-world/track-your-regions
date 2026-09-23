/**
 * The catalogue's reads, from the rows their queries answer to the shapes the
 * answers declare (`api/responses/experiences.ts`, ADR-0066).
 *
 * One mapper per kind of row, each writing the keys its schema names and
 * nothing else a query selects: a column the SELECT gains reaches a reader only
 * once the schema names it. Timestamps arrive as `Date`s and leave as the ISO
 * string `JSON.stringify` always made of them. The JSON a query builds arrives
 * parsed, in the shape its `json_build_object` gives it, which the answer's
 * parse holds.
 */

import type {
  Experience, ExperienceDetail, ExperienceRegionRef, ExperienceSearchResult, ExperienceTreasure, ImageCredit,
  LinkedPlace, SiteFind,
} from '../../api/responses/experiences.js';
import type { CheckValue } from '../../db/schema.generated.js';

type Membership = CheckValue<'experiences', 'source_membership'>;
type Existence = CheckValue<'experiences', 'existence'>;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * A picture's credit as `metadata.imageCredit` stores it, key by key: stored
 * JSON reaches a reader only through the keys its schema names, whatever a
 * writer once left beside them.
 */
function creditOf(credit: ImageCredit | null): ImageCredit | null {
  if (credit === null) return null;
  return {
    author: credit.author ?? null,
    license: credit.license ?? null,
    licenseUrl: credit.licenseUrl ?? null,
    detailsUrl: credit.detailsUrl ?? null,
  };
}

/** Where a find was dug up, as `metadata.foundAt` stores it, key by key. */
function foundAtOf(found: TreasureRow['found_at']): TreasureRow['found_at'] {
  return found === null ? null : { qid: found.qid, label: found.label };
}

/** A region list row, after `withDangerFields`. */
export interface ExperienceListRow {
  id: number;
  external_id: string;
  name: string;
  short_description: string | null;
  type: string | null;
  kind_id: number;
  kind_name: string;
  kind_priority: number;
  country_codes: string[] | null;
  country_names: string[] | null;
  image_url: string | null;
  image_credit: ImageCredit | null;
  created_at: Date | null;
  latitude: number;
  longitude: number;
  in_danger: boolean;
  danger_since: number | null;
  location_count: number;
  treasure_count: number;
  source_membership: Membership;
  existence: Existence;
  missing_since: Date | null;
  is_new: boolean;
  /** Selected only for a curator whose scope reaches the region. */
  is_rejected?: boolean;
  rejection_reason?: string | null;
}

export function experienceOf(row: ExperienceListRow): Experience {
  return {
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    short_description: row.short_description,
    type: row.type,
    kind_id: row.kind_id,
    country_codes: row.country_codes,
    country_names: row.country_names,
    image_url: row.image_url,
    image_credit: creditOf(row.image_credit),
    in_danger: row.in_danger,
    danger_since: row.danger_since,
    longitude: row.longitude,
    latitude: row.latitude,
    kind_name: row.kind_name,
    kind_priority: row.kind_priority,
    location_count: row.location_count,
    treasure_count: row.treasure_count,
    created_at: row.created_at?.toISOString(),
    is_rejected: row.is_rejected,
    rejection_reason: row.rejection_reason,
    source_membership: row.source_membership,
    existence: row.existence,
    missing_since: iso(row.missing_since),
    is_new: row.is_new,
  };
}

/** The object's own read, before its regions are added. */
export interface ExperienceDetailRow {
  id: number;
  source_id: number;
  external_id: string;
  name: string;
  name_local: Record<string, string> | null;
  description: string | null;
  short_description: string | null;
  type: string | null;
  country_codes: string[] | null;
  country_names: string[] | null;
  image_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | null;
  updated_at: Date | null;
  source_membership: Membership;
  existence: Existence;
  missing_since: Date | null;
  longitude: number;
  latitude: number;
  boundary_geojson: ExperienceDetail['boundary_geojson'];
  area_km2: number | null;
  kind_id: number;
  kind_name: string;
  kind_priority: number;
  source_name: string;
  source_description: string | null;
}

export function experienceDetailOf(row: ExperienceDetailRow, regions: ExperienceRegionRef[]): ExperienceDetail {
  return {
    id: row.id,
    source_id: row.source_id,
    external_id: row.external_id,
    name: row.name,
    name_local: row.name_local,
    description: row.description,
    short_description: row.short_description,
    type: row.type,
    country_codes: row.country_codes,
    country_names: row.country_names,
    image_url: row.image_url,
    metadata: row.metadata,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    source_membership: row.source_membership,
    existence: row.existence,
    missing_since: iso(row.missing_since),
    longitude: row.longitude,
    latitude: row.latitude,
    boundary_geojson: row.boundary_geojson,
    area_km2: row.area_km2,
    kind_id: row.kind_id,
    kind_name: row.kind_name,
    kind_priority: row.kind_priority,
    source_name: row.source_name,
    source_description: row.source_description,
    regions,
  };
}

/** One answer of the search, as its final SELECT lists it. */
export interface SearchRow {
  id: number;
  name: string;
  short_description: string | null;
  type: string | null;
  kind_id: number;
  kind_name: string;
  kind_priority: number;
  country_names: string[] | null;
  image_url: string | null;
  image_credit: ImageCredit | null;
  source_membership: Membership;
  existence: Existence;
  missing_since: Date | null;
  longitude: number;
  latitude: number;
  relevance: number;
  regions: ExperienceRegionRef[];
}

export function searchResultOf(row: SearchRow): ExperienceSearchResult {
  return {
    id: row.id,
    name: row.name,
    short_description: row.short_description,
    type: row.type,
    kind_id: row.kind_id,
    kind_name: row.kind_name,
    kind_priority: row.kind_priority,
    country_names: row.country_names,
    image_url: row.image_url,
    image_credit: creditOf(row.image_credit),
    source_membership: row.source_membership,
    existence: row.existence,
    missing_since: iso(row.missing_since),
    longitude: row.longitude,
    latitude: row.latitude,
    relevance: row.relevance,
    regions: row.regions,
  };
}

/** One work of an object, as the treasures read selects it. */
export interface TreasureRow {
  id: number;
  external_id: string;
  name: string;
  treasure_type: string;
  artists: string[];
  artists_curated: boolean;
  year: number | null;
  curated_fields: string[];
  venue_count: number;
  image_url: string | null;
  sitelinks_count: number;
  is_iconic: boolean;
  image_credit: ImageCredit | null;
  found_at: { qid: string; label: string } | null;
  found_at_site: LinkedPlace | null;
}

export function treasureOf(row: TreasureRow): ExperienceTreasure {
  return {
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    treasure_type: row.treasure_type,
    artists: row.artists,
    artists_curated: row.artists_curated,
    curated_fields: row.curated_fields,
    venue_count: row.venue_count,
    year: row.year,
    image_url: row.image_url,
    image_credit: creditOf(row.image_credit),
    is_iconic: row.is_iconic,
    found_at: foundAtOf(row.found_at),
    found_at_site: row.found_at_site,
    sitelinks_count: row.sitelinks_count,
  };
}

/** One find of a site, as the finds read selects it. */
export interface SiteFindRow {
  id: number;
  external_id: string;
  name: string;
  treasure_type: string;
  year: number | null;
  image_url: string | null;
  is_iconic: boolean;
  sitelinks_count: number;
  image_credit: ImageCredit | null;
  shown_at: LinkedPlace[];
}

export function siteFindOf(row: SiteFindRow): SiteFind {
  return {
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    treasure_type: row.treasure_type,
    year: row.year,
    image_url: row.image_url,
    image_credit: creditOf(row.image_credit),
    is_iconic: row.is_iconic,
    sitelinks_count: row.sitelinks_count,
    shown_at: row.shown_at,
  };
}

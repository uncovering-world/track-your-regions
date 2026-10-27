/**
 * The fields of a serial site's part that its component's item gives it: the
 * picture and its credit, the subtitle and the English article (ADR-0156
 * decision 3, #1426). They are the part row's own, as every place's are, and
 * this module is their one writer: the World Heritage run's content writer, a
 * curator's correction of the part's point, a confirmed or taken-back
 * component item and a published held proposal all write through it. The
 * component's Wikidata item and what the site's list says of the component
 * are the part's record in World Heritage components (ADR-0156 decision 2),
 * which this module writes too (`writePartItems`, `writePartListings`).
 *
 * Every write but the site's view names the part by its point and is refused
 * for a point the locked place does not show: a part is answered for under its
 * site's lock, or under its own where it holds a kind of its own
 * (`answeringPlaceSql`), and the writer takes either. A point whose place is no
 * part writes nothing here: its own content stays the point's
 * (`experienceLocationWriter.ts`). The site's view (`writePartListings`) names
 * a part by its record and writes only the records of the locked site's
 * parts.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from './experienceWriter.js';
import { COMPONENTS_KIND_ID, MEMBERSHIPS } from './membership.js';
import { pointOfPartSql, shownBySql } from './placePoints.js';

/** A field of a part this module writes, named as a place's claim and a held proposal name it. */
export type PartField = 'image_url' | 'metadata.imageCredit' | 'subtitle' | 'metadata.wikipediaUrl';

export const PART_FIELDS: ReadonlySet<string> = new Set<PartField>(
  ['image_url', 'metadata.imageCredit', 'subtitle', 'metadata.wikipediaUrl'],
);

export function isPartField(field: string): field is PartField {
  return PART_FIELDS.has(field);
}

/** One part's write: the fields to set (null clears) and the claims to add or take off. */
export interface PartWrite {
  pointId: number;
  fields: Partial<Record<PartField, unknown>>;
  addClaims?: readonly string[];
  dropClaims?: readonly string[];
}

/**
 * Write the fields of the parts the points name, under the lock of the site
 * that shows them. A field left out of `fields` is left as it is; a credit
 * belongs to one photograph, so a picture written without one drops the old
 * one's. Answers the points whose part was written.
 */
export async function writePartFields(
  client: PoolClient,
  lock: LockedExperience,
  writes: readonly PartWrite[],
): Promise<number[]> {
  const rows = writes
    .filter(write => Object.keys(write.fields).length > 0 || write.addClaims?.length || write.dropClaims?.length)
    .map(write => ({
      point_id: write.pointId,
      fields: Object.fromEntries(Object.entries(write.fields).map(([field, value]) => [field, value ?? null])),
      add_claims: write.addClaims ?? [],
      drop_claims: write.dropClaims ?? [],
    }));
  if (rows.length === 0) return [];
  const result = await client.query<{ point_id: number }>(
    `WITH w AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb)
                AS w(point_id int, fields jsonb, add_claims text[], drop_claims text[])
     )
     UPDATE experiences e
        SET image_url = CASE WHEN w.fields ? 'image_url' THEN w.fields ->> 'image_url' ELSE e.image_url END,
            subtitle = CASE WHEN w.fields ? 'subtitle' THEN w.fields ->> 'subtitle' ELSE e.subtitle END,
            metadata = (CASE WHEN w.fields ? 'metadata.imageCredit' THEN
                               CASE WHEN jsonb_typeof(w.fields -> 'metadata.imageCredit') = 'object'
                                    THEN COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object('imageCredit', w.fields -> 'metadata.imageCredit')
                                    ELSE COALESCE(e.metadata, '{}'::jsonb) - 'imageCredit' END
                             WHEN w.fields ? 'image_url' THEN COALESCE(e.metadata, '{}'::jsonb) - 'imageCredit'
                             ELSE COALESCE(e.metadata, '{}'::jsonb) END)
                       - CASE WHEN w.fields ? 'metadata.wikipediaUrl' THEN 'wikipediaUrl' ELSE '' END
                       || CASE WHEN jsonb_typeof(w.fields -> 'metadata.wikipediaUrl') = 'string'
                               THEN jsonb_build_object('wikipediaUrl', w.fields -> 'metadata.wikipediaUrl')
                               ELSE '{}'::jsonb END,
            curated_fields = (SELECT COALESCE(jsonb_agg(DISTINCT claim), '[]'::jsonb)
                                FROM (SELECT jsonb_array_elements_text(COALESCE(e.curated_fields, '[]'::jsonb)) AS claim
                                      UNION SELECT unnest(w.add_claims)) claims
                               WHERE claim <> ALL(w.drop_claims)),
            -- Stamped as every writer of the table stamps it (ADR-0069).
            updated_at = NOW()
       FROM w JOIN experience_locations el ON el.id = w.point_id
      WHERE e.id = el.experience_id
        AND ${pointOfPartSql('el')}
        AND ${shownBySql('el', 'ARRAY[$1::int]')}
      RETURNING w.point_id`,
    [lock.id, JSON.stringify(rows)],
  );
  return result.rows.map(row => row.point_id);
}

/** One part's item: the item (null takes it off) and what becomes of a curator's claim on it. */
export interface PartItemWrite {
  pointId: number;
  item: string | null;
  claim?: 'add' | 'drop';
}

/**
 * Write the component's Wikidata item on the record of the parts the points
 * name (`wikidata_items` of its World Heritage components membership), with a
 * curator's claim on it (`wikidata_items` in the record's `curated_fields`),
 * under the lock of the place that shows them. Answers the points whose
 * record was written; a point that is no part's has none.
 */
export async function writePartItems(
  client: PoolClient,
  lock: LockedExperience,
  writes: readonly PartItemWrite[],
): Promise<number[]> {
  if (writes.length === 0) return [];
  const rows = writes.map(write => ({ point_id: write.pointId, item: write.item, claim: write.claim ?? null }));
  const result = await client.query<{ point_id: number }>(
    `WITH w AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS w(point_id int, item text, claim text)
     )
     UPDATE ${MEMBERSHIPS} rec
        SET wikidata_items = CASE WHEN w.item IS NULL THEN NULL ELSE ARRAY[w.item] END,
            curated_fields = CASE w.claim
                               WHEN 'add' THEN CASE WHEN rec.curated_fields ? 'wikidata_items' THEN rec.curated_fields
                                                    ELSE rec.curated_fields || '["wikidata_items"]'::jsonb END
                               WHEN 'drop' THEN rec.curated_fields - 'wikidata_items'
                               ELSE rec.curated_fields END,
            updated_at = NOW()
       FROM w JOIN experience_locations el ON el.id = w.point_id
      WHERE rec.experience_id = el.experience_id AND rec.kind_id = ${COMPONENTS_KIND_ID}
        AND ${pointOfPartSql('el')}
        AND ${shownBySql('el', 'ARRAY[$1::int]')}
      RETURNING w.point_id`,
    [lock.id, JSON.stringify(rows)],
  );
  return result.rows.map(row => row.point_id);
}

/** What the site's list gives one component: its name and coordinate, for the record they are written on. */
export interface PartListing {
  recordId: number;
  name: string | null;
  lon: number;
  lat: number;
}

/**
 * The records of the site `$1`'s parts whose view the listings `listed` change,
 * as rows `(id, name, location)` of what each is to hold: the name and
 * coordinate of its listing, or none for a record no listing names.
 * `listed` is a relation of `(record_id, name, lon, lat)`. The one statement of
 * what the site's run changes on the records (`writePartListings`), and of
 * whether it has anything to change (the run's fast path, `locationWriter.ts`).
 */
export function partListingChangesSql(listed: string): string {
  return `SELECT rec.id, l.name,
                 CASE WHEN l.record_id IS NOT NULL THEN ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326) END AS location
            FROM experience_parts p
            JOIN ${MEMBERSHIPS} rec ON rec.experience_id = p.part_id AND rec.kind_id = ${COMPONENTS_KIND_ID}
                                   AND rec.external_id = 'component:' || p.id
            LEFT JOIN ${listed} l ON l.record_id = rec.id
           WHERE p.whole_id = $1 AND p.reason = 'component'
             AND (rec.reported_name IS DISTINCT FROM l.name
                  OR (rec.reported_location IS NULL) <> (l.record_id IS NULL)
                  OR NOT ST_Equals(rec.reported_location, ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326)))`;
}

/**
 * Write the site's source's view of each of its components on the part's
 * record in World Heritage components (`reported_name`, `reported_location`,
 * ADR-0156 decision 2), under the site's lock: the name and coordinate its
 * list gives the component, as the list gives them, whatever a curator made
 * of the part's point. The record of a component the list no longer gives
 * loses its view, since a source that stopped listing a component says nothing
 * of it (`viewStandsSql`). Only the records of the parts whose relation names
 * the locked site are written, so a part merged into another kind's place
 * keeps its view under its site's run. Answers how many records changed.
 */
export async function writePartListings(
  client: PoolClient,
  lock: LockedExperience,
  listings: readonly PartListing[],
): Promise<number> {
  const rows = listings.map(listing => ({ record_id: listing.recordId, name: listing.name, lon: listing.lon, lat: listing.lat }));
  const result = await client.query(
    `WITH listed AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS l(record_id int, name text, lon float8, lat float8)
     ),
     view AS (${partListingChangesSql('listed')})
     UPDATE ${MEMBERSHIPS} rec
        SET reported_name = view.name, reported_location = view.location, updated_at = NOW()
       FROM view
      WHERE rec.id = view.id`,
    [lock.id, JSON.stringify(rows)],
  );
  return result.rowCount ?? 0;
}

/**
 * The fields of a serial site's part that its component's item gives it: the
 * picture and its credit, the subtitle and the English article (ADR-0156
 * decision 3, #1426). They are the part row's own, as every place's are, and
 * this module is their one writer: the World Heritage run's content writer, a
 * curator's correction of the part's point, a confirmed or taken-back
 * component item and a published held proposal all write through it. So are
 * the part's name and coordinate and its record's reference, which the
 * writers of its point write here after their own write (`followTheirPoints`),
 * and a curator's name for the part (`writePartFields`). The
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
import {
  COMPONENT_SOURCE_ID, MEMBERSHIPS, WORLD_HERITAGE_SOURCE_ID, componentRecordSql, partRecordSql, placeHoldsKindSql,
  siteMembershipSql,
} from './membership.js';
import { pointOfPartSql, pointRecordSql, shownBySql } from './placePoints.js';
import { publishedContentSql } from './readerPredicates.js';

/** A field of a part this module writes, named as a place's claim and a held proposal name it. */
export type PartField = 'image_url' | 'metadata.imageCredit' | 'subtitle' | 'metadata.wikipediaUrl';

export const PART_FIELDS: ReadonlySet<string> = new Set<PartField>(
  ['image_url', 'metadata.imageCredit', 'subtitle', 'metadata.wikipediaUrl'],
);

export function isPartField(field: string): field is PartField {
  return PART_FIELDS.has(field);
}

/**
 * One part's write: the fields to set (null clears), a curator's name for the
 * part, and the claims to add or take off.
 */
export interface PartWrite {
  pointId: number;
  fields: Partial<Record<PartField, unknown>>;
  name?: string;
  addClaims?: readonly string[];
  dropClaims?: readonly string[];
}

/**
 * Write the fields of the parts the points name, under the lock of the site
 * that shows them. A field left out of `fields` is left as it is; a credit
 * belongs to one photograph, so a picture written without one drops the old
 * one's. A part named for its article is named anew once the article changes
 * (`followTheirPoints`). Answers the points whose part was written.
 */
export async function writePartFields(
  client: PoolClient,
  lock: LockedExperience,
  writes: readonly PartWrite[],
): Promise<number[]> {
  const rows = writes
    .filter(write => Object.keys(write.fields).length > 0 || write.name !== undefined
      || write.addClaims?.length || write.dropClaims?.length)
    .map(write => ({
      point_id: write.pointId,
      fields: {
        ...Object.fromEntries(Object.entries(write.fields).map(([field, value]) => [field, value ?? null])),
        ...(write.name === undefined ? {} : { name: write.name }),
      },
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
        SET name = COALESCE(w.fields ->> 'name', e.name),
            image_url = CASE WHEN w.fields ? 'image_url' THEN w.fields ->> 'image_url' ELSE e.image_url END,
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
  const written = result.rows.map(row => row.point_id);
  if (written.length > 0) await followTheirPoints(client, lock, written);
  return written;
}

/**
 * The parts whose point the filter `pointFilter` keeps, over `el`, as rows
 * `(part_id, name, location, external_ref, point_id)` of what each is to hold (ADR-0100,
 * ADR-0156): the name the part is called for its point (`component_part_name`:
 * the list's name; where that names nothing, the part's own English article,
 * then its site's name with the reference), unless a curator named the part
 * (`name` in its claims); its point's coordinate, since a place of one point
 * stands where its point does (ADR-0095); and its point's reference, for its
 * record. A part whose component moved holds the point it moved from beside
 * the one it moved to until the old one goes (#2182), and follows the one a
 * reader sees: a standing point before a withdrawn one, a published one
 * before an arrival waiting for a curator, then the older.
 * A part that holds a kind of its own names and places itself
 * (#1250), so it has no row. The point's name is the run's record of what the
 * list calls the component, behind the gate (ADR-0037), so a held rename
 * names the part only once it is published. The one statement of what
 * `followTheirPoints` writes and of whether the run's fast path has anything
 * to write (`locationWriter.ts`).
 */
export function partFollowsSql(pointFilter: string): string {
  return `SELECT part.id AS part_id,
                 CASE WHEN part.curated_fields ? 'name' THEN part.name
                      ELSE COALESCE(component_part_name(pt.name, part.metadata->>'wikipediaUrl', pt.external_ref,
                                      (SELECT whole.name FROM experience_parts wp JOIN experiences whole ON whole.id = wp.whole_id
                                        WHERE wp.part_id = part.id AND wp.reason = 'component'
                                        ORDER BY wp.whole_id LIMIT 1)),
                                    part.name) END AS name,
                 pt.location, pt.external_ref, pt.id AS point_id
            FROM (SELECT DISTINCT ON (el.experience_id) el.id, el.experience_id, el.name, el.location, el.external_ref
                    FROM experience_locations el
                   WHERE el.merged_into_id IS NULL AND ${pointOfPartSql('el')} AND ${pointFilter}
                   ORDER BY el.experience_id, el.missing_since IS NULL DESC,
                            ${publishedContentSql('el')} DESC, el.id) pt
            JOIN experiences part ON part.id = pt.experience_id
           WHERE NOT ${placeHoldsKindSql('part.id')}`;
}

/**
 * The part's record `record` takes the reference of the point a row of
 * `partFollowsSql` (`row`) names: the record in the whole whose list placed
 * the point, since a part of two sites carries each site's reference on that
 * site's record (ADR-0198), or every record of the part for a point no list
 * placed; and only a reference of a component's shape, since the record is
 * the list's view under the list's id.
 */
function recordOfPointSql(record: string, row: string): string {
  return `${partRecordSql(record)} AND ${record}.experience_id = ${row}.part_id
          AND source_id_fits_scheme('whc-component', ${row}.external_ref)
          AND (NOT EXISTS (SELECT 1 FROM experience_location_placements any_pl WHERE any_pl.location_id = ${row}.point_id)
               OR EXISTS (SELECT 1 FROM experience_location_placements own_pl
                            JOIN ${MEMBERSHIPS} own_site ON own_site.id = own_pl.membership_id
                           WHERE own_pl.location_id = ${row}.point_id AND ${siteMembershipSql('own_site', record)}))`;
}

/** The parts of the site `$1` that are not yet what their point makes them (`partFollowsSql`): the run's fast path asks it. */
export function partsBehindSql(): string {
  const ofSite = 'EXISTS (SELECT 1 FROM experience_parts sp WHERE sp.part_id = el.experience_id AND sp.whole_id = $1)';
  return `SELECT 1 FROM (${partFollowsSql(ofSite)}) f
            JOIN experiences part ON part.id = f.part_id
           WHERE part.name IS DISTINCT FROM f.name OR part.location IS DISTINCT FROM f.location
              OR EXISTS (SELECT 1 FROM ${MEMBERSHIPS} fr WHERE ${recordOfPointSql('fr', 'f')}
                           AND fr.external_id IS DISTINCT FROM f.external_ref)`;
}

/**
 * Write each part's name, coordinate and record's reference from its point
 * (`partFollowsSql`), under the lock of the place that shows the points: the
 * points `pointIds`, or every point of a part the place shows where it is
 * null. Each writer of what a part is named or placed for calls it after its
 * write: the site's run, a curator's correction of the point, an accepted
 * source coordinate, a published held name, a new article, a curator's edit of
 * a place and the undo of a merge. A site renamed another way renames a part
 * named by it at its next run, which reads the part as behind
 * (`partsBehindSql`).
 */
export async function followTheirPoints(
  client: PoolClient,
  lock: LockedExperience,
  pointIds: readonly number[] | null,
): Promise<void> {
  const filter = `${shownBySql('el', 'ARRAY[$1::int]')} AND ($2::int[] IS NULL OR el.id = ANY($2::int[]))`;
  await client.query(
    `WITH f AS (${partFollowsSql(filter)}),
     named AS (
       UPDATE experiences part
          SET name = f.name, location = f.location,
              -- Stamped as every writer of the table stamps it (ADR-0069).
              updated_at = NOW()
         FROM f
        WHERE part.id = f.part_id
          AND (part.name IS DISTINCT FROM f.name OR part.location IS DISTINCT FROM f.location)
     )
     UPDATE ${MEMBERSHIPS} rec SET external_id = f.external_ref, updated_at = NOW()
       FROM f
      WHERE ${recordOfPointSql('rec', 'f')} AND rec.external_id IS DISTINCT FROM f.external_ref`,
    [lock.id, pointIds],
  );
}

/**
 * The site `$1`'s own list line, as rows `(external_ref)`: the reference of
 * the point of its own the site shows, whose line no part holds (a site of one
 * component, or one that stands for the whole site, #1899), placed by the
 * site's World Heritage membership or by none, in a component's shape; the
 * point a reader sees first, standing before withdrawn and published before an
 * arrival. No row where the site shows no such point. The one statement of
 * which line the site's record of itself holds (ADR-0200).
 */
export function siteLineSql(): string {
  return `SELECT el.external_ref
            FROM experience_locations el
           WHERE el.experience_id = $1 AND el.merged_into_id IS NULL
             AND source_id_fits_scheme('whc-component', el.external_ref)
             AND (NOT EXISTS (SELECT 1 FROM experience_location_placements any_pl WHERE any_pl.location_id = el.id)
                  OR EXISTS (SELECT 1 FROM experience_location_placements own_pl
                               JOIN ${MEMBERSHIPS} own_site ON own_site.id = own_pl.membership_id
                              WHERE own_pl.location_id = el.id AND own_site.experience_id = $1
                                AND own_site.source_id = ${WORLD_HERITAGE_SOURCE_ID}))
           ORDER BY el.missing_since IS NULL DESC, ${publishedContentSql('el')} DESC, el.ordinal NULLS LAST, el.id
           LIMIT 1`;
}

/**
 * Whether the site's record of its own line `record` follows the site to the
 * line under `ref` (ADR-0200): the same component renumbered (`823bis-001` to
 * `823ter-001`, `whc_ref_bare`), which keeps its item; or another line, which
 * the record takes without the item, unless a curator chose that item. A
 * curator's item is never moved to another line nor taken off by a run: the
 * record stays on the line the curator answered for, and the line the site
 * shows instead has no record, and so no item, until the curator takes the
 * choice back.
 */
function siteLineMovesSql(record: string, ref: string): string {
  return `(whc_ref_bare(${record}.external_id) IS NOT DISTINCT FROM whc_ref_bare(${ref})
           OR NOT ${record}.curated_fields ? 'wikidata_items')`;
}

/** The site `$1`'s own line no record of itself holds yet, or one its record would follow: the run's fast path asks it. */
export function siteLineBehindSql(): string {
  return `SELECT 1 FROM (${siteLineSql()}) line
            LEFT JOIN ${MEMBERSHIPS} self ON self.source_id = ${COMPONENT_SOURCE_ID} AND self.whole_id = $1
                                         AND self.experience_id = $1
           WHERE self.id IS NULL
              OR (self.external_id IS DISTINCT FROM line.external_ref
                  AND ${siteLineMovesSql('self', 'line.external_ref')})`;
}

/**
 * Write the site's record of its own list line, under the site's lock
 * (ADR-0200): World Heritage components' record of the site in itself, under
 * the reference of the line the site shows (`siteLineSql`). It claims no part
 * (`refresh_part_relation`), and holds the line's view, position and item as
 * a part's record does. When the site shows another line, the record follows
 * it as `siteLineMovesSql` says. A site that shows no own line keeps the record
 * it has, with a curator's claim on its item, until a list of components parts
 * its line and the part takes the record (`part_site_components`).
 */
export async function followTheSiteLine(client: PoolClient, lock: LockedExperience): Promise<void> {
  await client.query(
    `INSERT INTO ${MEMBERSHIPS} AS rec (experience_id, whole_id, source_id, external_id)
     SELECT $1, $1, ${COMPONENT_SOURCE_ID}, line.external_ref FROM (${siteLineSql()}) line
     ON CONFLICT (source_id, whole_id, experience_id) DO UPDATE
        SET external_id = EXCLUDED.external_id,
            wikidata_items = CASE WHEN whc_ref_bare(rec.external_id) IS NOT DISTINCT FROM whc_ref_bare(EXCLUDED.external_id)
                                  THEN rec.wikidata_items END,
            updated_at = NOW()
      WHERE rec.external_id IS DISTINCT FROM EXCLUDED.external_id
        AND ${siteLineMovesSql('rec', 'EXCLUDED.external_id')}`,
    [lock.id],
  );
}

/** One part's item: the item (null takes it off) and what becomes of a curator's claim on it. */
export interface PartItemWrite {
  pointId: number;
  item: string | null;
  claim?: 'add' | 'drop';
}

/**
 * Write the component's Wikidata item on the record of the line each point
 * names (`wikidata_items` of the record the point reads, `pointRecordSql`: a
 * part's in its whole, a site's own in itself, ADR-0200), with a curator's
 * claim on it (`wikidata_items` in the record's `curated_fields`), under the
 * lock of the place that shows them. Answers the points whose record was
 * written; a point no record answers has none, and keeps no item.
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
      WHERE rec.id = ${pointRecordSql('el', 'own_rec', 'own_rec.id')}
        AND ${shownBySql('el', 'ARRAY[$1::int]')}
      RETURNING w.point_id`,
    [lock.id, JSON.stringify(rows)],
  );
  return result.rows.map(row => row.point_id);
}

/** What the site's list gives one line: its name, coordinate and position, for the record they are written on. */
export interface PartListing {
  recordId: number;
  name: string | null;
  lon: number;
  lat: number;
  ordinal: number;
}

/**
 * The records of the site `$1`'s list lines whose view the listings `listed`
 * change -- its parts' records in it and its record of itself (ADR-0200) --
 * as rows `(id, name, location, ordinal)` of what each is to hold: the name,
 * coordinate and position of its listing, or none for a record no listing
 * names, since a line the list no longer gives has no place in it. `listed`
 * is a relation of `(record_id, name, lon, lat, ordinal)`. The one statement of
 * what the site's run changes on the records (`writePartListings`), and of
 * whether it has anything to change (the run's fast path, `locationWriter.ts`).
 */
export function partListingChangesSql(listed: string): string {
  return `SELECT rec.id, l.name,
                 CASE WHEN l.record_id IS NOT NULL THEN ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326) END AS location,
                 l.ordinal
            FROM ${MEMBERSHIPS} rec
            LEFT JOIN ${listed} l ON l.record_id = rec.id
           WHERE rec.whole_id = $1 AND ${componentRecordSql('rec')}
             AND (rec.reported_name IS DISTINCT FROM l.name
                  OR rec.listing_ordinal IS DISTINCT FROM l.ordinal
                  OR (rec.reported_location IS NULL) <> (l.record_id IS NULL)
                  OR NOT ST_Equals(rec.reported_location, ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326)))`;
}

/**
 * Write the site's source's view of each of its list lines on the line's
 * record (`reported_name`, `reported_location`, `listing_ordinal`, ADR-0156
 * decision 2, ADR-0200), under the site's lock: the name, coordinate and
 * position its list gives the line, as the list gives them, whatever a curator
 * made of the point. The record of a component the list no longer gives
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
  const rows = listings.map(listing => (
    { record_id: listing.recordId, name: listing.name, lon: listing.lon, lat: listing.lat, ordinal: listing.ordinal }));
  const result = await client.query(
    `WITH listed AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS l(record_id int, name text, lon float8, lat float8, ordinal int)
     ),
     view AS (${partListingChangesSql('listed')})
     UPDATE ${MEMBERSHIPS} rec
        SET reported_name = view.name, reported_location = view.location, listing_ordinal = view.ordinal,
            updated_at = NOW()
       FROM view
      WHERE rec.id = view.id`,
    [lock.id, JSON.stringify(rows)],
  );
  return result.rowCount ?? 0;
}

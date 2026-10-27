/**
 * The fields of a serial site's part that its component's item gives it: the
 * picture and its credit, the subtitle and the English article (ADR-0156
 * decision 3, #1426). They are the part row's own, as every place's are, and
 * this module is their one writer: the World Heritage run's content writer, a
 * curator's correction of the part's point, a confirmed or taken-back
 * component item and a published held proposal all write through it.
 *
 * Every write names the part by its point and is refused for a point the
 * locked place does not show: a part is answered for under its site's lock, or
 * under its own where it holds a kind of its own (`answeringPlaceSql`), and the
 * writer takes either. A point whose place is no part writes nothing here: its
 * own content stays the point's (`experienceLocationWriter.ts`).
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from './experienceWriter.js';
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

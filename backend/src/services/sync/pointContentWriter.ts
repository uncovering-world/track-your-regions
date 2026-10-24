/**
 * A point's own picture, the picture's credit, its description (#1270) and its
 * English Wikipedia article (#1963).
 *
 * A component of a serial site showed its object's photograph, because a point
 * had nothing else: twelve pile dwellings on one lake, one picture between
 * them. Once the run has resolved a component to its Wikidata item (#1269), the
 * item's picture, its English description and its English article are the
 * point's own, written here
 * on the points the run answers for — after the location writer, so the points
 * exist, and in a transaction of its own under the object's lock.
 *
 * Through the gate as a field of a part (ADR-0037), narrowed by ADR-0089: on a
 * point a reader can already see, under a gated source, a value a reader sees
 * stands and the run records the change as held, for the curator's card to
 * publish; a field that held nothing is filled, since a reader sees nothing
 * there to protect — the site's own picture, said to be the site's. A field a
 * curator claimed (`image_url`, `description` in the point's `curated_fields`)
 * is never written, and the run reports the source's value beside it. The
 * article is the part's own (`metadata.wikipediaUrl`), never the site's: the
 * site keeps its own item's article (`factsForSite`). A hosted
 * picture carries a credit (ADR-0043): the credit the run fetched for the
 * picture, or one a point already holds for that same file, and none for a
 * file it has no credit for.
 */

import { jsonEquals } from '@tyr/shared/equality';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { publishedContentSql } from '../../db/readerPredicates.js';
import { isCommonsPictureUrl, isStorableHttpUrl } from '../../types/urlSafety.js';
import type { FieldChange } from './changeSet.js';
import { pointHeldProposalAt } from './heldProposalPointer.js';
import type { ImageCredit } from './imageCredit.js';
import type { LocationWriteRun } from './locationWriter.js';
import type { ContentItemChange } from './types.js';
import { partPlaceArticleSql, shownBySql } from '../../db/placePoints.js';

/** What the source offers one component: a picture, the credit fetched for it, a description and an article. */
export interface PointContent {
  ref: string;
  imageUrl: string | null;
  /** The credit fetched for `imageUrl` this run, or null where none was fetched. */
  imageCredit: ImageCredit | null;
  description: string | null;
  /** The item's English Wikipedia article (#1963), or null where it has none. */
  articleUrl: string | null;
}

/** Where a point keeps its article, as a place keeps its own (`metadata.wikipediaUrl`). */
const ARTICLE = 'metadata.wikipediaUrl';

/** One point the statement wrote or held, with both sides of what it compared. */
interface ContentRow {
  name: string | null;
  external_ref: string | null;
  curated_fields: string[] | null;
  old_image: string | null;
  old_credit: ImageCredit | null;
  old_description: string | null;
  new_image: string | null;
  new_credit: ImageCredit | null;
  new_description: string | null;
  old_article: string | null;
  new_article: string | null;
  held_image: boolean;
  held_credit: boolean;
  held_description: boolean;
  held_article: boolean;
}

/**
 * The fields of one row that differ, flagged the way the location writer flags
 * a name: claimed, or held by the gate, never both. The credit answers to the
 * picture's claim, as `accept-source` releases them together, and has an entry
 * of its own only where the picture's claim did not refuse the picture.
 */
function contentChanges(row: ContentRow): FieldChange[] {
  const claims = new Set(row.curated_fields ?? []);
  const changes: FieldChange[] = [];
  const add = (field: string, claim: string, old: unknown, next: unknown, held: boolean) => {
    if (jsonEquals(old ?? null, next ?? null)) return;
    const claimed = claims.has(claim);
    changes.push({ field, old: old ?? null, new: next ?? null, significance: 'minor', curatedConflict: claimed, held: !claimed && held });
  };
  add('image_url', 'image_url', row.old_image, row.new_image, row.held_image);
  if (!claims.has('image_url')) add('metadata.imageCredit', 'image_url', row.old_credit, row.new_credit, row.held_credit);
  add('description', 'description', row.old_description, row.new_description, row.held_description);
  add(ARTICLE, ARTICLE, row.old_article, row.new_article, row.held_article);
  return changes;
}

/**
 * Write each component's picture, credit and description on the points this run
 * answers for, matched by reference (case folded). Answers what it changed or
 * held, in the run's contents record's vocabulary, for the run to report with
 * the points it wrote.
 */
export async function writePointContents(
  experienceId: number,
  contents: readonly PointContent[],
  run: LocationWriteRun,
): Promise<ContentItemChange[]> {
  if (contents.length === 0) return [];
  // A picture the run may not write is no picture (ADR-0043), and a credit
  // beside it would name the author of a frame that holds nothing.
  // An article is a link a reader follows, so only a web address is one.
  const offered = contents.map(one => ({
    ...(one.imageUrl && isCommonsPictureUrl(one.imageUrl) ? one : { ...one, imageUrl: null, imageCredit: null }),
    articleUrl: one.articleUrl && isStorableHttpUrl(one.articleUrl) ? one.articleUrl : null,
  }));
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    await lockExperience(client, experienceId);
    const written = await client.query<ContentRow>(
      `WITH incoming AS (
         SELECT * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $7::text[])
                    AS i(ref, image_url, credit, description, article)
       ),
       -- The credit a point already holds for each offered file. A credit is
       -- the file's, not the point's, and the run asks Commons only about files
       -- no point holds a credit for (componentPicturesToCredit), so a second
       -- point receiving a credited file takes the credit from here.
       credited AS (
         SELECT DISTINCT ON (holder.image_url) holder.image_url, holder.metadata -> 'imageCredit' AS credit
           FROM experience_locations holder
          WHERE holder.image_url IN (SELECT image_url FROM incoming) AND holder.metadata ? 'imageCredit'
            AND jsonb_typeof(holder.metadata -> 'imageCredit') = 'object'
          ORDER BY holder.image_url, holder.id
       ),
       offered AS (
         SELECT el.id, el.name, el.external_ref, el.curated_fields,
                el.image_url AS old_image, el.metadata -> 'imageCredit' AS old_credit, el.description AS old_description,
                i.image_url AS new_image,
                -- The credit fetched for this file, else one a point holds for
                -- the same file: never a credit of another photograph.
                CASE WHEN i.image_url IS NULL THEN NULL
                     WHEN i.credit IS NOT NULL THEN i.credit::jsonb
                     ELSE (SELECT c.credit FROM credited c WHERE c.image_url = i.image_url)
                END AS new_credit,
                i.description AS new_description,
                el.metadata ->> 'wikipediaUrl' AS old_article, i.article AS new_article,
                -- What a reader is shown before the write and would be after it:
                -- the point's own, else its part place's (pointArticleSql).
                COALESCE(NULLIF(el.metadata ->> 'wikipediaUrl', ''), ${partPlaceArticleSql('el')}) AS seen_article,
                COALESCE(i.article, ${partPlaceArticleSql('el')}) AS shown_article,
                ((SELECT requires_curation FROM experience_sources WHERE id = $6)
                 AND ${publishedContentSql('el')}) AS gated_visible
           FROM experience_locations el
           JOIN incoming i ON lower(el.external_ref) = lower(i.ref)
          WHERE ${shownBySql('el', 'ARRAY[$1::int]')} AND el.missing_since IS NULL AND el.merged_into_id IS NULL
            -- A point whose item a curator chose (#1272) shows what that item
            -- gives it, written when it was chosen: the run's contents are read
            -- off the items its index resolves, which never include that one,
            -- and would take the picture away as a reference that resolved to
            -- nothing.
            AND NOT (el.curated_fields ? 'wikidata_item')
            AND (EXISTS (SELECT 1 FROM experience_location_placements mine
                           JOIN ${MEMBERSHIPS} m ON m.id = mine.membership_id
                          WHERE mine.location_id = el.id AND m.experience_id = $1 AND m.source_id = $6)
                 OR NOT EXISTS (SELECT 1 FROM experience_location_placements any_placement
                                 WHERE any_placement.location_id = el.id))
       ),
       -- Held per field, and only a value a reader sees (ADR-0089): a field
       -- that held nothing is filled. The credit goes with the picture where
       -- the picture changes, and on its own where only the credit does.
       target AS (
         SELECT o.*,
                (o.gated_visible AND o.old_image IS NOT NULL) AS held_image,
                (o.gated_visible AND CASE WHEN o.old_image IS DISTINCT FROM o.new_image THEN o.old_image IS NOT NULL
                                          ELSE o.old_credit IS NOT NULL END) AS held_credit,
                (o.gated_visible AND o.old_description IS NOT NULL) AS held_description,
                -- Held where a reader is shown an article and the write would change it.
                (o.gated_visible AND o.seen_article IS NOT NULL AND o.shown_article IS DISTINCT FROM o.seen_article) AS held_article
           FROM offered o
          WHERE o.old_image IS DISTINCT FROM o.new_image
             OR o.old_credit IS DISTINCT FROM o.new_credit
             OR o.old_description IS DISTINCT FROM o.new_description
             OR o.old_article IS DISTINCT FROM o.new_article
       ),
       -- The metadata with the credit decided, then the article on top of it.
       credit_written AS (
         SELECT t.*,
                CASE WHEN el.curated_fields ? 'image_url' OR t.held_credit THEN el.metadata
                     WHEN t.new_credit IS NULL THEN el.metadata - 'imageCredit'
                     ELSE el.metadata || jsonb_build_object('imageCredit', t.new_credit) END AS with_credit
           FROM target t JOIN experience_locations el ON el.id = t.id
       )
       UPDATE experience_locations el
          SET image_url = CASE WHEN el.curated_fields ? 'image_url' OR t.held_image THEN el.image_url ELSE t.new_image END,
              metadata = CASE WHEN el.curated_fields ? '${ARTICLE}' OR t.held_article THEN t.with_credit
                              WHEN t.new_article IS NULL THEN t.with_credit - 'wikipediaUrl'
                              ELSE t.with_credit || jsonb_build_object('wikipediaUrl', t.new_article) END,
              description = CASE WHEN el.curated_fields ? 'description' OR t.held_description THEN el.description
                                 ELSE t.new_description END
         FROM credit_written t
        WHERE el.id = t.id
       RETURNING t.name, t.external_ref, t.curated_fields, t.old_image, t.old_credit, t.old_description,
                 t.new_image, t.new_credit, t.new_description, t.seen_article AS old_article, t.shown_article AS new_article,
                 t.held_image, t.held_credit, t.held_description, t.held_article`,
      [
        experienceId,
        offered.map(one => one.ref),
        offered.map(one => one.imageUrl),
        offered.map(one => (one.imageCredit ? JSON.stringify(one.imageCredit) : null)),
        offered.map(one => one.description),
        run.sourceId,
        offered.map(one => one.articleUrl),
      ],
    );
    const changed = written.rows
      .map(row => ({ item: { name: row.name, ref: row.external_ref }, fields: contentChanges(row) }))
      .filter(entry => entry.fields.length > 0);
    // A held field is a proposal the card finds through the object's pointer
    // (ADR-0037), set in the same transaction as the hold.
    if (changed.some(entry => entry.fields.some(field => field.held))) {
      await pointHeldProposalAt(client, experienceId, run.syncLogId);
    }
    await client.query('COMMIT');
    return changed;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

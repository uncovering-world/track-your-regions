/**
 * A serial site's part's own picture, the picture's credit, its subtitle
 * (#1270) and its English Wikipedia article (#1963).
 *
 * A component of a serial site showed its object's photograph, because a point
 * had nothing else: twelve pile dwellings on one lake, one picture between
 * them. Once the run has resolved a component to its Wikidata item (#1269), the
 * item's picture, its English description and its English article are the
 * part's own, written here on the part row (ADR-0156 decision 3) for the
 * points the run answers for — after the location writer, so the points exist
 * and are parted, and in a transaction of its own under the object's lock. The
 * item's English description is the one line under a name, which a place keeps
 * as its subtitle (#1795). A point that is no part — a site of one component, a
 * component standing for the whole site — is given nothing: the site shows its
 * own.
 *
 * Through the gate as a field of a part (ADR-0037), narrowed by ADR-0089: on a
 * point a reader can already see, under a gated source, a value a reader sees
 * stands and the run records the change as held, for the curator's card on the
 * site to publish; a field that held nothing is filled, since a reader sees
 * nothing there to protect — the site's own picture, said to be the site's. A
 * field a curator claimed on the part (`image_url`, `subtitle`,
 * `metadata.wikipediaUrl`) is never written, and the run reports the source's
 * value beside it. A part that holds a kind of its own keeps what its kind
 * brought, and is only filled where it holds nothing. The article is the
 * part's own, never the site's: the site keeps its own item's article
 * (`factsForSite`). A hosted picture carries a credit (ADR-0043): the credit
 * the run fetched for the picture, or one a place already holds for that same
 * file, and none for a file it has no credit for.
 */

import { jsonEquals } from '@tyr/shared/equality';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS, placeHoldsRealKindSql } from '../../db/membership.js';
import { writePartFields, type PartField, type PartWrite } from '../../db/partFieldsWriter.js';
import { publishedContentSql } from '../../db/readerPredicates.js';
import { isCommonsPictureUrl, isStorableHttpUrl } from '../../types/urlSafety.js';
import type { FieldChange } from './changeSet.js';
import { pointHeldProposalAt } from './heldProposalPointer.js';
import type { ImageCredit } from './imageCredit.js';
import type { LocationWriteRun } from './locationWriter.js';
import type { ContentItemChange } from './types.js';
import { pointOfPartSql, shownBySql } from '../../db/placePoints.js';

/** What the source offers one component: a picture, the credit fetched for it, a subtitle and an article. */
export interface PointContent {
  ref: string;
  imageUrl: string | null;
  /** The credit fetched for `imageUrl` this run, or null where none was fetched. */
  imageCredit: ImageCredit | null;
  /** The item's English description, the line under a place's name. */
  subtitle: string | null;
  /** The item's English Wikipedia article (#1963), or null where it has none. */
  articleUrl: string | null;
}

/** One part the statement compared, with both sides of what it compared. */
interface ContentRow {
  point_id: number;
  name: string | null;
  external_ref: string | null;
  claims: string[] | null;
  kinded: boolean;
  gated_visible: boolean;
  old_image: string | null;
  old_credit: ImageCredit | null;
  old_subtitle: string | null;
  old_article: string | null;
  new_image: string | null;
  new_credit: ImageCredit | null;
  new_subtitle: string | null;
  new_article: string | null;
}

/** The claim a field answers to: the credit is the picture's, as `accept-source` releases them together. */
const CLAIM: Record<PartField, string> = {
  image_url: 'image_url',
  'metadata.imageCredit': 'image_url',
  subtitle: 'subtitle',
  'metadata.wikipediaUrl': 'metadata.wikipediaUrl',
};

/**
 * What the run does with each field of one part: the changes it records, flagged
 * the way the location writer flags a name — claimed, or held by the gate,
 * never both — and the values it writes. A field a reader sees is held under a
 * gate; the credit goes with the picture where the picture changes, and on its
 * own where only the credit does. A part that holds a kind of its own is only
 * filled.
 */
function decide(row: ContentRow): { changes: FieldChange[]; write: PartWrite['fields'] } {
  const claims = new Set(row.claims ?? []);
  const changes: FieldChange[] = [];
  const write: PartWrite['fields'] = {};
  const imageChanges = !jsonEquals(row.old_image ?? null, row.new_image ?? null);
  const consider = (field: PartField, old: unknown, next: unknown, shown: boolean) => {
    if (jsonEquals(old ?? null, next ?? null)) return;
    // A part's kind brought this value; the component only fills a gap.
    if (row.kinded && old != null) return;
    const claimed = claims.has(CLAIM[field]);
    const held = !claimed && row.gated_visible && shown;
    changes.push({ field, old: old ?? null, new: next ?? null, significance: 'minor', curatedConflict: claimed, held });
    if (!claimed && !held) write[field] = next ?? null;
  };
  consider('image_url', row.old_image, row.new_image, row.old_image != null);
  // A credit is its photograph's: where the part keeps its kind's picture, the
  // new picture's credit has nowhere to go.
  const keepsKindsPicture = row.kinded && imageChanges && row.old_image != null;
  if (!claims.has('image_url') && !keepsKindsPicture) {
    consider('metadata.imageCredit', row.old_credit, row.new_credit,
      imageChanges ? row.old_image != null : row.old_credit != null);
  }
  consider('subtitle', row.old_subtitle, row.new_subtitle, row.old_subtitle != null);
  consider('metadata.wikipediaUrl', row.old_article, row.new_article, row.old_article != null);
  return { changes, write };
}

/**
 * Write each component's picture, credit, subtitle and article on the parts
 * this run answers for, matched by reference (case folded). Answers what it
 * changed or held, in the run's contents record's vocabulary, for the run to
 * report with the points it wrote.
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
    const locked = await lockExperience(client, experienceId);
    if (!locked) {
      await client.query('ROLLBACK');
      return [];
    }
    const compared = await client.query<ContentRow>(
      `WITH incoming AS (
         SELECT * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $7::text[])
                    AS i(ref, image_url, credit, subtitle, article)
       ),
       -- The credit a place already holds for each offered file. A credit is
       -- the file's, not the place's, and the run asks Commons only about files
       -- no place holds a credit for (componentPicturesToCredit), so a second
       -- part receiving a credited file takes the credit from here.
       credited AS (
         SELECT DISTINCT ON (holder.image_url) holder.image_url, holder.metadata -> 'imageCredit' AS credit
           FROM experiences holder
          WHERE holder.image_url IN (SELECT image_url FROM incoming) AND holder.metadata ? 'imageCredit'
            AND jsonb_typeof(holder.metadata -> 'imageCredit') = 'object'
          ORDER BY holder.image_url, holder.id
       )
       SELECT el.id AS point_id, el.name, el.external_ref, part.curated_fields AS claims,
              ${placeHoldsRealKindSql('part.id')} AS kinded,
              ((SELECT requires_curation FROM experience_sources WHERE id = $6)
               AND ${publishedContentSql('el')}) AS gated_visible,
              NULLIF(part.image_url, '') AS old_image,
              CASE WHEN jsonb_typeof(part.metadata -> 'imageCredit') = 'object' THEN part.metadata -> 'imageCredit' END AS old_credit,
              NULLIF(part.subtitle, '') AS old_subtitle,
              NULLIF(part.metadata ->> 'wikipediaUrl', '') AS old_article,
              i.image_url AS new_image,
              -- The credit fetched for this file, else one a place holds for
              -- the same file: never a credit of another photograph.
              CASE WHEN i.image_url IS NULL THEN NULL
                   WHEN i.credit IS NOT NULL THEN i.credit::jsonb
                   ELSE (SELECT c.credit FROM credited c WHERE c.image_url = i.image_url)
              END AS new_credit,
              i.subtitle AS new_subtitle, i.article AS new_article
         FROM experience_locations el
         JOIN incoming i ON lower(el.external_ref) = lower(i.ref)
         JOIN experiences part ON part.id = el.experience_id
        WHERE ${shownBySql('el', 'ARRAY[$1::int]')} AND el.missing_since IS NULL AND el.merged_into_id IS NULL
          AND ${pointOfPartSql('el')}
          -- A point whose item a curator chose (#1272) shows what that item
          -- gives its part, written when it was chosen: the run's contents are
          -- read off the items its index resolves, which never include that
          -- one, and would take the picture away as a reference that resolved
          -- to nothing.
          AND NOT (el.curated_fields ? 'wikidata_item')
          AND (EXISTS (SELECT 1 FROM experience_location_placements mine
                         JOIN ${MEMBERSHIPS} m ON m.id = mine.membership_id
                        WHERE mine.location_id = el.id AND m.experience_id = $1 AND m.source_id = $6)
               OR NOT EXISTS (SELECT 1 FROM experience_location_placements any_placement
                               WHERE any_placement.location_id = el.id))`,
      [
        experienceId,
        offered.map(one => one.ref),
        offered.map(one => one.imageUrl),
        offered.map(one => (one.imageCredit ? JSON.stringify(one.imageCredit) : null)),
        offered.map(one => one.subtitle),
        run.sourceId,
        offered.map(one => one.articleUrl),
      ],
    );
    const decided = compared.rows.map(row => ({ row, ...decide(row) }));
    await writePartFields(client, locked.lock, decided.map(({ row, write }) => ({ pointId: row.point_id, fields: write })));
    const changed = decided
      .map(({ row, changes }) => ({ item: { name: row.name, ref: row.external_ref }, fields: changes }))
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

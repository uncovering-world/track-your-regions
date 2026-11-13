/**
 * Experience Treasure Controller
 *
 * Treasure (artwork) browsing and viewed-treasure tracking.
 */

import type { z } from 'zod/v4';
import type { ExperienceTreasuresResponse } from '../../api/responses/experiences.js';
import type { TreasureViewMarked, TreasureViewUnmarked, ViewedTreasureIds } from '../../api/responses/visited.js';
import { pool } from '../../db/index.js';
import type { TreasuresRow, UserViewedTreasuresRow } from '../../db/schema.generated.js';
import { MEMBERSHIPS, linkKindsSql, membershipOfferedSql, rowKindJoinSql } from '../../db/membership.js';
import {
  experienceOfferedToReaderSql,
  hideLostSql,
  readableByIdSql,
  linkedForReaderSql,
  offeredLinkSql,
  publishedContentSql,
  venueCountSql,
  venuesSql,
} from '../../db/readerPredicates.js';
import { treasureOf, type TreasureRow } from './experienceAnswerRows.js';
import { maySeeUnreadExperience } from './experienceScope.js';
import { readerRegionsJsonSql } from './readerRegions.js';
import { notFound } from '../../middleware/errorHandler.js';
import type {
  idParamSchema, markTreasureViewedBodySchema, treasureIdParamSchema, viewedTreasureIdsQuerySchema,
} from '../../types/index.js';
import { placeAtWriteSql } from '../../db/visits.js';

/**
 * Get contents (treasures) for an experience
 * GET /api/experiences/:id/treasures
 *
 * optionalAuth: one of the three by-id reads ADR-0025 relaxes the pending gate
 * for (see `maySeeUnreadExperience`), so a curator or admin reaching a gated
 * museum's page from the queue also sees its unread treasures and links,
 * rather than a container that opened onto an empty list.
 */
export async function getExperienceTreasures(
  { params: { id: experienceId }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User | undefined },
): Promise<ExperienceTreasuresResponse> {
  const maySeeUnread = await maySeeUnreadExperience(caller?.id, caller?.role, experienceId);

  const result = await pool.query<TreasureRow>(`
    SELECT
      t.id, t.external_id, t.name, t.treasure_type, t.artists,
      -- Whether anyone has vouched for the order the makers are stored in. The
      -- stored order is a query planner's, not the source's (ADR-0040), so a row
      -- leads with a name only where a curator claimed the column.
      t.curated_fields ? 'artists' AS artists_curated, t.year,
      -- And the whole set beside it, for the curator's half of the same row: a
      -- title or a year a curator corrected reads as the source's unless the row
      -- says otherwise, and the correction is offered from this list (#731).
      -- Read, never derived — the claim is a fact on the row.
      t.curated_fields,
      -- Every museum this work hangs in, since a correction made from one is
      -- the row all of them carry (ADR-0025 decision 2). What it counts is where
      -- the work hangs rather than who can see it today; venueCountSql says why.
      ${venueCountSql('t')} AS venue_count,
      -- And which they are, for the caller this read widens its gate for: the
      -- list names venues whatever their state, which the dialog that corrects
      -- the work needs and a reader must not be served (venuesSql).
      CASE WHEN $2::boolean THEN ${venuesSql('t')} END AS venues,
      t.image_url, t.sitelinks_count, t.is_iconic,
      -- The English article a works run read (#1608), and whether one has asked.
      t.wikipedia_url, t.wikipedia_read_at IS NOT NULL AS wikipedia_read,
      -- The kinds that hold the work here, so a place in several lists each
      -- work once and marks it with its kinds (#1263).
      ${linkKindsSql('et')} AS kind_ids,
      -- Beside the picture, as it is on the object itself: these files are
      -- served from Wikimedia Commons and a share of them are CC BY or CC BY-SA,
      -- which of a screen that shows a picture ask one thing -- that whoever
      -- took it is named wherever it appears. A list of works is showing them.
      t.metadata->'imageCredit' AS image_credit,
      -- Where the object was dug up, for the kind whose works are finds: an
      -- archaeology museum's holdings are things taken from somewhere, and
      -- that somewhere is half of what the object is (ADR-0058). The Rosetta
      -- Stone is a British Museum object and a Fort Julien one -- the fort at
      -- Rashid the run stores from its discovery place -- and a row naming
      -- only the museum tells a traveller the smaller half. Null on every
      -- work no run wrote it for — a painting has a maker, not a find spot.
      t.metadata->'foundAt' AS found_at,
      -- And the site row that spot names, where the catalogue holds one, so
      -- "found at Mycenae" is a way to Mycenae rather than a name (#894): the
      -- Archaeology site with that Wikidata id, if a reader may open it, with
      -- the regions that name it to a reader — the list a link is built from
      -- (readerRegions.ts). Null where the spot is a city, a region, or a
      -- place no site door has written, and the row keeps the words.
      (SELECT json_build_object(
                'id', site.id, 'name', site.name, 'kind_id', sk.id,
                'regions', ${readerRegionsJsonSql('site.id')})
         FROM experiences site
         ${rowKindJoinSql('site', 'sm', 'sk')}
        -- The Archaeology membership's type and id (ADR-0084).
        WHERE EXISTS (SELECT 1 FROM ${MEMBERSHIPS} site_member
                       WHERE site_member.experience_id = site.id
                         AND site_member.type = 'site'
                         AND site_member.external_id = t.metadata->'foundAt'->>'qid'
                         AND ${membershipOfferedSql('site_member')})
          AND ${experienceOfferedToReaderSql('site')}
          AND ${hideLostSql('site')}
        ORDER BY site.id
        LIMIT 1) AS found_at_site,
      -- The site a curator confirmed the work comes from, where its item names
      -- no place of discovery (#2242): the Dendera zodiac's row in the Louvre
      -- reads "from the Dendera Temple complex". Gated as the spot's site is,
      -- since it is the same way out of a museum's list.
      (SELECT json_build_object(
                'id', site.id, 'name', site.name, 'kind_id', sk.id,
                'regions', ${readerRegionsJsonSql('site.id')})
         FROM find_site_links fsl
         JOIN experiences site ON site.id = fsl.site_id
         ${rowKindJoinSql('site', 'sm', 'sk')}
        WHERE fsl.treasure_id = t.id AND fsl.state = 'confirmed'
          -- Only where the item names no find spot: one a later run reads
          -- off the item is the row's own claim, and the link stands behind it.
          AND t.metadata->'foundAt' IS NULL
          AND ${experienceOfferedToReaderSql('site')}
          AND ${hideLostSql('site')}
        ORDER BY site.id
        LIMIT 1) AS from_site
    FROM treasures t
    JOIN experience_treasures et ON t.id = et.treasure_id
    JOIN experiences e ON e.id = et.experience_id
    WHERE et.experience_id = $1
      -- The contents follow the container: a refused museum's works are not on
      -- offer either, and answering with them would put back on screen exactly
      -- what hiding the museum took off it (ADR-0024).
      -- Three predicates, not one: ADR-0025 gates the experience, the link and
      -- the treasure separately, because a published museum can hold newly
      -- written, unread paintings the container gate never reaches. All three
      -- widen on the same boolean, so a curator let past one is let past all;
      -- a reader is served the container only where a membership offers it
      -- (#1275).
      AND ${readableByIdSql('$2::boolean')}
      AND ($2::boolean OR ${publishedContentSql('et')})
      AND ($2::boolean OR ${publishedContentSql('t')})
      -- Not widened with them: a link the source stopped placing here is not
      -- an unread row a curator is being asked about, it is a work the run
      -- found elsewhere or nowhere (ADR-0044), and a curator's list showing it
      -- would put back on screen what the run took off.
      AND ${offeredLinkSql('et')}
    ORDER BY t.sitelinks_count DESC
  `, [experienceId, maySeeUnread]);

  return {
    experienceId,
    treasures: result.rows.map(treasureOf),
    total: result.rows.length,
  };
}

/**
 * Get viewed treasure IDs for current user
 * GET /api/users/me/viewed-treasures/ids
 */
export async function getViewedTreasureIds(
  { query: q, caller }: { query: z.output<typeof viewedTreasureIdsQuerySchema>; caller: Express.User },
): Promise<ViewedTreasureIds> {
  const userId = caller.id;
  const experienceId = q.experienceId ?? null;

  let query = `
    SELECT uvt.treasure_id
    FROM user_viewed_treasures uvt
  `;

  const params: number[] = [userId];

  if (experienceId) {
    // The record itself is never touched, and stays reachable through the
    // unscoped form below; it is only not *offered* on a work the source no
    // longer places here, exactly as a visit is not offered on a withdrawn point
    // (ADR-0022 decision 4, ADR-0044).
    query += `
      JOIN experience_treasures et ON uvt.treasure_id = et.treasure_id
      WHERE uvt.user_id = $1 AND et.experience_id = $2
        AND ${offeredLinkSql('et')}
    `;
    params.push(experienceId);
  } else {
    query += ' WHERE uvt.user_id = $1';
  }

  const result = await pool.query<Pick<UserViewedTreasuresRow, 'treasure_id'>>(query, params);

  return {
    viewedTreasureIds: result.rows.map(r => r.treasure_id),
  };
}

/**
 * Mark a treasure as viewed
 * POST /api/users/me/viewed-treasures/:treasureId
 * Body: { experienceId } — needed to auto-mark the venue as visited (treasure can be in multiple venues).
 * Also auto-marks the parent experience as visited.
 */
export async function markTreasureViewed(
  { params: { treasureId }, body, caller }: {
    params: z.output<typeof treasureIdParamSchema>;
    body: z.output<typeof markTreasureViewedBodySchema>;
    caller: Express.User;
  },
): Promise<TreasureViewMarked> {
  const userId = caller.id;

  // Verify the treasure exists *and* is one a read could have shown this
  // caller. Gated on its own curation_state (ADR-0025): without this, any
  // authenticated caller could POST a guessed id for a `pending` work, get its
  // name echoed back below, and have written a `user_viewed_treasures` row for
  // something no read ever offered them (#520's reasoning, unchanged from
  // location to treasure).
  const treasureResult = await pool.query<Pick<TreasuresRow, 'id' | 'name'>>(
    `SELECT t.id, t.name FROM treasures t WHERE t.id = $1 AND ${publishedContentSql('t')}`,
    [treasureId],
  );

  if (treasureResult.rows.length === 0) throw notFound('Treasure not found');

  const treasure = treasureResult.rows[0];

  // Insert viewed record
  await pool.query(`
    INSERT INTO user_viewed_treasures (user_id, treasure_id, viewed_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, treasure_id) DO NOTHING
  `, [userId, treasureId]);

  // If experienceId provided, auto-mark that venue as visited
  const experienceId = body.experienceId ?? null;
  let experienceName: string | null = null;

  if (experienceId) {
    // Verify the treasure is linked to this experience, and that neither the
    // container nor the link itself is unread: without them, a
    // caller who could see this treasure (checked above) but not this
    // particular museum, or not this particular link, would auto-mark a
    // `pending` experience visited through the auto-mark's `INSERT INTO
    // user_visited_experiences` below and have its name echoed back by the
    // `experienceName` lookup after it, which this join never scoped to what
    // the caller may see.
    const linkResult = await pool.query(
      `SELECT 1 FROM experience_treasures et
         JOIN experiences e ON e.id = et.experience_id
        WHERE et.experience_id = $1 AND et.treasure_id = $2
          AND ${linkedForReaderSql()}`,
      [experienceId, treasureId],
    );
    if (linkResult.rows.length > 0) {
      // On the venue as it stands when the row is written, under the share
      // lock every visit write takes: a venue a merge folds meanwhile takes no
      // visit.
      await pool.query(`
        INSERT INTO user_visited_experiences (user_id, experience_id, marked_at)
        ${placeAtWriteSql('$2', '$1, e.id, NOW()')}
        ON CONFLICT (user_id, experience_id) DO NOTHING
      `, [userId, experienceId]);

      // The venue's visit and nothing else (#2120): its own points read
      // visited through it, and a whole it is a part of reads it through its
      // part. Seeing a work in Antwerp Cathedral marks the cathedral, which
      // the Belfries of Belgium and France read as one of their belfries,
      // and marks no other belfry.

      const expResult = await pool.query('SELECT name FROM experiences WHERE id = $1', [experienceId]);
      experienceName = expResult.rows[0]?.name || null;
    }
  }

  return {
    success: true,
    treasureId,
    treasureName: treasure.name,
    experienceId,
    experienceName,
  };
}

/**
 * Unmark a treasure as viewed
 * DELETE /api/users/me/viewed-treasures/:treasureId
 * Does NOT unvisit the parent experience.
 */
export async function unmarkTreasureViewed(
  { params: { treasureId }, caller }: { params: z.output<typeof treasureIdParamSchema>; caller: Express.User },
): Promise<TreasureViewUnmarked> {
  const result = await pool.query(
    'DELETE FROM user_viewed_treasures WHERE user_id = $1 AND treasure_id = $2 RETURNING id',
    [caller.id, treasureId]
  );

  if (result.rowCount === 0) throw notFound('Viewed record not found');

  return { success: true, treasureId };
}

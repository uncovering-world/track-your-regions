/**
 * A site's card asks its curator where a find comes from (#2242).
 *
 * GET /api/experiences/:id/find-links
 * PUT /api/experiences/:id/find-links/:treasureId
 *
 * A run proposes, for a find whose Wikidata item names no place of discovery,
 * the site its own coordinate stands on (`services/sync/findSiteProposals.ts`):
 * the Dendera zodiac in the Louvre is proposed for the Dendera Temple complex,
 * 0 m from its point. A coordinate is a reason to ask, not an answer, so the
 * site's curator reads each proposal on the card and says yes or no. A yes puts
 * the find on the site's card, worded "from this site", and the site on the
 * find's row in its museum (`siteFinds.ts`, `found_at_site`'s neighbour
 * `from_site`); a no is kept, and the pair is never proposed again.
 *
 * The list holds the proposals still open and the links confirmed, which a
 * curator may take back; a refused pair is not asked about again. A find no
 * museum a reader may be sent to shows is left off: a question about a row no
 * reader sees is work for nothing, and the card would list it nowhere anyway.
 */

import type { z } from 'zod/v4';
import type { FindSiteLinkAnswerResult, FindSiteLinks } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import type { findSiteLinkAnswerBodySchema, findSiteLinkParamsSchema, idParamSchema } from '../../types/index.js';
import { creditOf } from './experienceAnswerRows.js';
import { resolveExperienceScope } from './experienceScope.js';
import { answerFindSiteLink } from './findSiteLinkWriter.js';
import { readerRegionsJsonSql } from './readerRegions.js';
import { venuesShowingSql } from './siteFinds.js';
import { publishedContentSql } from '../../db/readerPredicates.js';
import type { ImageCredit } from '../../services/sync/imageCredit.js';
import type { LinkedPlace } from '../../api/responses/experiences.js';

/**
 * The caller may curate the place `id`, which exists; throws otherwise. The
 * region the authority came from, for the curation log.
 */
async function requireSiteScope(id: number, caller: Express.User): Promise<number | null> {
  const exists = await pool.query('SELECT 1 FROM experiences WHERE id = $1', [id]);
  if (exists.rowCount === 0) throw notFound('Experience not found');
  const { permitted, logRegionId } = await resolveExperienceScope(caller.id, caller.role, id, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  return logRegionId;
}

interface FindSiteLinkRow {
  treasure_id: number;
  name: string;
  treasure_type: string;
  year: number | null;
  image_url: string | null;
  image_credit: ImageCredit | null;
  state: 'proposed' | 'confirmed';
  origin: 'coordinate' | 'curator';
  distance_m: number | null;
  shown_at: LinkedPlace[];
}

export async function getFindSiteLinks(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<FindSiteLinks> {
  await requireSiteScope(id, caller);
  const result = await pool.query<FindSiteLinkRow>(`
    SELECT fsl.treasure_id, t.name, t.treasure_type, t.year, t.image_url,
           t.metadata->'imageCredit' AS image_credit,
           fsl.state, fsl.origin, fsl.distance_m,
           -- Where the find is shown, so the curator reads "the Dendera zodiac,
           -- at the Louvre" and knows which object the question is about.
           (SELECT COALESCE(json_agg(json_build_object(
                     'id', v.id, 'name', v.name, 'kind_id', v.kind_id,
                     'regions', ${readerRegionsJsonSql('v.id')})
                   ORDER BY v.name, v.id), '[]'::json)
              -- One row per building, as the site's list of finds names it:
              -- a museum held as two rows until the catalogue merges them
              -- (#1247) is named once.
              FROM (SELECT DISTINCT ON (sv.external_id) sv.id, sv.name, svk.id AS kind_id
                    ${venuesShowingSql('t')}
                    ORDER BY sv.external_id, sv.id) v) AS shown_at
      FROM find_site_links fsl
      JOIN treasures t ON t.id = fsl.treasure_id
     WHERE fsl.site_id = $1
       AND fsl.state IN ('proposed', 'confirmed')
       -- A find a reader may see: passed itself and shown by a museum a reader
       -- may be sent to, which is what the card would list once confirmed.
       AND ${publishedContentSql('t')}
       AND EXISTS (SELECT 1 ${venuesShowingSql('t')})
       -- And whose own item names no find spot, the rule a link stands by on
       -- the card (siteFindIdsSql): one a later run reads off the item has
       -- taken the link's place, and confirming it would change nothing.
       AND t.metadata->'foundAt' IS NULL
     ORDER BY fsl.state = 'proposed' DESC, fsl.distance_m NULLS LAST, t.sitelinks_count DESC, t.id
  `, [id]);
  return {
    experienceId: id,
    links: result.rows.map(row => ({
      treasure_id: row.treasure_id,
      name: row.name,
      treasure_type: row.treasure_type,
      year: row.year,
      image_url: row.image_url,
      image_credit: creditOf(row.image_credit),
      state: row.state,
      origin: row.origin,
      distance_m: row.distance_m,
      shown_at: row.shown_at,
    })),
  };
}

export async function answerFindSiteLinkRequest(
  { params: { id, treasureId }, body: { answer }, caller }: {
    params: z.output<typeof findSiteLinkParamsSchema>;
    body: z.output<typeof findSiteLinkAnswerBodySchema>;
    caller: Express.User;
  },
): Promise<FindSiteLinkAnswerResult> {
  const logRegionId = await requireSiteScope(id, caller);
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, id);
    if (!locked) throw notFound('Experience not found');
    const answered = await answerFindSiteLink(client, locked.lock, treasureId, answer, caller.id);
    if (!answered) throw notFound('Link not found');
    // In the place's history like every other curator act (#863): which find,
    // the answer, and whether a no took back a link already confirmed.
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'find_site_answered', $3, $4)`,
      [id, caller.id, logRegionId, JSON.stringify({
        treasureId, find: answered.find, answer, wasConfirmed: answered.was === 'confirmed',
      })],
    );
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
  return { success: true, treasureId, answer };
}

/**
 * The finds dug up at a site, and where each of them is shown (#894).
 *
 * A find is a museum's treasure carrying `metadata.foundAt` — the Wikidata
 * discovery place the museum door stores (ADR-0058 decision 3) — and the site
 * rows those names point at are places of the Archaeology kind (`type =
 * 'site'`). Both halves are in the catalogue and, until this read, nothing
 * joined them: a traveller at Mycenae could not read that the Mask of Agamemnon
 * is in Athens, and the Rosetta Stone's row named Fort Julien as words.
 *
 * Exact match, and only that: `foundAt.qid = experiences.external_id`. A find
 * filed under a place *inside* a site — the tomb of Tutankhamun rather than the
 * Valley of the Kings, the House of the Faun rather than Pompeii — is not
 * reached, because following that relation is a source read of the spot's own
 * item, and this read is built from rows the two doors already write.
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import { SiteFindsResponse } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import { rowKindJoinSql } from '../../db/membership.js';
import {
  experienceOfferedToReaderSql, hideLostSql, offeredLinkSql, publishedContentSql,
} from './experienceLifecycle.js';
import { siteFindOf, type SiteFindRow } from './experienceAnswerRows.js';
import { readerRegionsJsonSql } from './readerRegions.js';

/**
 * Get the finds dug up at a site
 * GET /api/experiences/:id/finds
 *
 * Stateless, like `/search`: every row is one a reader may open, and the same
 * to every caller. A find is listed only through a museum a reader may be sent
 * to — the museum admitted and passed and still standing, the link the source
 * still places and a curator has passed, the work itself passed — and each
 * museum carries the regions that name it to a reader (`readerRegionsJsonSql`),
 * which is what makes "shown at the Louvre" a link rather than a name. A site
 * nobody may see, a row that is not a site, and an id that names nothing all
 * answer the same empty list, so the route confirms no existence.
 *
 * A museum in two kinds is two rows today (#755) — the Naples museum holds the
 * Farnese Hercules as an art museum and as an archaeology museum — and a find
 * shown at one building must not name it twice: the venues are one per
 * `external_id`, the row of the site's own kind preferred, since that is the
 * list a traveller collecting archaeology is reading.
 */
export async function getSiteFinds(req: Request, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));

  const result = await pool.query<SiteFindRow>(`
    SELECT f.*
    FROM (
      SELECT
        t.id, t.external_id, t.name, t.treasure_type, t.year, t.image_url,
        t.is_iconic, t.sitelinks_count,
        -- Whose photograph, for the same reason every list of works carries it
        -- (ADR-0043): a share of Commons files ask that the author be named
        -- wherever the picture appears, and this list shows it.
        t.metadata->'imageCredit' AS image_credit,
        (SELECT COALESCE(json_agg(json_build_object(
                  'id', v.id, 'name', v.name, 'kind_id', v.kind_id,
                  'regions', ${readerRegionsJsonSql('v.id')})
                ORDER BY v.name, v.id), '[]'::json)
         FROM (
           SELECT DISTINCT ON (m.external_id) m.id, m.name, vk.id AS kind_id
           FROM experience_treasures et
           JOIN experiences m ON m.id = et.experience_id
           ${rowKindJoinSql('m', 'vm', 'vk')}
           WHERE et.treasure_id = t.id
             -- The link: still placed by the source (ADR-0044) and passed by a
             -- curator (ADR-0025). Not widened for anyone: a link is a claim a
             -- reader acts on.
             AND ${offeredLinkSql('et')}
             AND ${publishedContentSql('et')}
             -- The museum: accepted by a kind, passed, and still standing.
             AND ${experienceOfferedToReaderSql('m')}
             AND ${hideLostSql('m')}
           -- One row per building; the site's own kind first, then the id, so
           -- the choice is total.
           ORDER BY m.external_id, (m.source_id = e.source_id) DESC, m.id
         ) v) AS shown_at
      FROM experiences e
      JOIN treasures t ON t.metadata->'foundAt'->>'qid' = e.external_id
      WHERE e.id = $1
        -- A site, by the type only the Archaeology kind has: the QID a find
        -- names is a place somebody dug in, never a museum.
        AND e.type = 'site'
        AND ${experienceOfferedToReaderSql('e')}
        AND ${hideLostSql('e')}
        -- The work itself is passed globally (ADR-0025 decision 2).
        AND ${publishedContentSql('t')}
    ) f
    -- A find no museum a reader may see holds is a find nobody can go and see.
    WHERE json_array_length(f.shown_at) > 0
    ORDER BY f.sitelinks_count DESC, f.id
  `, [experienceId]);

  respond(res, SiteFindsResponse, {
    experienceId,
    finds: result.rows.map(siteFindOf),
    total: result.rows.length,
  });
}

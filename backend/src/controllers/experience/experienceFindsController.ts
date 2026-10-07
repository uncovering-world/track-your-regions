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

import type { z } from 'zod/v4';
import type { SiteFindsResponse } from '../../api/responses/experiences.js';
import type { idParamSchema } from '../../types/index.js';
import { pool } from '../../db/index.js';
import { experienceOfferedToReaderSql } from '../../db/readerPredicates.js';
import { siteFindOf, type SiteFindRow } from './experienceAnswerRows.js';
import { readerRegionsJsonSql } from './readerRegions.js';
// What a find of a site on view is, shared with the count on the site's row in
// a region's list, so "3 finds on view" and this list cannot disagree (#907).
import { findOfSiteSql, venuesShowingSql } from './siteFinds.js';

/**
 * Get the finds dug up at a site
 * GET /api/experiences/:id/finds
 *
 * Stateless, like `/search`: every row is one a reader may open, and the same
 * to every caller. A find is listed only through a museum a reader may be sent
 * to (`siteFinds.ts`: the museum admitted and passed and still standing, the
 * link the source still places and a curator has passed, the work itself
 * passed) — and each museum carries the regions that name it to a reader (`readerRegionsJsonSql`),
 * which is what makes "shown at the Louvre" a link rather than a name. A site
 * nobody may see, a row that is not a site, and an id that names nothing all
 * answer the same empty list, so the route confirms no existence.
 *
 * A site that no longer stands is not one nobody may see: a dig flooded by a
 * dam or built over is shown to a reader who asks for what is gone, and what
 * was found there is still on view — which is exactly what its card should
 * say. So the site is gated on its acceptance alone, as the count on its row
 * in a region's list is (`findsOnViewCountSql`); the museum still has to
 * stand, since a find is listed only where a traveller can go and see it.
 *
 * The way back stays closed on purpose: a find on its museum's list names a
 * lost dig as words, not a link (`found_at_site` in
 * `experienceTreasureController.ts` keeps `hideLostSql`). A region's list
 * holds a lost place only for a reader who asked for what is gone
 * (`includeLost`), so a link from a museum would send everyone else to an
 * address whose card the list cannot open — while a lost dig's own card is
 * reached only by a reader who has already asked.
 *
 * A museum in two kinds can be two rows until the catalogue merges them
 * (#1247) — the Naples museum holds the Farnese Hercules as an art museum and
 * as an archaeology museum — and a find shown at one building must not name it
 * twice: the venues are one per
 * `external_id`, the row of the site's own kind preferred, since that is the
 * list a traveller collecting archaeology is reading.
 */
export async function getSiteFinds(
  { params: { id: experienceId } }: { params: z.output<typeof idParamSchema> },
): Promise<SiteFindsResponse> {

  const result = await pool.query<SiteFindRow>(`
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
         SELECT DISTINCT ON (sv.external_id) sv.id, sv.name, svk.id AS kind_id
         ${venuesShowingSql('t')}
         -- One row per building; the site's own kind first, then the id, so
         -- the choice is total.
         ORDER BY sv.external_id, (sv.source_id = e.source_id) DESC, sv.id
       ) v) AS shown_at
    FROM experiences e
    JOIN treasures t ON ${findOfSiteSql('e', 't')}
    WHERE e.id = $1
      AND ${experienceOfferedToReaderSql('e')}
    ORDER BY t.sitelinks_count DESC, t.id
  `, [experienceId]);

  return {
    experienceId,
    finds: result.rows.map(siteFindOf),
    total: result.rows.length,
  };
}

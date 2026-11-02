/**
 * A curator's answer to a find's link to the site it came from (#2242), the
 * curator's writer of `find_site_links`. The run's proposals are the other
 * (`services/sync/findSiteProposals.ts`), and the backend lint refuses a write
 * anywhere else.
 *
 * The answer is written under the site's object lock (`lockExperience`): the
 * link decides what the site's card lists, and a curator answering from the
 * card is writing the site's side of it. Who answered and when stay on the
 * row (`decided_by`, `decided_at`), so the curator's work can be read back;
 * a refused pair is never proposed again.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';

/** What a curator may say of a link: that the find comes from the site, or that it does not. */
export type FindSiteAnswer = 'confirmed' | 'refused';

/**
 * A link a curator makes by hand (`origin` curator), confirmed as it is made:
 * the find's item names no find spot and its own point stands nowhere near
 * the site, or it has none, so no run would propose it. Null where
 * the pair already has a row, which is answered instead.
 */
export async function linkFindToSite(
  client: PoolClient,
  site: LockedExperience,
  treasureId: number,
  curatorId: number,
): Promise<AnsweredFindSiteLink | null> {
  const result = await client.query<AnsweredFindSiteLink>(
    `INSERT INTO find_site_links (treasure_id, site_id, state, origin, decided_by, decided_at)
     VALUES ($2, $1, 'confirmed', 'curator', $3, NOW())
     ON CONFLICT (treasure_id, site_id) DO NOTHING
     RETURNING 'proposed' AS was, (SELECT name FROM treasures WHERE id = $2) AS find`,
    [site.id, treasureId, curatorId],
  );
  return result.rows[0] ?? null;
}

/** The link as it stood before the answer, and the find's name, for the curation log. */
export interface AnsweredFindSiteLink {
  was: 'proposed' | 'confirmed' | 'refused';
  find: string;
}

/**
 * Record the curator's answer on the link between `site` and the find
 * `treasureId`. Null where the site has no such link: a curator answers a
 * proposal the run made, or takes back a link already confirmed.
 */
export async function answerFindSiteLink(
  client: PoolClient,
  site: LockedExperience,
  treasureId: number,
  answer: FindSiteAnswer,
  curatorId: number,
): Promise<AnsweredFindSiteLink | null> {
  const result = await client.query<AnsweredFindSiteLink>(
    `UPDATE find_site_links l
        SET state = $3, decided_by = $4, decided_at = NOW()
       FROM (SELECT b.id, b.state FROM find_site_links b
              WHERE b.site_id = $1 AND b.treasure_id = $2 FOR UPDATE) before,
            treasures t
      WHERE l.id = before.id AND t.id = l.treasure_id
      RETURNING before.state AS was, t.name AS find`,
    [site.id, treasureId, answer, curatorId],
  );
  return result.rows[0] ?? null;
}

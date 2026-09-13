/**
 * An admin sets a source's fame line.
 *
 * The world tier's line (how many sitelinks a row needs to enter it, and how
 * few it may fall to before it is refused by name) used to be two constants in
 * the pipeline that owned it. A kind whose sources enumerate different worlds
 * needs its own numbers, so the line is stored on the source row
 * (`experience_sources.api_config`) and read by the run through
 * `parseSourceLine` (`services/sync/sourceLine.ts`) — this route is that
 * value's only writer, and the two share one bound (integers 1..1000, stay no
 * higher than enter) enforced twice: here by `sourceLineBodySchema`, there by
 * `parseSourceLine` itself, because the panel is not the only caller a stray
 * row could reach.
 *
 * Not every source has a line to move. The two Wikidata sources that predate
 * this route still read their line from a constant in code, and moving that
 * to `api_config` is a later ticket's job (the explorer ticket, #753's
 * successor) rather than something this route can do for a row nobody has
 * seeded — so a source whose `api_config` carries no line answers 409 rather
 * than silently adding one the run was never told to read.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Set a source's fame line: how many sitelinks a row needs to enter the world
 * tier, and how few it may fall to before the tier lets it go.
 * PUT /api/admin/sync/sources/:sourceId/line
 */
export async function setSourceLine(req: AuthenticatedRequest, res: Response): Promise<void> {
  const sourceId = parseInt(String(req.params.sourceId));
  const { enterSitelinks, staySitelinks } = req.body as { enterSitelinks: number; staySitelinks: number };

  // `is_active` in the guard, not only the id, for the same reason the gate
  // switch checks it: the panel lists active sources, so a request naming an
  // inactive one is stale or hand-made.
  const exists = await pool.query(
    `SELECT id, api_config ? 'enterSitelinks' AS has_line
       FROM experience_sources
      WHERE id = $1 AND is_active = true`,
    [sourceId],
  );

  if (exists.rows.length === 0) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  if (!exists.rows[0].has_line) {
    res.status(409).json({ error: 'This source keeps its line in code' });
    return;
  }

  // `||` merges rather than replaces, so a source's other api_config keys
  // (its userAgent, its cache settings) survive a line change untouched.
  const result = await pool.query(
    `UPDATE experience_sources
        SET api_config = COALESCE(api_config, '{}'::jsonb) || $1::jsonb
      WHERE id = $2
      RETURNING id, name, api_config`,
    [JSON.stringify({ enterSitelinks, staySitelinks }), sourceId],
  );

  const source = result.rows[0];
  // No per-source audit table, same as the gate switch beside it — but a
  // number that decides what a run admits changing with no trace anywhere is
  // not acceptable either.
  console.log(
    `[source-line] ${source.name} (${source.id}) -> enter ${enterSitelinks}, stay ${staySitelinks} by user ${req.user?.id}`,
  );

  res.json({
    sourceId: source.id,
    name: source.name,
    enterSitelinks,
    staySitelinks,
  });
}

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
 * A source may have two doors rather than one. Archaeology admits the site a
 * traveller stands on and the famous find a museum holds, and a find is written
 * up in fewer languages than its museum, so the row carries a second, lower
 * pair under the `find…` keys (ADR-0058 decision 5). This route writes whichever
 * keys the body carries — jsonb `||` merges, so a body with the finds pair adds
 * or moves it and a body without one leaves the row's other keys alone — and
 * that is deliberately not gated on the source already having a finds line: a
 * kind that gains a second door gets its line here rather than by hand.
 *
 * Not every source has a line to move. The two Wikidata sources that predate
 * this route still read their line from a constant in code, and moving that
 * to `api_config` is a later ticket's job (the explorer ticket, #753's
 * successor) rather than something this route can do for a row nobody has
 * seeded — so a source whose `api_config` carries none of the four line keys
 * answers 409 rather than silently adding one the run was never told to read.
 * Any one of the keys is enough: a row left holding half a pair by a hand edit
 * is a broken row the admin panel shows for exactly this repair, and the run
 * refuses to start on it until the save lands (`SourceLineControls`).
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Set a source's fame line: how many sitelinks a row needs to enter the world
 * tier, and how few it may fall to before the tier lets it go — and, for a
 * source with a second door, the same pair for its finds.
 * PUT /api/admin/sync/sources/:sourceId/line
 */
export async function setSourceLine(req: AuthenticatedRequest, res: Response): Promise<void> {
  const sourceId = parseInt(String(req.params.sourceId));
  const {
    enterSitelinks, staySitelinks, findEnterSitelinks, findStaySitelinks,
  } = req.body as {
    enterSitelinks: number;
    staySitelinks: number;
    findEnterSitelinks?: number;
    findStaySitelinks?: number;
  };

  // Only the keys the body carries are written, so a one-door source keeps a
  // row with one pair on it and a finds line is never invented for a source
  // whose run would not read one. The schema has already refused half a pair.
  const line: Record<string, number> = { enterSitelinks, staySitelinks };
  if (findEnterSitelinks !== undefined && findStaySitelinks !== undefined) {
    line.findEnterSitelinks = findEnterSitelinks;
    line.findStaySitelinks = findStaySitelinks;
  }

  // `is_active` in the guard, not only the id, for the same reason the gate
  // switch checks it: the panel lists active sources, so a request naming an
  // inactive one is stale or hand-made.
  const exists = await pool.query(
    `SELECT id,
            api_config ?| array['enterSitelinks', 'staySitelinks', 'findEnterSitelinks', 'findStaySitelinks']
              AS has_line
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
    [JSON.stringify(line), sourceId],
  );

  const source = result.rows[0];
  // No per-source audit table, same as the gate switch beside it — but a
  // number that decides what a run admits changing with no trace anywhere is
  // not acceptable either.
  const finds = line.findEnterSitelinks === undefined
    ? ''
    : `, finds enter ${line.findEnterSitelinks}, finds stay ${line.findStaySitelinks}`;
  console.log(
    `[source-line] ${source.name} (${source.id}) -> enter ${enterSitelinks}, stay ${staySitelinks}${finds} by user ${req.user?.id}`,
  );

  // The keys this request wrote, so the panel's own fields answer with what it
  // just sent. A body that left the finds pair out left the stored one where it
  // was: this route moves a line, it does not take a door away.
  res.json({
    sourceId: source.id,
    name: source.name,
    ...line,
  });
}

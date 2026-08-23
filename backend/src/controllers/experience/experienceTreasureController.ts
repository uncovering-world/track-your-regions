/**
 * Experience Treasure Controller
 *
 * Treasure (artwork) browsing and viewed-treasure tracking.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import {
  hideRefusedSql, hidePendingSql, linkedForReaderSql, offeredLocationSql, publishedContentSql,
} from './experienceLifecycle.js';
import { maySeeUnreadExperience } from './experienceScope.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Get contents (treasures) for an experience
 * GET /api/experiences/:id/treasures
 *
 * optionalAuth: one of the three by-id reads ADR-0025 relaxes the pending gate
 * for (see `maySeeUnreadExperience`), so a curator or admin reaching a gated
 * museum's page from the queue also sees its unread treasures and links,
 * rather than a container that opened onto an empty list.
 */
export async function getExperienceTreasures(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const maySeeUnread = await maySeeUnreadExperience(req.user?.id, req.user?.role, experienceId);

  const result = await pool.query(`
    SELECT
      t.id, t.external_id, t.name, t.treasure_type, t.artist, t.year,
      t.image_url, t.sitelinks_count, t.is_iconic,
      -- Beside the picture, as it is on the object itself: these files are
      -- served from Wikimedia Commons and a share of them are CC BY or CC BY-SA,
      -- which of a screen that shows a picture ask one thing -- that whoever
      -- took it is named wherever it appears. A list of works is showing them.
      t.metadata->'imageCredit' AS image_credit
    FROM treasures t
    JOIN experience_treasures et ON t.id = et.treasure_id
    JOIN experiences e ON e.id = et.experience_id
    WHERE et.experience_id = $1
      -- The contents follow the container: a refused museum's works are not on
      -- offer either, and answering with them would put back on screen exactly
      -- what hiding the museum took off it (ADR-0024).
      AND ${hideRefusedSql()}
      -- Three predicates, not one: ADR-0025 gates the experience, the link and
      -- the treasure separately, because a published museum can hold newly
      -- written, unread paintings the container gate never reaches. All three
      -- widen on the same boolean, so a curator let past one is let past all.
      AND ($2::boolean OR ${hidePendingSql()})
      AND ($2::boolean OR ${publishedContentSql('et')})
      AND ($2::boolean OR ${publishedContentSql('t')})
    ORDER BY t.sitelinks_count DESC
  `, [experienceId, maySeeUnread]);

  res.json({
    experienceId,
    treasures: result.rows,
    total: result.rows.length,
  });
}

/**
 * Get viewed treasure IDs for current user
 * GET /api/users/me/viewed-treasures/ids
 */
export async function getViewedTreasureIds(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = req.query.experienceId ? parseInt(String(req.query.experienceId)) : null;

  let query = `
    SELECT uvt.treasure_id
    FROM user_viewed_treasures uvt
  `;

  const params: number[] = [userId];

  if (experienceId) {
    query += `
      JOIN experience_treasures et ON uvt.treasure_id = et.treasure_id
      WHERE uvt.user_id = $1 AND et.experience_id = $2
    `;
    params.push(experienceId);
  } else {
    query += ' WHERE uvt.user_id = $1';
  }

  const result = await pool.query(query, params);

  res.json({
    viewedTreasureIds: result.rows.map(r => r.treasure_id),
  });
}

/**
 * Mark a treasure as viewed
 * POST /api/users/me/viewed-treasures/:treasureId
 * Body: { experienceId } — needed to auto-mark the venue as visited (treasure can be in multiple venues).
 * Also auto-marks the parent experience as visited.
 */
export async function markTreasureViewed(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const treasureId = parseInt(String(req.params.treasureId));

  // Verify the treasure exists *and* is one a read could have shown this
  // caller. Gated on its own curation_state (ADR-0025): without this, any
  // authenticated caller could POST a guessed id for a `pending` work, get its
  // name echoed back below, and have written a `user_viewed_treasures` row for
  // something no read ever offered them (#520's reasoning, unchanged from
  // location to treasure).
  const treasureResult = await pool.query(
    `SELECT t.id, t.name FROM treasures t WHERE t.id = $1 AND ${publishedContentSql('t')}`,
    [treasureId],
  );

  if (treasureResult.rows.length === 0) {
    res.status(404).json({ error: 'Treasure not found' });
    return;
  }

  const treasure = treasureResult.rows[0];

  // Insert viewed record
  await pool.query(`
    INSERT INTO user_viewed_treasures (user_id, treasure_id, viewed_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, treasure_id) DO NOTHING
  `, [userId, treasureId]);

  // If experienceId provided, auto-mark that venue as visited
  const experienceId = req.body.experienceId ? parseInt(String(req.body.experienceId)) : null;
  let experienceName: string | null = null;

  if (experienceId) {
    // Verify the treasure is linked to this experience, and that neither the
    // container nor the link itself is unread — the same two gates the
    // location auto-mark below carries, for the same reason: without them, a
    // caller who could see this treasure (checked above) but not this
    // particular museum, or not this particular link, would auto-mark a
    // `pending` experience visited at :139 and have its name echoed back at
    // :161, from a lookup this join never scoped to what the caller may see.
    const linkResult = await pool.query(
      `SELECT 1 FROM experience_treasures et
         JOIN experiences e ON e.id = et.experience_id
        WHERE et.experience_id = $1 AND et.treasure_id = $2
          AND ${linkedForReaderSql()}`,
      [experienceId, treasureId],
    );
    if (linkResult.rows.length > 0) {
      await pool.query(`
        INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, experience_id) DO NOTHING
      `, [userId, experienceId]);

      // Auto-mark all locations of the experience as visited — the ones on
      // offer and read by someone. A point the source withdrew is on no list
      // this reader saw, so recording a visit to it would be a claim they
      // never made — and the same is true of a point nobody has checked yet
      // (ADR-0025): without the curation_state gate, viewing one treasure in
      // a museum would manufacture visits to every one of its unread points
      // (#520 — the write path this reasoning did not account for).
      await pool.query(`
        INSERT INTO user_visited_locations (user_id, location_id, visited_at)
        SELECT $1, el.id, NOW()
        FROM experience_locations el
        JOIN experiences e ON e.id = el.experience_id
        WHERE el.experience_id = $2 AND ${offeredLocationSql()}
          AND ${hidePendingSql()} AND ${publishedContentSql('el')}
        ON CONFLICT (user_id, location_id) DO NOTHING
      `, [userId, experienceId]);

      const expResult = await pool.query('SELECT name FROM experiences WHERE id = $1', [experienceId]);
      experienceName = expResult.rows[0]?.name || null;
    }
  }

  res.json({
    success: true,
    treasureId,
    treasureName: treasure.name,
    experienceId,
    experienceName,
  });
}

/**
 * Unmark a treasure as viewed
 * DELETE /api/users/me/viewed-treasures/:treasureId
 * Does NOT unvisit the parent experience.
 */
export async function unmarkTreasureViewed(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const treasureId = parseInt(String(req.params.treasureId));

  const result = await pool.query(
    'DELETE FROM user_viewed_treasures WHERE user_id = $1 AND treasure_id = $2 RETURNING id',
    [userId, treasureId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Viewed record not found' });
    return;
  }

  res.json({ success: true, treasureId });
}

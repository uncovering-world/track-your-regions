/**
 * World view visibility guard.
 *
 * A world view with `is_public = false` is admin-only. This middleware enforces
 * that on the read surface, so hiding one is a real access decision rather than a
 * missing dropdown entry.
 *
 * Tile access is a separate boundary and is NOT covered here: Martin publishes
 * its tile functions on a public port, so a hidden world view's geometry remains
 * fetchable by tile id until that is closed.
 */

import type { Response, NextFunction } from 'express';
import { pool } from '../db/index.js';
import type { AuthenticatedRequest } from './auth.js';

/** Where in the request the identifier lives. */
export type VisibilitySource = 'worldViewIdParam' | 'worldViewIdQuery' | 'regionIdParam' | 'regionIdQuery';

const BY_WORLD_VIEW = `
  SELECT is_public
  FROM world_views
  WHERE id = $1 AND is_active = true
`;

const BY_REGION = `
  SELECT wv.is_public
  FROM regions r
  JOIN world_views wv ON wv.id = r.world_view_id
  WHERE r.id = $1 AND wv.is_active = true
`;

/**
 * Reads the id for `source` from the request.
 *
 * Returns `undefined` only for `regionIdQuery`'s "not supplied" case — that
 * source is an optional filter (an unfiltered read is legitimate), unlike the
 * other three sources where the id is mandatory and a missing value is just
 * another shape of "doesn't parse", folded into `null` below.
 */
function readId(req: AuthenticatedRequest, source: VisibilitySource): number | null | undefined {
  let raw: unknown;
  if (source === 'worldViewIdQuery') {
    raw = req.query?.worldViewId;
  } else if (source === 'regionIdParam') {
    raw = req.params?.regionId;
  } else if (source === 'regionIdQuery') {
    if (req.query?.regionId === undefined) return undefined;
    raw = req.query.regionId;
  } else {
    raw = req.params?.worldViewId;
  }
  const id = parseInt(String(raw ?? ''), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function requireVisibleWorldView(source: VisibilitySource) {
  return async function visibilityGuard(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (req.user?.role === 'admin') {
      next();
      return;
    }

    const id = readId(req, source);
    if (id === undefined) {
      // regionIdQuery, not supplied: a legitimate unfiltered read, pass through.
      next();
      return;
    }
    if (id === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const sql = source === 'regionIdParam' || source === 'regionIdQuery' ? BY_REGION : BY_WORLD_VIEW;
    const result = await pool.query(sql, [id]);

    // A missing row and a hidden world view get the same answer on purpose:
    // 404 leaks nothing about which world views exist.
    if (result.rows.length === 0 || result.rows[0].is_public !== true) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    next();
  };
}

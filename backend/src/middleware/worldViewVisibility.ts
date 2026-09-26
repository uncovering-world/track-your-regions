/**
 * World view visibility guard.
 *
 * A world view with `is_public = false` is admin-only. This middleware enforces
 * that on the read surface, so hiding one is a real access decision rather than a
 * missing dropdown entry.
 *
 * Tile access is a separate boundary and is NOT covered here: Martin publishes
 * its tile functions on a public port, so a hidden world view's geometry remains
 * fetchable by tile id until that is closed — and the default world view by no
 * id at all, its map being GADM, whose root source takes no parameter.
 * `docs/security/SECURITY.md` § Known Gaps carries the whole of it.
 */

import type { Response, NextFunction } from 'express';
import { pool } from '../db/index.js';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Where in the request the identifier lives: a path parameter. A declared
 * route names its world view in `scope` instead, from any part of its parsed
 * input (ADR-0071).
 */
export type VisibilitySource = 'worldViewIdParam' | 'regionIdParam';

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

/** The id for `source`, or null where it is missing or does not parse. */
function readId(req: AuthenticatedRequest, source: VisibilitySource): number | null {
  const raw = source === 'regionIdParam' ? req.params?.regionId : req.params?.worldViewId;
  const id = parseInt(String(raw ?? ''), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** A world view, or a region whose world view decides. */
export type VisibleScope = { readonly worldViewId: number } | { readonly regionId: number };

/**
 * Whether a reader who is not an admin may see `scope`: its world view is
 * active and public. A missing row and a hidden world view answer the same.
 */
export async function isVisibleToReaders(scope: VisibleScope): Promise<boolean> {
  const [sql, id] = 'regionId' in scope ? [BY_REGION, scope.regionId] : [BY_WORLD_VIEW, scope.worldViewId];
  const result = await pool.query<{ is_public: boolean }>(sql, [id]);
  return result.rows.length > 0 && result.rows[0].is_public === true;
}

/** The guard for a route not yet declared; a declared one names its `scope` (ADR-0071). */
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
    if (id === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const scope = source === 'regionIdParam' ? { regionId: id } : { worldViewId: id };

    // A missing row and a hidden world view get the same answer on purpose:
    // 404 leaks nothing about which world views exist.
    if (!(await isVisibleToReaders(scope))) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    next();
  };
}

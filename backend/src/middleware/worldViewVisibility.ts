/**
 * World view visibility.
 *
 * A world view with `is_public = false` is admin-only. A route that reads a
 * world view's data names it as its `scope`, and the registry checks it here
 * before the handler runs, answering 404 to anyone but an admin (ADR-0071), so
 * hiding one is a real access decision rather than a missing dropdown entry.
 *
 * Tile access is a separate boundary and is NOT covered here: Martin publishes
 * its tile functions on a public port, so a hidden world view's geometry remains
 * fetchable by tile id until that is closed — and the default world view by no
 * id at all, its map being GADM, whose root source takes no parameter.
 * `docs/security/SECURITY.md` § Known Gaps carries the whole of it.
 */

import { pool } from '../db/index.js';

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

/** A world view, or a region whose world view decides. */
export type VisibleScope = { readonly worldViewId: number } | { readonly regionId: number };

/**
 * Whether a reader who is not an admin may see `scope`: its world view is
 * active and public. A missing row and a hidden world view answer the same,
 * so the 404 says nothing about which world views exist.
 */
export async function isVisibleToReaders(scope: VisibleScope): Promise<boolean> {
  const [sql, id] = 'regionId' in scope ? [BY_REGION, scope.regionId] : [BY_WORLD_VIEW, scope.worldViewId];
  const result = await pool.query<{ is_public: boolean }>(sql, [id]);
  return result.rows.length > 0 && result.rows[0].is_public === true;
}

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, updateUserLastSeen } from '../services/authService.js';
import type { JWTPayload, UserRole } from '../types/auth.js';
import { pool } from '../db/index.js';
// =============================================================================
// Extended Request Types
// =============================================================================

export interface AuthenticatedRequest extends Request {
  user?: Express.User;
  jwtPayload?: JWTPayload;
}

// =============================================================================
// Middleware: requireAuth
// =============================================================================
/**
 * Requires a valid JWT access token.
 * Populates req.user with the authenticated user.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Support token in query parameter for SSE (EventSource can't send headers)
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;

  if (!authHeader?.startsWith('Bearer ') && !queryToken) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  const token = queryToken || authHeader!.substring(7);
  const payload = verifyAccessToken(token);

  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Set user info on request
  req.jwtPayload = payload;
  req.user = {
    id: payload.sub,
    uuid: payload.uuid,
    email: null,
    displayName: null,
    role: payload.role,
    avatarUrl: null,
    emailVerified: false,
  };

  // Update last seen (fire and forget)
  updateUserLastSeen(payload.sub).catch(() => {});

  next();
}

// =============================================================================
// Middleware: requireAdmin
// =============================================================================
/**
 * Requires the authenticated user to have admin role.
 * Must be used AFTER requireAuth.
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}

// =============================================================================
// Middleware: optionalAuth
// =============================================================================
/**
 * Attempts to authenticate the user but doesn't fail if no auth provided.
 * Useful for endpoints that behave differently for authenticated users.
 *
 * Which is why it also marks the response private to its caller. A handler
 * behind this middleware reads `req.user` to shape its answer — curator
 * rejection visibility, an admin's 200 where a visitor gets 404, a reader's
 * own `is_new` — so the body is not a shared representation of one URL, and
 * Express's default ETag + `Vary: Origin` says nothing about who asked. A
 * proxy, or a future CDN, could store one caller's answer under the URL alone
 * and hand it to the next. `private` forbids that for any shared cache;
 * `no-cache` (not `no-store`) leaves the browser its revalidation round-trip —
 * a region's list, its locations and its geometry all answer 304 to a
 * conditional request today, and the origin answers every revalidation for
 * the *current* caller, so a stored variant is never served to the wrong one.
 * `Vary: Authorization` keys whatever private cache does store it on the
 * caller — which also bounds the round-trip for a signed-in reader: a stored
 * variant is selectable only under the token it was stored with, and the
 * access token rotates every 15 minutes, so they get the 304 within one
 * token's lifetime and a full body on the first read after each refresh. An
 * anonymous reader, who sends no token, keeps it unconditionally. The rule
 * lives here rather than on each route so a read added tomorrow carries it
 * by carrying the middleware (#597).
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'private, no-cache');
  // `res.vary` appends; `setHeader('Vary', …)` replaces. CORS already puts
  // `Origin` there, and clobbering it would trade one caching bug for another.
  res.vary('Authorization');

  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);

    if (payload) {
      req.jwtPayload = payload;
      req.user = {
        id: payload.sub,
        uuid: payload.uuid,
        email: null,
        displayName: null,
        role: payload.role,
        avatarUrl: null,
        emailVerified: false,
      };

      updateUserLastSeen(payload.sub).catch(() => {});
    }
  }

  next();
}

// =============================================================================
// Middleware: requireCurator
// =============================================================================
/**
 * Requires the authenticated user to have curator or admin role.
 * Must be used AFTER requireAuth.
 */
export function requireCurator(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'curator' && req.user.role !== 'admin') {
    res.status(403).json({ error: 'Curator access required' });
    return;
  }

  next();
}

// =============================================================================
// Helper: Check Curator Scope
// =============================================================================
/**
 * Checks if a curator has permission for the given region (and optionally category).
 * Admin always has access. Checks global scope, then category scope, then walks
 * up the region hierarchy via recursive CTE.
 */
export async function checkCuratorScope(
  userId: number,
  userRole: UserRole,
  regionId: number,
  categoryId?: number,
): Promise<boolean> {
  // Admin bypass
  if (userRole === 'admin') return true;

  // Check global scope
  const globalResult = await pool.query(
    `SELECT id FROM curator_assignments WHERE user_id = $1 AND scope_type = 'global' LIMIT 1`,
    [userId],
  );
  if (globalResult.rows.length > 0) return true;

  // Check category scope if categoryId provided
  if (categoryId) {
    const categoryResult = await pool.query(
      `SELECT id FROM curator_assignments WHERE user_id = $1 AND scope_type = 'category' AND category_id = $2 LIMIT 1`,
      [userId, categoryId],
    );
    if (categoryResult.rows.length > 0) return true;
  }

  // Check region scope: walk up the region hierarchy
  const regionResult = await pool.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id FROM regions WHERE id = $2
       UNION ALL
       SELECT r.id FROM regions r
       JOIN ancestors a ON r.id = (SELECT parent_region_id FROM regions WHERE id = a.id)
       WHERE (SELECT parent_region_id FROM regions WHERE id = a.id) IS NOT NULL
     )
     SELECT ca.id FROM curator_assignments ca
     JOIN ancestors a ON ca.region_id = a.id
     WHERE ca.user_id = $1 AND ca.scope_type = 'region'
     LIMIT 1`,
    [userId, regionId],
  );

  return regionResult.rows.length > 0;
}

// =============================================================================
// Helper: Curator-Scoped Regions
// =============================================================================
/**
 * SQL prelude naming `curator_scoped_regions`: every region a curator's
 * region-scoped assignments cover — each assigned region plus everything
 * beneath it. Same set as `checkCuratorScope`'s ancestor walk, reached from
 * the other end, so it can filter a result set rather than answer about one
 * region. Prepend it to a query and reference the CTE in a predicate.
 *
 * The curator's user id must be `$1` in any query that uses this.
 */
export const CURATOR_SCOPED_REGIONS_CTE = `
  WITH RECURSIVE curator_scoped_regions AS (
    SELECT ca.region_id AS id
    FROM curator_assignments ca
    WHERE ca.user_id = $1 AND ca.scope_type = 'region' AND ca.region_id IS NOT NULL
    UNION
    SELECT r.id
    FROM regions r
    JOIN curator_scoped_regions s ON r.parent_region_id = s.id
  )`;

/**
 * SQL fragment: is this caller's curator scope unrestricted for an experience
 * of the given category? True for a global assignment, or a category assignment
 * naming that category — the two scope types that reach past any one region, so
 * a caller holding either sees the experience whole.
 *
 * It matches nothing else `curator_assignments.scope_type` may hold. That is a
 * property, not an omission: a legacy `source` row (#452) yields *no* scope
 * rather than wrong scope, which `docs/security/asvs-checklist.yaml` V8.3.2
 * asserts. Kept here in one piece so the two queries that ask this question
 * cannot drift apart when the scope set changes.
 *
 * Expects `$1` = curator user id. Where the category comes from is the caller's
 * choice, and it is not a free-form string: a query about one experience knows
 * the category up front and binds it as `$3`, while a query returning many rows
 * has a different category per row and must correlate on the column instead.
 * Passing `$3` there would compare every row against one request parameter, and
 * a category curator who did not happen to filter by their own category would
 * silently lose the scope they hold.
 */
export function curatorUnrestrictedScopeExists(category: '$3' | 'e.category_id' = '$3'): string {
  return `
    EXISTS (
      SELECT 1 FROM curator_assignments ca
      WHERE ca.user_id = $1
        AND (ca.scope_type = 'global' OR (ca.scope_type = 'category' AND ca.category_id = ${category}))
    )`;
}

/** The single-experience form, which binds the category as `$3`. */
export const CURATOR_UNRESTRICTED_SCOPE_EXISTS = curatorUnrestrictedScopeExists();

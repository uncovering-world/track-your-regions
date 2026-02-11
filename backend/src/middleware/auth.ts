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
 */
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
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
// Helper: Check Role
// =============================================================================
/**
 * Checks if user has any of the specified roles.
 */
export function hasRole(req: AuthenticatedRequest, ...roles: UserRole[]): boolean {
  if (!req.user) return false;
  return roles.includes(req.user.role);
}

/**
 * Checks if user is an admin.
 */
export function isAdmin(req: AuthenticatedRequest): boolean {
  return hasRole(req, 'admin');
}

/**
 * Checks if user is a curator (or admin).
 */
export function isCurator(req: AuthenticatedRequest): boolean {
  return hasRole(req, 'curator', 'admin');
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

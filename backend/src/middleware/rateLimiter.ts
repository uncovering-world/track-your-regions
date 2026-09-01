/**
 * Shared Rate Limiters
 *
 * ALL rate limiters are defined here for consistency.
 * See docs/tech/rate-limiting.md for the full strategy.
 *
 * Tiers:
 * 1. Auth-specific: strict limits on login, register, refresh, etc.
 * 2. Search: moderate limits on search/geocode endpoints (30 req/min)
 * 3. Public read: generous limits for UI-serving read endpoints (60 req/min)
 * 4. Authenticated user: per-IP limits for logged-in user actions (60 req/min)
 * 5. Admin/curator: exempt — protected by requireAuth + requireAdmin/requireCurator
 */
import rateLimit from 'express-rate-limit';

/**
 * A read tier's ceiling, raised only where one IP is not one visitor.
 *
 * Every request in the isolated E2E stack comes from a single browser
 * container, so the per-IP assumption these limits rest on does not hold there:
 * a dozen specs' page loads share one budget. The suite crossed 60 reads a
 * minute the day a twelfth spec arrived (#592), and what that looked like was
 * not a rate-limit error — `GET /api/world-views` answered 429, the client read
 * the rejection as an empty list, and the app drew the "fresh installation"
 * screen with no world view to adopt. Nothing in the failure named the limit.
 *
 * The default is the production value, so an unset or unreadable environment is
 * the strict one, and `docker-compose.test.yml` is the only place that raises
 * it. Raised rather than switched off: a runaway loop should still be stopped
 * by something.
 */
export function readCeiling(variable: string, production: number): number {
  const raw = process.env[variable];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : production;
}

// =============================================================================
// Auth Rate Limiters (strict)
// =============================================================================

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later' },
});

export const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 refreshes per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

export const verifyEmailLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 attempts per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

export const exchangeCodeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 attempts per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

export const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 resend attempts per hour per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// =============================================================================
// Search Rate Limiter
// =============================================================================

export const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: readCeiling('RATE_LIMIT_SEARCH_MAX', 30), // 30 searches per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many search requests, please try again later' },
});

// =============================================================================
// Public Read Rate Limiter
// =============================================================================

/**
 * Public read endpoints (world views, regions, experiences, etc.)
 * Generous limit since these serve the main UI for all visitors.
 */
export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: readCeiling('RATE_LIMIT_PUBLIC_READ_MAX', 60), // 60 requests per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// =============================================================================
// Authenticated User Rate Limiter
// =============================================================================

/**
 * Authenticated user actions (visited regions, experiences, treasures, etc.)
 * Per-IP limiting for logged-in users.
 */
export const authenticatedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// =============================================================================
// Expensive Admin Operation Rate Limiter
// =============================================================================

/**
 * Admin operations that are long-running *and* destructive, where a repeat
 * request costs more than the request itself.
 *
 * A re-match deletes every `region_members` row for a world view and then spends
 * 20–130 seconds re-resolving them, holding a pool client for the write
 * transaction at the end. The endpoint already answers 409 while one is running,
 * which stops concurrent runs but not a rapid succession of them — each destroys
 * the previous one's output. The limit is deliberately small: firing this more
 * than a few times a minute is a mistake, not a workflow.
 *
 * Kept separate from `authenticatedLimiter` rather than applied to the whole
 * admin mount, because admin bulk workflows (batch match acceptance, geometry
 * compute) legitimately issue many requests in a minute and must not be caught
 * by a limit sized for this one.
 */
export const expensiveAdminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests for this operation, please try again later' },
});

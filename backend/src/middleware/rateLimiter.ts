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
  max: 30, // 30 searches per minute per IP
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
  max: 60, // 60 requests per minute per IP
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

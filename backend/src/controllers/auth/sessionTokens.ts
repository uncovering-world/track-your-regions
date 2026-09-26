/**
 * The refresh token's cookie and the one-time codes an OAuth callback hands the
 * web in its address, shared by the auth handlers.
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { REFRESH_TOKEN_EXPIRY_DAYS } from '../../services/authService.js';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// =============================================================================
// Refresh Token Cookie
// =============================================================================

const REFRESH_COOKIE_NAME = 'tyr-refresh-token';

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? 'strict' : 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? 'strict' : 'lax',
    path: '/api/auth',
  });
}

/** Read refresh token from cookie, falling back to request body for migration */
export function getRefreshToken(req: Request): string | null {
  return req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken || null;
}

// =============================================================================
// OAuth Authorization Code Exchange
// =============================================================================

interface PendingAuthCode {
  accessToken: string;
  refreshToken: string;
  createdAt: number;
}

const AUTH_CODE_TTL_MS = 60_000; // 60 seconds
const pendingAuthCodes = new Map<string, PendingAuthCode>();

export function createAuthCode(accessToken: string, refreshToken: string): string {
  const code = crypto.randomBytes(32).toString('hex');
  pendingAuthCodes.set(code, { accessToken, refreshToken, createdAt: Date.now() });
  return code;
}

export function consumeAuthCode(code: string): PendingAuthCode | null {
  const entry = pendingAuthCodes.get(code);
  if (!entry) return null;
  pendingAuthCodes.delete(code);
  if (Date.now() - entry.createdAt > AUTH_CODE_TTL_MS) return null;
  return entry;
}

// Periodic cleanup of expired codes (every 5 minutes); unref'd, so it holds
// no process open that has nothing else to do.
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of pendingAuthCodes) {
    if (now - entry.createdAt > AUTH_CODE_TTL_MS) {
      pendingAuthCodes.delete(code);
    }
  }
}, 5 * 60 * 1000).unref();

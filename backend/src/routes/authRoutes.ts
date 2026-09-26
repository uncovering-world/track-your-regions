/**
 * Authentication routes, mounted at /api/auth (ADR-0071).
 *
 * Every answer that hands the caller an access token declares the `token`
 * cache policy — `routerOf` refuses one whose response schema declares
 * `accessToken` and says anything else. The refresh cookie is the handlers'
 * own (`controllers/auth/sessionTokens.ts`); its path is this prefix, which
 * the compression filter keys on as well (`middleware/compression.ts`).
 */

import { defineRoute, REDIRECT, routerOf } from '../api/route.js';
import {
  AuthMessage, CodeExchanged, LoggedOut, PasswordChanged, PublicUser, SessionStarted,
} from '../api/responses/auth.js';
import {
  changePassword, exchangeCode, getProfile, login, logout, refresh, register, resendVerification, verifyEmail,
} from '../controllers/auth/authController.js';
import { finishApple, finishGoogle, startApple, startGoogle } from '../controllers/auth/oauthController.js';
import {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  exchangeCodeLimiter,
  resendLimiter,
} from '../middleware/rateLimiter.js';
import {
  changePasswordSchema, exchangeCodeSchema, googleStartQuerySchema, loginSchema, registerSchema,
  resendVerificationSchema, verifyEmailSchema,
} from '../types/auth.js';

export const authRoutes = [
  // ===========================================================================
  // Email/Password Authentication
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/register', access: 'public', cache: 'no-store', limiter: registerLimiter,
    body: registerSchema,
    response: AuthMessage,
    handler: register,
  }),
  defineRoute({
    method: 'post', path: '/login', access: 'public', cache: 'token', limiter: loginLimiter,
    body: loginSchema,
    response: SessionStarted,
    handler: login,
  }),

  // ===========================================================================
  // Email Verification
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/verify-email', access: 'public', cache: 'token', limiter: verifyEmailLimiter,
    body: verifyEmailSchema,
    response: SessionStarted,
    handler: verifyEmail,
  }),
  defineRoute({
    method: 'post', path: '/resend-verification', access: 'public', cache: 'no-store', limiter: resendLimiter,
    body: resendVerificationSchema,
    response: AuthMessage,
    handler: resendVerification,
  }),

  // ===========================================================================
  // The session
  // ===========================================================================
  // The refresh token rides in the httpOnly cookie (or, for migration, the
  // body), which the handler reads from the request itself.
  defineRoute({
    method: 'post', path: '/refresh', access: 'public', cache: 'token', limiter: refreshLimiter,
    response: SessionStarted,
    handler: refresh,
  }),
  // Public: it revokes whatever the request carries — the access token in the
  // header, the refresh token in the cookie — and answers the same either way.
  defineRoute({
    method: 'post', path: '/logout', access: 'public', cache: 'no-store',
    response: LoggedOut,
    handler: logout,
  }),
  defineRoute({
    method: 'get', path: '/me', access: 'signed-in', cache: 'no-store',
    response: PublicUser,
    handler: getProfile,
  }),

  // ===========================================================================
  // Password Change
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/change-password', access: 'signed-in', cache: 'token',
    body: changePasswordSchema,
    response: PasswordChanged,
    handler: changePassword,
  }),

  // ===========================================================================
  // OAuth Authorization Code Exchange
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/exchange-code', access: 'public', cache: 'token', limiter: exchangeCodeLimiter,
    body: exchangeCodeSchema,
    response: CodeExchanged,
    handler: exchangeCode,
  }),

  // ===========================================================================
  // Google OAuth and Apple Sign-In: passport answers each with a redirect
  // ===========================================================================
  defineRoute({
    method: 'get', path: '/google', access: 'public', cache: 'no-store',
    query: googleStartQuerySchema,
    response: REDIRECT,
    handler: startGoogle,
  }),
  // The provider's own query (the code, the state) is passport's to read.
  defineRoute({
    method: 'get', path: '/google/callback', access: 'public', cache: 'no-store',
    response: REDIRECT,
    handler: finishGoogle,
  }),
  defineRoute({
    method: 'get', path: '/apple', access: 'public', cache: 'no-store',
    response: REDIRECT,
    handler: startApple,
  }),
  // Apple answers with a POST whose form body passport reads itself.
  defineRoute({
    method: 'post', path: '/apple/callback', access: 'public', cache: 'no-store',
    response: REDIRECT,
    handler: finishApple,
  }),
];

export default routerOf(authRoutes);

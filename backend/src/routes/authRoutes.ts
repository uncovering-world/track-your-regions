/**
 * Authentication routes, mounted at /api/auth (ADR-0071).
 *
 * Every answer that hands the caller an access token declares the `token`
 * cache policy — `routerOf` refuses one whose response schema declares
 * `accessToken` and says anything else. The refresh cookie is the handlers'
 * own (`controllers/auth/sessionTokens.ts`); its path is this prefix, which
 * the compression filter keys on as well (`middleware/compression.ts`).
 */

import { defineRoute, REDIRECT } from '../api/route.js';
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
    summary: 'Create an email/password account and send its verification email',
    body: registerSchema,
    response: AuthMessage,
    handler: register,
  }),
  defineRoute({
    method: 'post', path: '/login', access: 'public', cache: 'token', limiter: loginLimiter,
    summary: 'Sign in with email and password and set the refresh-token cookie',
    body: loginSchema,
    response: SessionStarted,
    handler: login,
  }),

  // ===========================================================================
  // Email Verification
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/verify-email', access: 'public', cache: 'token', limiter: verifyEmailLimiter,
    summary: 'Verify an email address from its link token and sign the user in',
    body: verifyEmailSchema,
    response: SessionStarted,
    handler: verifyEmail,
  }),
  defineRoute({
    method: 'post', path: '/resend-verification', access: 'public', cache: 'no-store', limiter: resendLimiter,
    summary: 'Send a fresh verification email to an unverified account',
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
    summary: 'Rotate the refresh-token cookie and issue a new access token',
    response: SessionStarted,
    handler: refresh,
  }),
  // Public: it revokes whatever the request carries — the access token in the
  // header, the refresh token in the cookie — and answers the same either way.
  defineRoute({
    method: 'post', path: '/logout', access: 'public', cache: 'no-store',
    summary: 'Sign out: revoke the tokens the request carries and clear the refresh-token cookie',
    response: LoggedOut,
    handler: logout,
  }),
  defineRoute({
    method: 'get', path: '/me', access: 'signed-in', cache: 'no-store',
    summary: 'Get the profile of the signed-in user',
    response: PublicUser,
    handler: getProfile,
  }),

  // ===========================================================================
  // Password Change
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/change-password', access: 'signed-in', cache: 'token',
    summary: 'Change the password, sign out other sessions and issue new tokens',
    body: changePasswordSchema,
    response: PasswordChanged,
    handler: changePassword,
  }),

  // ===========================================================================
  // OAuth Authorization Code Exchange
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/exchange-code', access: 'public', cache: 'token', limiter: exchangeCodeLimiter,
    summary: 'Exchange a one-time sign-in code for an access token and refresh cookie',
    body: exchangeCodeSchema,
    response: CodeExchanged,
    handler: exchangeCode,
  }),

  // ===========================================================================
  // Google OAuth and Apple Sign-In: passport answers each with a redirect
  // ===========================================================================
  defineRoute({
    method: 'get', path: '/google', access: 'public', cache: 'no-store',
    summary: 'Start Google sign-in by redirecting to Google',
    query: googleStartQuerySchema,
    response: REDIRECT,
    handler: startGoogle,
  }),
  defineRoute({
    method: 'get', path: '/google/callback', access: 'public', cache: 'no-store',
    summary: 'Finish Google sign-in and redirect to the web with a one-time code',
    foreignQuery: 'Google writes this query on its redirect (the code, the state, the scope and whatever it adds), and passport reads it',
    response: REDIRECT,
    handler: finishGoogle,
  }),
  defineRoute({
    method: 'get', path: '/apple', access: 'public', cache: 'no-store',
    summary: 'Start Sign in with Apple by redirecting to Apple',
    response: REDIRECT,
    handler: startApple,
  }),
  // Apple answers with a POST whose form body passport reads itself.
  defineRoute({
    method: 'post', path: '/apple/callback', access: 'public', cache: 'no-store',
    summary: 'Finish Sign in with Apple and redirect to the web with a one-time code',
    response: REDIRECT,
    handler: finishApple,
  }),
];


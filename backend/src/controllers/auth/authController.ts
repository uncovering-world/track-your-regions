/**
 * Email/password sign-in, the session's tokens, and the account's password
 * (ADR-0071: each handler takes its parsed input and returns its body).
 *
 * A handler that decides a session sets or clears the refresh cookie on the
 * exchange's response; the access token goes in the body, whose route declares
 * the `token` cache policy.
 */

import passport from 'passport';
import type { z } from 'zod/v4';
import type { RouteExchange } from '../../api/route.js';
import type { AuthMessage, CodeExchanged, LoggedOut, PasswordChanged, PublicUser, SessionStarted } from '../../api/responses/auth.js';
import { badRequest, createError, failure, notFound } from '../../middleware/errorHandler.js';
import {
  hashPassword,
  verifyPassword,
  findUserByEmail,
  createUser,
  generateAccessToken,
  generateTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  findUserById,
  toPublicUser,
  verifyRefreshToken,
  getPasswordHash,
  updatePasswordHash,
  checkBreachedPassword,
  blacklistAccessToken,
  createVerificationToken,
  verifyEmailToken,
  deleteVerificationTokensForUser,
} from '../../services/authService.js';
import { sendVerificationEmail } from '../../services/emailService.js';
import type {
  changePasswordSchema, exchangeCodeSchema, loginSchema, registerSchema, resendVerificationSchema, verifyEmailSchema,
} from '../../types/auth.js';
import { clearRefreshCookie, consumeAuthCode, getRefreshToken, setRefreshCookie } from './sessionTokens.js';

/** The sentence a breached password is refused with, naming how often it leaked. */
function breachedPassword(breachCount: number): Error {
  return badRequest(
    `This password has appeared in ${breachCount.toLocaleString()} data breaches. Please choose a different password.`,
  );
}

// =============================================================================
// Email/Password Authentication
// =============================================================================

/**
 * POST /api/auth/register
 * Register a new user with email/password.
 * Always returns the same response regardless of whether the email exists
 * (credential enumeration resistance — OWASP ASVS V6.5.1).
 * No auto-login; user must verify email first.
 */
export async function register(
  { body: { email, password, displayName } }: { body: z.output<typeof registerSchema> },
): Promise<AuthMessage> {
  let breachCount = 0;
  try {
    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      // If existing user is unverified and local, silently resend verification
      if (!existingUser.emailVerified && existingUser.authProvider === 'local') {
        try {
          await deleteVerificationTokensForUser(existingUser.id);
          const token = await createVerificationToken(existingUser.id);
          await sendVerificationEmail(email, token);
        } catch {
          // Silently fail — don't leak that the account exists
        }
      }
      // Always return the same response (no 409, no leak), below
    } else {
      // Check against breached password database (HIBP k-Anonymity)
      breachCount = await checkBreachedPassword(password);
      if (breachCount === 0) {
        const passwordHash = await hashPassword(password);
        const user = await createUser({
          email,
          passwordHash,
          displayName,
          authProvider: 'local',
          emailVerified: false,
        });

        // Create verification token and send email
        const token = await createVerificationToken(user.id);
        await sendVerificationEmail(email, token);
      }
    }
  } catch (error) {
    console.error('Registration error:', error);
    throw failure('Registration failed', 500);
  }
  if (breachCount > 0) throw breachedPassword(breachCount);

  return { message: 'Check your email to verify your account' };
}

/**
 * POST /api/auth/login
 * Login with email/password.
 * Rejects unverified local accounts with a specific error code so the
 * frontend can show a "resend verification email" option.
 */
export async function login(
  _input: { body: z.output<typeof loginSchema> },
  { req, res }: RouteExchange,
): Promise<SessionStarted> {
  // The local strategy reads the body passport sees; the schema has already
  // held it to an email and a password.
  let user: Express.User | false;
  try {
    user = await new Promise<Express.User | false>((resolve, reject) => {
      passport.authenticate('local', { session: false }, (err: Error | null, found: Express.User | false) => {
        if (err) reject(err);
        else resolve(found);
      })(req, res, reject);
    });
  } catch (error) {
    console.error('Login error:', error);
    throw failure('Authentication failed', 500);
  }

  // The strategy says the same of every refusal, so as not to tell which
  // part was wrong; a fixed sentence keeps it that way whatever it passes.
  if (!user) throw createError('Invalid email or password', 401);

  const fullUser = await findUserById(user.id).catch((error: unknown) => {
    console.error('Login error:', error);
    throw failure('Login failed', 500);
  });
  if (!fullUser) throw failure('User not found', 500);

  // Block login for unverified local accounts
  if (!fullUser.emailVerified && fullUser.authProvider === 'local') {
    throw failure('Please verify your email before logging in', 403, 'EMAIL_NOT_VERIFIED');
  }

  let accessToken: string;
  try {
    const tokens = await generateTokenPair(fullUser);
    setRefreshCookie(res, tokens.refreshToken);
    accessToken = tokens.accessToken;
  } catch (error) {
    console.error('Login error:', error);
    throw failure('Login failed', 500);
  }
  return { accessToken, user: toPublicUser(fullUser) };
}

// =============================================================================
// Email Verification
// =============================================================================

/**
 * POST /api/auth/verify-email
 * Verify email address using the token from the verification link.
 * On success: auto-logs in the user (generates token pair).
 */
export async function verifyEmail(
  { body: { token } }: { body: z.output<typeof verifyEmailSchema> },
  { res }: RouteExchange,
): Promise<SessionStarted> {
  let user: Awaited<ReturnType<typeof verifyEmailToken>>;
  try {
    user = await verifyEmailToken(token);
  } catch (error) {
    console.error('Email verification error:', error);
    throw failure('Email verification failed', 500);
  }
  if (!user) throw badRequest('Invalid or expired verification link');

  try {
    // Generate tokens (auto-login after verification)
    const tokens = await generateTokenPair(user);
    setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: toPublicUser(user) };
  } catch (error) {
    console.error('Email verification error:', error);
    throw failure('Email verification failed', 500);
  }
}

/**
 * POST /api/auth/resend-verification
 * Resend verification email. Always returns the same response regardless
 * of whether the email exists (credential enumeration resistance).
 */
export async function resendVerification(
  { body: { email } }: { body: z.output<typeof resendVerificationSchema> },
): Promise<AuthMessage> {
  try {
    const user = await findUserByEmail(email);

    // Only resend for unverified local accounts
    if (user && !user.emailVerified && user.authProvider === 'local') {
      await deleteVerificationTokensForUser(user.id);
      const token = await createVerificationToken(user.id);
      await sendVerificationEmail(email, token);
    }
  } catch (error) {
    console.error('Resend verification error:', error);
    throw failure('Failed to resend verification email', 500);
  }
  // Always return the same response (credential enumeration resistance)
  return { message: 'If an account exists with this email, a verification link has been sent' };
}

// =============================================================================
// The session
// =============================================================================

/**
 * POST /api/auth/refresh
 * Rotate tokens (refresh token rotation)
 * Reads refresh token from httpOnly cookie (or body for migration)
 */
export async function refresh(_input: unknown, { req, res }: RouteExchange): Promise<SessionStarted> {
  const refreshToken = getRefreshToken(req);
  if (!refreshToken) throw createError('No refresh token provided', 401);

  // A refused token clears the cookie with its 401, so the web stops offering it.
  const refuse = (sentence: string): Error => {
    clearRefreshCookie(res);
    return createError(sentence, 401);
  };

  try {
    // Verify and get user ID from refresh token
    const tokenData = await verifyRefreshToken(refreshToken);
    if (!tokenData) throw refuse('Invalid or expired refresh token');

    const user = await findUserById(tokenData.userId);
    if (!user) throw refuse('User not found');

    // Rotate refresh token (revoke old, create new)
    const newRefreshToken = await rotateRefreshToken(refreshToken);
    if (!newRefreshToken) throw refuse('Token rotation failed');

    // Generate new access token (refresh token already created by rotateRefreshToken)
    const accessToken = generateAccessToken(user);
    setRefreshCookie(res, newRefreshToken);
    return { accessToken, user: toPublicUser(user) };
  } catch (error) {
    if ((error as { statusCode?: unknown }).statusCode === 401) throw error;
    console.error('Refresh error:', error);
    throw failure('Token refresh failed', 500);
  }
}

/**
 * POST /api/auth/logout
 * Invalidate refresh token and clear cookie
 */
export async function logout(_input: unknown, { req, res }: RouteExchange): Promise<LoggedOut> {
  try {
    // Blacklist the access token so it can't be used for the remaining ~15 min (V7.3.5)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      blacklistAccessToken(authHeader.substring(7));
    }

    const refreshToken = getRefreshToken(req);
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
  } catch (error) {
    console.error('Logout error:', error);
    // Still answer success - we don't want to leak info
  }
  clearRefreshCookie(res);
  return { success: true };
}

/**
 * GET /api/auth/me
 * Get current user profile
 */
export async function getProfile({ caller }: { caller: Express.User }): Promise<PublicUser> {
  let user: Awaited<ReturnType<typeof findUserById>>;
  try {
    user = await findUserById(caller.id);
  } catch (error) {
    console.error('Get profile error:', error);
    throw failure('Failed to get profile', 500);
  }
  if (!user) throw notFound('User not found');
  return toPublicUser(user);
}

// =============================================================================
// Password Change
// =============================================================================

/**
 * POST /api/auth/change-password
 * Change password for local-auth users. Requires current password.
 * Revokes all existing refresh tokens (forces re-login on other devices).
 *
 * A wrong current password is a 401, which the web's call reads apart from an
 * expired token (`docs/tech/authentication.md` § Password Security).
 */
export async function changePassword(
  { body: { currentPassword, newPassword }, caller }: {
    body: z.output<typeof changePasswordSchema>;
    caller: Express.User;
  },
  { res }: RouteExchange,
): Promise<PasswordChanged> {
  const userId = caller.id;

  const currentHash = await getPasswordHash(userId).catch(changeFailed);
  if (!currentHash) throw badRequest('Password change is not available for OAuth accounts');

  const isValid = await verifyPassword(currentPassword, currentHash).catch(changeFailed);
  if (!isValid) throw createError('Current password is incorrect', 401);

  if (currentPassword === newPassword) {
    throw badRequest('New password must be different from current password');
  }

  const breachCount = await checkBreachedPassword(newPassword).catch(changeFailed);
  if (breachCount > 0) throw breachedPassword(breachCount);

  try {
    const newHash = await hashPassword(newPassword);
    await updatePasswordHash(userId, newHash);

    // Revoke all refresh tokens (forces re-login on all devices)
    await revokeAllUserRefreshTokens(userId);
  } catch (error) {
    changeFailed(error);
  }

  // Issue new tokens for the current session
  const user = await findUserById(userId).catch(changeFailed);
  if (!user) throw failure('User not found', 500);

  try {
    const tokens = await generateTokenPair(user);
    setRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      message: 'Password changed successfully. All other sessions have been logged out.',
    };
  } catch (error) {
    return changeFailed(error);
  }
}

function changeFailed(error: unknown): never {
  console.error('Change password error:', error);
  throw failure('Password change failed', 500);
}

// =============================================================================
// OAuth Authorization Code Exchange
// =============================================================================

/**
 * POST /api/auth/exchange-code
 * Exchange a one-time authorization code for tokens.
 * Sets refresh token as httpOnly cookie, returns access token in body.
 */
export async function exchangeCode(
  { body: { code } }: { body: z.output<typeof exchangeCodeSchema> },
  { res }: RouteExchange,
): Promise<CodeExchanged> {
  const pending = consumeAuthCode(code);
  if (!pending) throw createError('Invalid or expired authorization code', 401);

  setRefreshCookie(res, pending.refreshToken);
  return { accessToken: pending.accessToken };
}


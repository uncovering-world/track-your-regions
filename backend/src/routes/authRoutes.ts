import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import passport from 'passport';
import {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  exchangeCodeLimiter,
  resendLimiter,
} from '../middleware/rateLimiter.js';
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
  REFRESH_TOKEN_EXPIRY_DAYS,
} from '../services/authService.js';
import { sendVerificationEmail } from '../services/emailService.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { validate } from '../middleware/errorHandler.js';
import { registerSchema, loginSchema, changePasswordSchema, verifyEmailSchema, resendVerificationSchema } from '../types/auth.js';

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// =============================================================================
// Refresh Token Cookie Helpers
// =============================================================================

const REFRESH_COOKIE_NAME = 'tyr-refresh-token';

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? 'strict' : 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? 'strict' : 'lax',
    path: '/api/auth',
  });
}

/** Read refresh token from cookie, falling back to request body for migration */
function getRefreshToken(req: Request): string | null {
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

function createAuthCode(accessToken: string, refreshToken: string): string {
  const code = crypto.randomBytes(32).toString('hex');
  pendingAuthCodes.set(code, { accessToken, refreshToken, createdAt: Date.now() });
  return code;
}

function consumeAuthCode(code: string): PendingAuthCode | null {
  const entry = pendingAuthCodes.get(code);
  if (!entry) return null;
  pendingAuthCodes.delete(code);
  if (Date.now() - entry.createdAt > AUTH_CODE_TTL_MS) return null;
  return entry;
}

// Periodic cleanup of expired codes (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of pendingAuthCodes) {
    if (now - entry.createdAt > AUTH_CODE_TTL_MS) {
      pendingAuthCodes.delete(code);
    }
  }
}, 5 * 60 * 1000);

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
router.post('/register', registerLimiter, validate(registerSchema), async (req: Request, res: Response): Promise<void> => {
  const REGISTER_SUCCESS_MESSAGE = 'Check your email to verify your account';

  try {
    const { email, password, displayName } = req.body;

    // Check if email already exists
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
      // Always return the same response (no 409, no leak)
      res.json({ message: REGISTER_SUCCESS_MESSAGE });
      return;
    }

    // Check against breached password database (HIBP k-Anonymity)
    const breachCount = await checkBreachedPassword(password);
    if (breachCount > 0) {
      res.status(400).json({
        error: `This password has appeared in ${breachCount.toLocaleString()} data breaches. Please choose a different password.`,
      });
      return;
    }

    // Hash password and create user (email_verified = false)
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

    res.json({ message: REGISTER_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 * Login with email/password.
 * Rejects unverified local accounts with a specific error code so the
 * frontend can show a "resend verification email" option.
 */
router.post('/login', loginLimiter, validate(loginSchema), (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate('local', { session: false }, async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication failed' });
    }

    if (!user) {
      return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    }

    try {
      // Get full user data for token generation
      const fullUser = await findUserById(user.id);
      if (!fullUser) {
        return res.status(500).json({ error: 'User not found' });
      }

      // Block login for unverified local accounts
      if (!fullUser.emailVerified && fullUser.authProvider === 'local') {
        return res.status(403).json({
          error: 'Please verify your email before logging in',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }

      const tokens = await generateTokenPair(fullUser);

      // Set refresh token as httpOnly cookie
      setRefreshCookie(res, tokens.refreshToken);

      return res.json({
        accessToken: tokens.accessToken,
        user: toPublicUser(fullUser),
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ error: 'Login failed' });
    }
  })(req, res, next);
});

// =============================================================================
// Email Verification
// =============================================================================

/**
 * POST /api/auth/verify-email
 * Verify email address using the token from the verification link.
 * On success: auto-logs in the user (generates token pair).
 */
router.post('/verify-email', verifyEmailLimiter, validate(verifyEmailSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;

    const user = await verifyEmailToken(token);
    if (!user) {
      res.status(400).json({ error: 'Invalid or expired verification link' });
      return;
    }

    // Generate tokens (auto-login after verification)
    const tokens = await generateTokenPair(user);
    setRefreshCookie(res, tokens.refreshToken);

    res.json({
      accessToken: tokens.accessToken,
      user: toPublicUser(user),
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend verification email. Always returns the same response regardless
 * of whether the email exists (credential enumeration resistance).
 */
router.post('/resend-verification', resendLimiter, validate(resendVerificationSchema), async (req: Request, res: Response): Promise<void> => {
  const RESEND_MESSAGE = 'If an account exists with this email, a verification link has been sent';

  try {
    const { email } = req.body;

    const user = await findUserByEmail(email);

    // Only resend for unverified local accounts
    if (user && !user.emailVerified && user.authProvider === 'local') {
      await deleteVerificationTokensForUser(user.id);
      const token = await createVerificationToken(user.id);
      await sendVerificationEmail(email, token);
    }

    // Always return the same response (credential enumeration resistance)
    res.json({ message: RESEND_MESSAGE });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

/**
 * POST /api/auth/refresh
 * Rotate tokens (refresh token rotation)
 * Reads refresh token from httpOnly cookie (or body for migration)
 */
router.post('/refresh', refreshLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = getRefreshToken(req);
    if (!refreshToken) {
      res.status(401).json({ error: 'No refresh token provided' });
      return;
    }

    // Verify and get user ID from refresh token
    const tokenData = await verifyRefreshToken(refreshToken);
    if (!tokenData) {
      clearRefreshCookie(res);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    // Get user
    const user = await findUserById(tokenData.userId);
    if (!user) {
      clearRefreshCookie(res);
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Rotate refresh token (revoke old, create new)
    const newRefreshToken = await rotateRefreshToken(refreshToken);
    if (!newRefreshToken) {
      clearRefreshCookie(res);
      res.status(401).json({ error: 'Token rotation failed' });
      return;
    }

    // Generate new access token (refresh token already created by rotateRefreshToken)
    const accessToken = generateAccessToken(user);

    // Set new refresh token as httpOnly cookie
    setRefreshCookie(res, newRefreshToken);

    res.json({
      accessToken,
      user: toPublicUser(user),
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * POST /api/auth/logout
 * Invalidate refresh token and clear cookie
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
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

    clearRefreshCookie(res);
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success and clear cookie - we don't want to leak info
    clearRefreshCookie(res);
    res.json({ success: true });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await findUserById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(toPublicUser(user));
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// =============================================================================
// Password Change
// =============================================================================

/**
 * POST /api/auth/change-password
 * Change password for local-auth users. Requires current password.
 * Revokes all existing refresh tokens (forces re-login on other devices).
 */
router.post('/change-password', requireAuth, validate(changePasswordSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.id;

    // Get current password hash
    const currentHash = await getPasswordHash(userId);
    if (!currentHash) {
      res.status(400).json({ error: 'Password change is not available for OAuth accounts' });
      return;
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, currentHash);
    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Don't allow same password
    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    // Check against breached password database
    const breachCount = await checkBreachedPassword(newPassword);
    if (breachCount > 0) {
      res.status(400).json({
        error: `This password has appeared in ${breachCount.toLocaleString()} data breaches. Please choose a different password.`,
      });
      return;
    }

    // Hash and update
    const newHash = await hashPassword(newPassword);
    await updatePasswordHash(userId, newHash);

    // Revoke all refresh tokens (forces re-login on all devices)
    await revokeAllUserRefreshTokens(userId);

    // Issue new tokens for the current session
    const user = await findUserById(userId);
    if (!user) {
      res.status(500).json({ error: 'User not found' });
      return;
    }

    const tokens = await generateTokenPair(user);
    setRefreshCookie(res, tokens.refreshToken);

    res.json({
      accessToken: tokens.accessToken,
      message: 'Password changed successfully. All other sessions have been logged out.',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// =============================================================================
// OAuth Authorization Code Exchange
// =============================================================================

/**
 * POST /api/auth/exchange-code
 * Exchange a one-time authorization code for tokens.
 * Sets refresh token as httpOnly cookie, returns access token in body.
 */
router.post('/exchange-code', exchangeCodeLimiter, async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Authorization code is required' });
    return;
  }

  const pending = consumeAuthCode(code);
  if (!pending) {
    res.status(401).json({ error: 'Invalid or expired authorization code' });
    return;
  }

  // Set refresh token as httpOnly cookie
  setRefreshCookie(res, pending.refreshToken);

  res.json({ accessToken: pending.accessToken });
});

// =============================================================================
// Google OAuth
// =============================================================================

/**
 * GET /api/auth/google
 * Redirect to Google for authentication
 * Query params:
 *   - login_hint: Pre-fill the email field for faster re-login
 */
router.get('/google', (req: Request, res: Response, next: NextFunction): void => {
  const loginHint = req.query.login_hint as string | undefined;

  const authOptions: passport.AuthenticateOptions = {
    session: false,
    scope: ['profile', 'email'],
  };

  // Pass login_hint to Google to pre-select the account
  if (loginHint) {
    (authOptions as Record<string, unknown>).loginHint = loginHint;
  }

  passport.authenticate('google', authOptions)(req, res, next);
});

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback — redirects with one-time auth code
 */
router.get('/google/callback', (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate('google', { session: false }, async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
    if (err || !user) {
      const errorMessage = encodeURIComponent(info?.message || err?.message || 'Authentication failed');
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=${errorMessage}`);
    }

    try {
      const fullUser = await findUserById(user.id);
      if (!fullUser) {
        return res.redirect(`${FRONTEND_URL}/auth/callback?error=User%20not%20found`);
      }

      const tokens = await generateTokenPair(fullUser);

      // Create a one-time auth code instead of passing tokens in URL
      const code = createAuthCode(tokens.accessToken, tokens.refreshToken);

      return res.redirect(`${FRONTEND_URL}/auth/callback?code=${code}`);
    } catch (error) {
      console.error('Google callback error:', error);
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=Authentication%20failed`);
    }
  })(req, res, next);
});

// =============================================================================
// Apple Sign-In
// =============================================================================

/**
 * GET /api/auth/apple
 * Redirect to Apple for authentication
 *
 * TODO: This is UNTESTED as it requires an Apple Developer account.
 * The route is included for completeness and follows the same pattern as Google.
 */
router.get('/apple', passport.authenticate('apple', { session: false }));

/**
 * POST /api/auth/apple/callback
 * Handle Apple Sign-In callback (Apple uses POST, not GET)
 * Redirects with one-time auth code
 *
 * TODO: This is UNTESTED as it requires an Apple Developer account.
 */
router.post('/apple/callback', (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate('apple', { session: false }, async (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
    if (err || !user) {
      const errorMessage = encodeURIComponent(info?.message || err?.message || 'Authentication failed');
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=${errorMessage}`);
    }

    try {
      const fullUser = await findUserById(user.id);
      if (!fullUser) {
        return res.redirect(`${FRONTEND_URL}/auth/callback?error=User%20not%20found`);
      }

      const tokens = await generateTokenPair(fullUser);

      // Create a one-time auth code instead of passing tokens in URL
      const code = createAuthCode(tokens.accessToken, tokens.refreshToken);

      return res.redirect(`${FRONTEND_URL}/auth/callback?code=${code}`);
    } catch (error) {
      console.error('Apple callback error:', error);
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=Authentication%20failed`);
    }
  })(req, res, next);
});

export default router;

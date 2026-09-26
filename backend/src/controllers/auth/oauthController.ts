/**
 * Sign-in with Google and Apple (ADR-0071). Each handler hands the request to
 * passport, which answers with a redirect — to the provider on the way out, and
 * back to the web with a one-time code (or a refusal) on the way in — so each
 * route declares `REDIRECT` and its handler waits on `whenAnswered`.
 */

import passport from 'passport';
import type { z } from 'zod/v4';
import { whenAnswered, type RouteExchange } from '../../api/route.js';
import { findUserById, generateTokenPair } from '../../services/authService.js';
import { oauthRefusal } from '../../auth/strategies/oauthRefusals.js';
import type { googleStartQuerySchema } from '../../types/auth.js';
import { createAuthCode } from './sessionTokens.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

type Provider = 'google' | 'apple';

/**
 * GET /api/auth/google
 * Redirect to Google for authentication; `login_hint` pre-fills the email field
 * for a faster re-login.
 */
export async function startGoogle(
  { query: { login_hint: loginHint } }: { query: z.output<typeof googleStartQuerySchema> },
  { req, res }: RouteExchange,
): Promise<void> {
  const authOptions: passport.AuthenticateOptions = {
    session: false,
    scope: ['profile', 'email'],
  };

  // Pass login_hint to Google to pre-select the account
  if (loginHint) {
    (authOptions as Record<string, unknown>).loginHint = loginHint;
  }

  await whenAnswered(res, next => passport.authenticate('google', authOptions)(req, res, next));
}

/**
 * GET /api/auth/apple
 * Redirect to Apple for authentication
 *
 * NOTE: This is UNTESTED as it requires an Apple Developer account.
 * The route follows the same pattern as Google.
 */
export async function startApple(_input: unknown, { req, res }: RouteExchange): Promise<void> {
  await whenAnswered(res, next => passport.authenticate('apple', { session: false })(req, res, next));
}

/**
 * The provider's answer, turned into a redirect to the web: a one-time code
 * the web exchanges for tokens (`POST /api/auth/exchange-code`), never the
 * tokens themselves in the address, or a refusal.
 */
function finishWith(provider: Provider, { req, res }: RouteExchange): Promise<void> {
  const label = provider === 'google' ? 'Google' : 'Apple';
  return whenAnswered(res, next => passport.authenticate(provider, { session: false }, async (
    err: Error | null, user: Express.User | false, info: { message: string } | undefined,
  ) => {
    if (err || !user) {
      if (err) console.error('[OAuth] %s sign-in failed:', label, err);
      // Only the strategy's own refusals reach the address bar: a thrown
      // error's text, or a provider's error_description that passport hands
      // over as info.message, would sit in it, the history and the referer
      // (#1021).
      const refusal = oauthRefusal(info);
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(refusal)}`);
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
      console.error('%s callback error:', label, error);
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=Authentication%20failed`);
    }
  })(req, res, next));
}

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback — redirects with one-time auth code
 */
export async function finishGoogle(_input: unknown, exchange: RouteExchange): Promise<void> {
  await finishWith('google', exchange);
}

/**
 * POST /api/auth/apple/callback
 * Handle Apple Sign-In callback (Apple uses POST, not GET), whose form body
 * passport reads itself. Redirects with one-time auth code.
 *
 * NOTE: This is UNTESTED as it requires an Apple Developer account.
 */
export async function finishApple(_input: unknown, exchange: RouteExchange): Promise<void> {
  await finishWith('apple', exchange);
}

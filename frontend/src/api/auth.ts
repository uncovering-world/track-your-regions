/**
 * Authentication API functions
 */

import type {
  AuthMessage, CodeExchanged, MyAccount, PasswordChanged, PublicUser, SessionStarted,
} from './client.generated';
import { API_URL, ApiError } from './fetchUtils';
import {
  getAuthMe, getGetAuthAppleUrl, getGetAuthGoogleUrl, getUsersMe, postAuthChangePassword, postAuthExchangeCode,
  postAuthLogin, postAuthLogout, postAuthRegister, postAuthResendVerification, postAuthVerifyEmail,
  type ChangePasswordBody,
} from './client.generated';
import type { LoginCredentials, RegisterCredentials } from '../types/auth';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call. None of them carries a
// refresh token: that travels only in its httpOnly cookie.
export type {
  AuthMessage, CodeExchanged, CuratorScope, MyAccount, PasswordChanged, PublicUser, SessionStarted,
} from './client.generated';

/** What the change-password form sends */
export type ChangePasswordInput = ChangePasswordBody;

export class AuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The calls that need no session go with the token in hand, never freshened or
 * refreshed (ADR-0073 decision 2).
 */
const AS_HELD = { tokenPolicy: 'as-held' } as const;

/** A refusal read as its sentence, or the call's own word where the server sent none. */
function refusal(error: unknown, fallback: string): Error {
  if (error instanceof ApiError) return new Error(error.sentence ?? fallback);
  return error instanceof Error ? error : new Error(fallback);
}

export async function register(credentials: RegisterCredentials): Promise<AuthMessage> {
  try {
    return await postAuthRegister(credentials, AS_HELD);
  } catch (error) {
    throw refusal(error, 'Registration failed');
  }
}

export async function login(credentials: LoginCredentials): Promise<SessionStarted> {
  try {
    return await postAuthLogin(credentials, AS_HELD);
  } catch (error) {
    // The code says why (`EMAIL_NOT_VERIFIED`), which the sign-in form answers.
    if (error instanceof ApiError) throw new AuthError(error.sentence ?? 'Login failed', error.code);
    throw error;
  }
}

export async function verifyEmail(token: string): Promise<SessionStarted> {
  try {
    return await postAuthVerifyEmail({ token }, AS_HELD);
  } catch (error) {
    throw refusal(error, 'Email verification failed');
  }
}

export async function resendVerification(email: string): Promise<AuthMessage> {
  try {
    return await postAuthResendVerification({ email }, AS_HELD);
  } catch (error) {
    throw refusal(error, 'Failed to resend verification');
  }
}

export async function exchangeAuthCode(code: string): Promise<CodeExchanged> {
  try {
    return await postAuthExchangeCode({ code }, AS_HELD);
  } catch (error) {
    throw refusal(error, 'Code exchange failed');
  }
}

/**
 * Logout: the server revokes the refresh token the cookie carries, and
 * blacklists the access token the request carries, so the session's token is
 * sent as it stands - never freshened first, which would rotate the cookie
 * being revoked (ADR-0073 decision 2, `as-held`). The caller passes it because
 * it clears its own state before the request.
 */
export async function logout(accessToken: string | null): Promise<void> {
  await postAuthLogout({
    ...AS_HELD,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  }).catch(() => {
    // Ignore errors - we're logging out anyway
  });
}

/**
 * The account a token belongs to. The OAuth flow calls it with the token it has
 * just received, before that token is the in-memory one, so it names its own
 * `Authorization`, which wins over the one held.
 */
export async function getCurrentUser(accessToken: string): Promise<PublicUser> {
  try {
    return await getAuthMe({ ...AS_HELD, headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (error) {
    throw refusal(error, 'Failed to get user profile');
  }
}

/** The signed-in account, with what a curator's assignments reach. */
export async function fetchMyAccount(): Promise<MyAccount> {
  return getUsersMe();
}

/**
 * Change the password of a local account.
 *
 * The server revokes every refresh token and issues a fresh pair for this
 * session, so the call must carry the cookie (`credentials: 'include'`) and the
 * caller must adopt the returned access token — `useAuth().changePassword` does
 * both. `message` is the server's own sentence, which names the consequence
 * (other devices signed out), so no surface has to restate it.
 *
 * Its token policy is `strict` rather than the default `session`, and this is
 * the one endpoint where that matters: a wrong *current password* answers 401,
 * the same status an expired access token gets, so the default policy would
 * read it as a dead token and try to refresh. Every wrong attempt would then rotate the
 * refresh family for nothing, and once those refreshes hit `refreshLimiter`
 * (30/min) or a flaky network, the null result makes it dispatch
 * `auth:session-expired` — signing the user out while the form says "Current
 * password is incorrect", which is precisely the message that means the session
 * is fine. Freshening the token first and reading 401 as the endpoint means it
 * keeps the two apart.
 *
 * The session can still be genuinely over, and this feature is what makes that
 * reachable: change the password on one device and every other device's refresh
 * token is revoked, so the copy of this form left open there submits into a dead
 * session. That case is decided *before* the request — no usable token means no
 * point spending one — and it is the only place a 401-shaped outcome here signs
 * the user out.
 */
export async function changePassword(input: ChangePasswordInput): Promise<PasswordChanged> {
  try {
    return await postAuthChangePassword(input, { tokenPolicy: 'strict' });
  } catch (error) {
    throw refusal(error, 'Password change failed');
  }
}

// Storage key for last used email (for login_hint)
const LAST_GOOGLE_EMAIL_KEY = 'tyr-last-google-email';

/**
 * Store the last used Google email for login_hint
 */
export function setLastGoogleEmail(email: string | null): void {
  if (email) {
    localStorage.setItem(LAST_GOOGLE_EMAIL_KEY, email);
  }
}

/**
 * Get the last used Google email for login_hint
 */
export function getLastGoogleEmail(): string | null {
  return localStorage.getItem(LAST_GOOGLE_EMAIL_KEY);
}

/**
 * Clear the last used Google email (e.g., when user wants to use different account)
 */
export function clearLastGoogleEmail(): void {
  localStorage.removeItem(LAST_GOOGLE_EMAIL_KEY);
}

/**
 * Get Google OAuth URL with optional login_hint for faster re-login
 */
export function getGoogleAuthUrl(loginHint?: string): string {
  // A navigation, so the generated builder's path behind the API's origin
  // (ADR-0073 decision 5).
  return API_URL + getGetAuthGoogleUrl(loginHint ? { login_hint: loginHint } : undefined);
}

/**
 * Get Apple OAuth URL
 * NOTE: Untested - requires Apple Developer account
 */
export function getAppleAuthUrl(): string {
  return API_URL + getGetAuthAppleUrl();
}

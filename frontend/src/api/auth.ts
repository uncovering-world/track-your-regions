/**
 * Authentication API functions
 */

import type {
  AuthMessage, CodeExchanged, MyAccount, PasswordChanged, PublicUser, SessionStarted,
} from '@tyr/shared/api';
import { API_URL, authFetchJson, requireFreshToken } from './fetchUtils';
import type { LoginCredentials, RegisterCredentials } from '../types/auth';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call. None of them carries a
// refresh token: that travels only in its httpOnly cookie.
export type {
  AuthMessage, CodeExchanged, CuratorScope, MyAccount, PasswordChanged, PublicUser, SessionStarted,
} from '@tyr/shared/api';

/** What the change-password form sends */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** Error response with optional error code */
interface ErrorResponse {
  error: string;
  code?: string;
}

/**
 * Register a new user with email/password.
 * No auto-login — returns a message telling user to check their email.
 */
export async function register(credentials: RegisterCredentials): Promise<AuthMessage> {
  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Registration failed' }));
    throw new Error(error.error || 'Registration failed');
  }

  return response.json();
}

/**
 * Custom error that includes an optional error code from the server.
 * Used to distinguish EMAIL_NOT_VERIFIED from other login failures.
 */
export class AuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Login with email/password
 * Refresh token is set as httpOnly cookie by the server.
 */
export async function login(credentials: LoginCredentials): Promise<SessionStarted> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error: ErrorResponse = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new AuthError(error.error || 'Login failed', error.code);
  }

  return response.json();
}

/**
 * Verify email address using the token from the verification link.
 * On success: auto-logs in (returns access token + user, sets refresh cookie).
 */
export async function verifyEmail(token: string): Promise<SessionStarted> {
  const response = await fetch(`${API_URL}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Email verification failed' }));
    throw new Error(error.error || 'Email verification failed');
  }

  return response.json();
}

/**
 * Resend verification email. Always returns the same message
 * regardless of whether the email exists (credential enumeration resistance).
 */
export async function resendVerification(email: string): Promise<AuthMessage> {
  const response = await fetch(`${API_URL}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to resend verification' }));
    throw new Error(error.error || 'Failed to resend verification');
  }

  return response.json();
}

/**
 * Exchange OAuth authorization code for tokens.
 * Server sets refresh token as httpOnly cookie and returns access token.
 */
export async function exchangeAuthCode(code: string): Promise<CodeExchanged> {
  const response = await fetch(`${API_URL}/api/auth/exchange-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Code exchange failed' }));
    throw new Error(error.error || 'Code exchange failed');
  }

  return response.json();
}

/**
 * Logout (invalidate refresh token via cookie)
 */
export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  }).catch(() => {
    // Ignore errors - we're logging out anyway
  });
}

/**
 * Get current user profile
 */
export async function getCurrentUser(accessToken: string): Promise<PublicUser> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get user profile');
  }

  return response.json();
}

/** The signed-in account, with what a curator's assignments reach. */
export async function fetchMyAccount(): Promise<MyAccount> {
  return authFetchJson<MyAccount>(`${API_URL}/api/users/me`);
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
 * Built by hand rather than through `authFetchJson`, and this is the one
 * endpoint where that matters: a wrong *current password* answers 401, the same
 * status an expired access token gets, so `authFetchJson` would read it as a
 * dead token and try to refresh. Every wrong attempt would then rotate the
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
  const token = await requireFreshToken();
  if (!token) {
    // Same event `authFetchJson` fires on a dead session, so the app leaves the
    // signed-in state once rather than sitting in a phantom one until some
    // other request happens to notice.
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
    throw new Error('Your session has expired. Please sign in again.');
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const response = await fetch(`${API_URL}/api/auth/change-password`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Password change failed' }));
    throw new Error(error.error || 'Password change failed');
  }

  return response.json();
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
  const baseUrl = `${API_URL}/api/auth/google`;
  if (loginHint) {
    return `${baseUrl}?login_hint=${encodeURIComponent(loginHint)}`;
  }
  return baseUrl;
}

/**
 * Get Apple OAuth URL
 * NOTE: Untested - requires Apple Developer account
 */
export function getAppleAuthUrl(): string {
  return `${API_URL}/api/auth/apple`;
}

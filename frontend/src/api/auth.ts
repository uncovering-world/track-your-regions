/**
 * Authentication API functions
 */

import { API_URL } from './fetchUtils';
import type { LoginCredentials, RegisterCredentials, User } from '../types/auth';

/** Auth response for cookie-based flow (no refresh token in body) */
export interface CookieAuthResponse {
  accessToken: string;
  user: User;
}

/** Response from register endpoint (no tokens — must verify email first) */
interface RegisterResponse {
  message: string;
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
export async function register(credentials: RegisterCredentials): Promise<RegisterResponse> {
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
export async function login(credentials: LoginCredentials): Promise<CookieAuthResponse> {
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
export async function verifyEmail(token: string): Promise<CookieAuthResponse> {
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
export async function resendVerification(email: string): Promise<{ message: string }> {
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
 * Refresh tokens via httpOnly cookie.
 * Server reads refresh token from cookie and returns new access token + sets new cookie.
 */
export async function refreshTokens(): Promise<CookieAuthResponse> {
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  return response.json();
}

/**
 * Exchange OAuth authorization code for tokens.
 * Server sets refresh token as httpOnly cookie and returns access token.
 */
export async function exchangeAuthCode(code: string): Promise<CookieAuthResponse> {
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
export async function getCurrentUser(accessToken: string): Promise<User> {
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

// Legacy functions for backward compatibility - now only used for display purposes
const LAST_EMAIL_KEY = 'tyr-last-email';

/**
 * Store the last used email (any provider) - for display in UI
 */
export function setLastUsedEmail(email: string | null): void {
  if (email) {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  }
}

/**
 * Get the last used email (any provider)
 */
export function getLastUsedEmail(): string | null {
  return localStorage.getItem(LAST_EMAIL_KEY);
}

/**
 * Clear the last used email
 */
export function clearLastUsedEmail(): void {
  localStorage.removeItem(LAST_EMAIL_KEY);
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
 * TODO: Untested - requires Apple Developer account
 */
export function getAppleAuthUrl(): string {
  return `${API_URL}/api/auth/apple`;
}

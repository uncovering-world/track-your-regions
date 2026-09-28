/**
 * Fetch utility for API calls
 */

import type { SessionStarted } from './client.generated';
import { jwtDecode } from 'jwt-decode';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const MARTIN_URL = import.meta.env.VITE_MARTIN_URL || 'http://localhost:3000';

// In-memory access token (set by auth provider)
let accessToken: string | null = null;

// Deduplicates concurrent refresh calls — only one refresh request at a time.
// Shared across authFetchJson and useAuth to prevent token rotation race conditions.
let pendingRefresh: Promise<SessionStarted | null> | null = null;

// Listener notified after every successful refresh — useAuth registers here
// so its local tokenExpiresAt + user state stays in sync when refreshSession
// is invoked from outside the hook (e.g. ensureFreshToken / authFetchJson 401
// retry). Without this, useAuth.isTokenExpired() would still see the old
// expiry and trigger a redundant refresh on the next request.
type RefreshSuccessListener = (data: SessionStarted) => void;
let onRefreshSuccess: RefreshSuccessListener | null = null;

export function setRefreshSuccessListener(listener: RefreshSuccessListener | null): void {
  onRefreshSuccess = listener;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Centralized token refresh — deduplicates concurrent calls across the entire app.
 * Both authFetchJson and useAuth must use this to prevent token rotation race conditions
 * (concurrent refreshes trigger reuse detection which revokes the entire token family).
 */
export async function refreshSession(): Promise<SessionStarted | null> {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (response.ok) {
        // The session the refresh cookie renewed, held to SessionStarted on the server.
        const data = await response.json() as SessionStarted;
        accessToken = data.accessToken;
        // Notify useAuth so it can update its local tokenExpiresAt + user state.
        onRefreshSuccess?.(data);
        return data;
      }
      return null;
    } catch {
      return null;
    } finally {
      pendingRefresh = null;
    }
  })();

  return pendingRefresh;
}

/**
 * Is the token in hand good for more than another minute?
 *
 * A token that cannot be decoded counts as not fresh — the refresh path is the
 * safe place for something unreadable to end up.
 */
function tokenIsFresh(token: string): boolean {
  return secondsLeftOn(token) > 60;
}

/**
 * Is the token in hand still accepted at all?
 *
 * Weaker than `tokenIsFresh` by exactly the 60-second margin, and the two are
 * not interchangeable: *expiring* is a reason to refresh, *spent* is a reason to
 * give up. Conflating them signs people out of live sessions.
 */
function tokenNotExpired(token: string): boolean {
  return secondsLeftOn(token) > 0;
}

/**
 * How much life the token has left, in seconds. Zero for one that cannot be
 * decoded — the refresh path is the safe place for something unreadable to end
 * up, and a token nobody can read is not one to send.
 */
function secondsLeftOn(token: string): number {
  // Decode JWT payload to check expiry (no verification needed — server validates)
  try {
    const payload = jwtDecode<{ exp?: number }>(token);
    if (!payload.exp) return 0;
    return payload.exp - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

/**
 * Ensure the access token is fresh (not expired or expiring within 60s).
 * Used before SSE connections where EventSource can't handle 401 retry.
 *
 * **Best-effort**: when the refresh fails it hands back the token it already
 * had. That is deliberate, and the 60-second margin is why — a refresh is
 * attempted while the token in hand is still valid, so a transient failure (a
 * network blip, `refreshLimiter` answering 429) leaves a token that works for
 * up to another minute, and an SSE caller that opens its stream with it gets
 * its work done. See `requireFreshToken` for the caller that must not guess.
 */
export async function ensureFreshToken(): Promise<string | null> {
  if (!accessToken) return null;
  if (tokenIsFresh(accessToken)) return accessToken;

  // Token expired or expiring soon — refresh via centralized shared refresh
  await refreshSession();
  return accessToken;
}

/**
 * The token, or `null` when there is no *live* one to send.
 *
 * The strict counterpart of `ensureFreshToken`, for the caller whose endpoint
 * answers 401 for a reason of its own (`changePassword`): a spent token there
 * collects `requireAuth`'s own 401 and turns "your session is over" into a
 * sentence about the request, and the two must not be confused.
 *
 * Strict about what is *spent*, not about what is merely *expiring*. A failed
 * refresh is not proof of anything — `refreshSession()` answers `null` for a
 * rejected refresh, for `refreshLimiter`'s 429 and for a network blip alike —
 * so a token with seconds left is still handed over: it reaches the endpoint and
 * gets the real answer. Refusing it would sign someone out of a live session
 * over a blip. The narrow window where such a token expires *in flight* is left
 * to the endpoint's own 401 — a race worth losing occasionally, against a false
 * sign-out that would happen every time.
 */
export async function requireFreshToken(): Promise<string | null> {
  if (!accessToken) return null;
  if (tokenIsFresh(accessToken)) return accessToken;

  const refreshed = await refreshSession();
  if (refreshed) return accessToken;

  return tokenNotExpired(accessToken) ? accessToken : null;
}

/**
 * A request's headers, with the token given. A caller's own `Authorization`
 * wins: `getCurrentUser` sends the token the OAuth flow has just received,
 * before it is the in-memory one (ADR-0073 decision 2).
 */
function buildJsonHeaders(options?: RequestInit, token: string | null = accessToken): Headers {
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

/**
 * A refused request: its message is the server's sentence where it sent one,
 * and `code` the machine-readable reason some answers carry
 * (`EMAIL_NOT_VERIFIED`).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's own sentence, absent where the answer carried none. */
    readonly sentence: string | undefined,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

async function parseJsonResponse<T>(response: Response, noContent: () => T): Promise<T> {
  if (response.status === 204) return noContent();
  if (!response.ok) {
    const error: { error?: string; code?: string } = await response.json().catch(() => ({}));
    throw new ApiError(error.error || `HTTP ${response.status}`, response.status, error.error, error.code);
  }
  // An image route answers a picture, which the generated types call a Blob.
  if (response.headers?.get('Content-Type')?.startsWith('image/')) return response.blob() as Promise<T>;
  return response.json();
}

/**
 * Authenticated fetch - automatically adds Bearer token.
 * On 401, attempts a silent refresh via httpOnly cookie then retries.
 */
export async function authFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  // A 204 reads as an empty list: what the list reads answer when they have nothing.
  return authFetchParsed<T>(url, options, () => [] as unknown as T);
}

async function authFetchParsed<T>(url: string, options: RequestInit | undefined, noContent: () => T): Promise<T> {
  // Proactively refresh token before it expires (prevents 401 round-trip)
  await ensureFreshToken();

  const response = await fetch(url, { ...options, headers: buildJsonHeaders(options) });
  if (response.status !== 401) return parseJsonResponse<T>(response, noContent);

  // Token may have expired, try centralized refresh. Uses shared
  // refreshSession() to prevent token rotation race conditions.
  const result = await refreshSession();
  if (!result) {
    // Session is completely dead — notify the app so useAuth can clear state.
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
    return parseJsonResponse<T>(response, noContent);
  }

  const retryResponse = await fetch(url, { ...options, headers: buildJsonHeaders(options) });
  return parseJsonResponse<T>(retryResponse, noContent);
}

/**
 * How a call carries the session's token, before the request and on a 401
 * (ADR-0073 decision 2):
 * - `session`, the default: refreshed before the call when it is about to
 *   expire, and refreshed once more and retried on a 401;
 * - `strict`: `requireFreshToken()` before the call, and a spent token ends the
 *   session without sending anything; a 401 is the endpoint's own answer
 *   (`changePassword`, whose 401 means a wrong current password);
 * - `as-held`: the token in hand, or none, never freshened and never refreshed
 *   (the calls that need no session, and logout, which must not rotate the
 *   cookie it revokes).
 */
export type TokenPolicy = 'session' | 'strict' | 'as-held';

/** What the generated client passes on: a request, and the call's token policy. */
export interface ApiRequestInit extends RequestInit {
  tokenPolicy?: TokenPolicy;
}

const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

/**
 * The one fetch the generated client calls for every request (ADR-0073).
 *
 * Orval passes the path the OpenAPI document names, with its query string, and
 * the method, headers and body; this adds the origin, the cookies and the
 * token by the call's policy, and throws an `ApiError` with the server's
 * sentence. A 204 is `undefined`, which the generated types already allow
 * wherever the document says the route may answer one. The refresh cookie is
 * scoped to `/api/auth`, so `credentials: 'include'` sends it there alone.
 */
export async function apiFetch<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const { tokenPolicy = 'session', ...init } = options;
  const url = `${API_URL}${path}`;
  const request: RequestInit = { ...init, credentials: 'include' };
  const noContent = () => undefined as T;
  if (tokenPolicy === 'session') return authFetchParsed<T>(url, request, noContent);
  if (tokenPolicy === 'strict') {
    const token = await requireFreshToken();
    if (!token) {
      // The event authFetchJson fires on a dead session, so the app leaves the
      // signed-in state once rather than sitting in a phantom one.
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
      throw new Error(SESSION_EXPIRED);
    }
    return parseJsonResponse<T>(await fetch(url, { ...request, headers: buildJsonHeaders(init, token) }), noContent);
  }
  return parseJsonResponse<T>(await fetch(url, { ...request, headers: buildJsonHeaders(init) }), noContent);
}

/**
 * Authenticated fetch returning a Blob (for image/binary endpoints).
 * Mirrors authFetchJson but returns response.blob() instead of response.json().
 */
export async function authFetchBlob(url: string, options?: RequestInit): Promise<Blob> {
  await ensureFreshToken();

  const buildHeaders = (): Headers => {
    const h = new Headers(options?.headers);
    h.delete('Content-Type');
    if (accessToken) h.set('Authorization', `Bearer ${accessToken}`);
    return h;
  };

  let response = await fetch(url, { ...options, headers: buildHeaders() });

  if (response.status === 401) {
    const result = await refreshSession();
    if (result) {
      response = await fetch(url, { ...options, headers: buildHeaders() });
    } else {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.blob();
}

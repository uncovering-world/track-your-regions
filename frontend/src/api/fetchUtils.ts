/**
 * Fetch utility for API calls
 */

import { jwtDecode } from 'jwt-decode';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const MARTIN_URL = import.meta.env.VITE_MARTIN_URL || 'http://localhost:3000';

// In-memory access token (set by auth provider)
let accessToken: string | null = null;

// Deduplicates concurrent refresh calls — only one refresh request at a time
let pendingRefresh: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Ensure the access token is fresh (not expired or expiring within 60s).
 * Used before SSE connections where EventSource can't handle 401 retry.
 */
export async function ensureFreshToken(): Promise<string | null> {
  if (!accessToken) return null;

  // Decode JWT payload to check expiry (no verification needed — server validates)
  try {
    const payload = jwtDecode<{ exp?: number }>(accessToken);
    const nowSec = Math.floor(Date.now() / 1000);
    // Refresh if token expires within 60 seconds
    if (payload.exp && payload.exp - nowSec > 60) {
      return accessToken; // Still fresh
    }
  } catch {
    // Can't decode — try refresh anyway
  }

  // Token expired or expiring soon — refresh via cookie.
  // Reuse pendingRefresh to deduplicate concurrent calls (e.g. multiple SSE connections).
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      try {
        const refreshResponse = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (refreshResponse.ok) {
          const data = await refreshResponse.json();
          accessToken = data.accessToken;
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        pendingRefresh = null;
      }
    })();
  }

  await pendingRefresh;
  return accessToken;
}

/**
 * Basic fetch without auth
 */
export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (response.status === 204) {
    return [] as unknown as T;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Authenticated fetch - automatically adds Bearer token.
 * On 401, attempts a silent refresh via httpOnly cookie then retries.
 */
export async function authFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Add auth header if we have a token
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return [] as unknown as T;
  }

  // Handle 401 - token may have expired, try cookie-based refresh.
  // Deduplicates concurrent refreshes: if multiple 401s arrive at once,
  // only the first one actually calls /refresh; the rest wait for it.
  if (response.status === 401) {
    try {
      if (!pendingRefresh) {
        pendingRefresh = (async () => {
          try {
            const refreshResponse = await fetch(`${API_URL}/api/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
            if (refreshResponse.ok) {
              const data = await refreshResponse.json();
              accessToken = data.accessToken;
              return true;
            }
            return false;
          } catch {
            return false;
          } finally {
            pendingRefresh = null;
          }
        })();
      }

      const refreshed = await pendingRefresh;
      if (refreshed) {
        // Retry the original request with the new token
        const retryHeaders = new Headers(options?.headers);
        if (!retryHeaders.has('Content-Type')) retryHeaders.set('Content-Type', 'application/json');
        retryHeaders.set('Authorization', `Bearer ${accessToken}`);
        const retryResponse = await fetch(url, { ...options, headers: retryHeaders });

        if (retryResponse.status === 204) {
          return [] as unknown as T;
        }

        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(error.error || `HTTP ${retryResponse.status}`);
        }

        return retryResponse.json();
      }
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

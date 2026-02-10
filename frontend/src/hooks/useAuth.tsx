import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import type { User, AuthState, LoginCredentials, RegisterCredentials } from '../types/auth';
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  refreshTokens,
  getCurrentUser,
  verifyEmail as apiVerifyEmail,
  setLastUsedEmail,
  setLastGoogleEmail,
} from '../api/auth';
import { setAccessToken as setGlobalAccessToken } from '../api/fetchUtils';

// =============================================================================
// JWT Payload Type
// =============================================================================

interface JWTPayload {
  sub: number;
  uuid: string;
  role: 'user' | 'curator' | 'admin';
  iat: number;
  exp: number;
}

// =============================================================================
// Context Type
// =============================================================================

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<{ message: string }>;
  verifyEmail: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | null;
  authFetch: <T>(url: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// =============================================================================
// Token Management (in-memory only — no localStorage)
// =============================================================================

let accessToken: string | null = null;
let tokenExpiresAt: number | null = null;

function isTokenExpired(): boolean {
  if (!tokenExpiresAt) return true;
  // Consider token expired 30 seconds before actual expiry
  return Date.now() >= (tokenExpiresAt - 30000);
}

function parseToken(token: string): JWTPayload | null {
  try {
    return jwtDecode<JWTPayload>(token);
  } catch {
    return null;
  }
}

// =============================================================================
// Provider Component
// =============================================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  // Derive auth state
  const isAuthenticated = user !== null;
  const isAdmin = user?.role === 'admin';
  const isCurator = user?.role === 'curator' || user?.role === 'admin';

  // ==========================================================================
  // Token Refresh (cookie-based — no localStorage)
  // ==========================================================================

  const silentRefresh = useCallback(async (): Promise<boolean> => {
    try {
      const response = await refreshTokens();

      // Update in-memory access token
      accessToken = response.accessToken;
      setGlobalAccessToken(response.accessToken);

      // Parse expiry from token
      const payload = parseToken(response.accessToken);
      if (payload) {
        tokenExpiresAt = payload.exp * 1000;
        setUser(response.user);
        return true;
      }

      return false;
    } catch {
      // Refresh failed (no cookie, expired, etc.) — clear state
      accessToken = null;
      setGlobalAccessToken(null);
      tokenExpiresAt = null;
      return false;
    }
  }, []);

  // ==========================================================================
  // Initial Load
  // ==========================================================================

  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      try {
        // Clean up any leftover localStorage refresh token from old versions
        localStorage.removeItem('tyr-refresh-token');

        const success = await silentRefresh();
        if (!success) {
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [silentRefresh]);

  // ==========================================================================
  // Auth Actions
  // ==========================================================================

  const login = useCallback(async (credentials: LoginCredentials): Promise<void> => {
    const response = await apiLogin(credentials);

    accessToken = response.accessToken;
    setGlobalAccessToken(response.accessToken);

    const payload = parseToken(response.accessToken);
    if (payload) {
      tokenExpiresAt = payload.exp * 1000;
    }

    setUser(response.user);

    // Save email for quick re-login
    if (response.user.email) {
      setLastUsedEmail(response.user.email);
    }

    // Invalidate all cached queries to refetch with new auth state
    queryClient.clear();
  }, [queryClient]);

  const register = useCallback(async (credentials: RegisterCredentials): Promise<{ message: string }> => {
    const response = await apiRegister(credentials);
    // No auto-login — user must verify email first
    return response;
  }, []);

  const verifyEmail = useCallback(async (token: string): Promise<void> => {
    const response = await apiVerifyEmail(token);

    accessToken = response.accessToken;
    setGlobalAccessToken(response.accessToken);

    const payload = parseToken(response.accessToken);
    if (payload) {
      tokenExpiresAt = payload.exp * 1000;
    }

    setUser(response.user);

    // Save email for quick re-login
    if (response.user.email) {
      setLastUsedEmail(response.user.email);
    }

    // Invalidate all cached queries to refetch with new auth state
    queryClient.clear();
  }, [queryClient]);

  const logout = useCallback(async (): Promise<void> => {
    // Clear local state first
    accessToken = null;
    setGlobalAccessToken(null);
    tokenExpiresAt = null;
    setUser(null);

    // Invalidate all cached queries to force refetch with new auth state
    queryClient.clear();

    // Then notify server (fire and forget) — server clears cookie
    await apiLogout();
  }, [queryClient]);

  // ==========================================================================
  // Token Access
  // ==========================================================================

  const getAccessToken = useCallback((): string | null => {
    return accessToken;
  }, []);

  // ==========================================================================
  // Authenticated Fetch
  // ==========================================================================

  const authFetch = useCallback(async function<T>(url: string, options: RequestInit = {}): Promise<T> {
    // Check if token needs refresh
    if (isTokenExpired()) {
      await silentRefresh();
    }

    const headers = new Headers(options.headers);
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let response = await fetch(url, { ...options, headers });

    // If 401, try to refresh and retry once
    if (response.status === 401) {
      const refreshed = await silentRefresh();
      if (refreshed) {
        headers.set('Authorization', `Bearer ${accessToken}`);
        response = await fetch(url, { ...options, headers });
      }
    }

    if (response.status === 204) {
      return [] as unknown as T;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }, [silentRefresh]);

  // ==========================================================================
  // Handle OAuth Result (called after code exchange completes)
  // ==========================================================================

  const handleOAuthResult = useCallback(async (oauthAccessToken: string): Promise<boolean> => {
    try {
      accessToken = oauthAccessToken;
      setGlobalAccessToken(oauthAccessToken);

      const payload = parseToken(oauthAccessToken);
      if (payload) {
        tokenExpiresAt = payload.exp * 1000;

        // Fetch full user profile
        const userProfile = await getCurrentUser(oauthAccessToken);
        setUser(userProfile);

        // Save email for quick re-login
        if (userProfile.email) {
          setLastUsedEmail(userProfile.email);
          if (userProfile.authProvider === 'google') {
            setLastGoogleEmail(userProfile.email);
          }
        }

        // Invalidate all cached queries to refetch with new auth state
        queryClient.clear();

        return true;
      }
    } catch (err) {
      console.error('OAuth result handling failed:', err);
    }

    return false;
  }, [queryClient]);

  // Expose handleOAuthResult on window for the callback handler
  useEffect(() => {
    (window as unknown as { handleOAuthResult: typeof handleOAuthResult }).handleOAuthResult = handleOAuthResult;
    return () => {
      delete (window as unknown as { handleOAuthResult?: typeof handleOAuthResult }).handleOAuthResult;
    };
  }, [handleOAuthResult]);

  // ==========================================================================
  // Context Value
  // ==========================================================================

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    isAdmin,
    isCurator,
    login,
    register,
    verifyEmail,
    logout,
    getAccessToken,
    authFetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

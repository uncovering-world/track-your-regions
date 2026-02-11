/**
 * Authentication types for Track Your Regions Frontend
 */

export type UserRole = 'user' | 'curator' | 'admin';
export type AuthProvider = 'local' | 'google' | 'apple';

export interface User {
  id: number;
  uuid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  avatarUrl: string | null;
  emailVerified: boolean;
  authProvider?: AuthProvider;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: User;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  displayName: string;
}

export interface CuratorScope {
  id: number;
  scopeType: 'global' | 'region' | 'category';
  regionId: number | null;
  regionName: string | null;
  categoryId: number | null;
  categoryName: string | null;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  isCurator: boolean;
}

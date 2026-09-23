/**
 * Authentication types for Track Your Regions Frontend
 */

// The two enums both sides read, declared once (ADR-0065) and held to the
// schema's own on the storing side.
import type { UserRole, AuthProvider } from '@tyr/shared/auth';
export type { UserRole, AuthProvider };

// The signed-in account is an answer, declared once as a backend schema
// (ADR-0066): `PublicUser`, re-exported from `api/auth.ts`.
import type { PublicUser } from '@tyr/shared/api';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  displayName: string;
}

export interface AuthState {
  user: PublicUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  isCurator: boolean;
}

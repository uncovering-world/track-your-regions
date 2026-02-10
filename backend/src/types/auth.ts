import { z } from 'zod';

/**
 * Authentication types for Track Your Regions
 */

// =============================================================================
// Database Types
// =============================================================================

export type UserRole = 'user' | 'curator' | 'admin';
export type AuthProvider = 'local' | 'google' | 'apple';

export type CuratorScopeType = 'region' | 'source' | 'global';

export interface CuratorScope {
  id: number;
  scopeType: CuratorScopeType;
  regionId: number | null;
  regionName: string | null;
  sourceId: number | null;
  sourceName: string | null;
  assignedAt: string;
  notes: string | null;
}

export interface User {
  id: number;
  uuid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  avatarUrl: string | null;
  authProvider: AuthProvider | null;
  providerId: string | null;
  emailVerified: boolean;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface UserAuthProvider {
  id: number;
  userId: number;
  provider: AuthProvider;
  providerId: string;
  providerEmail: string | null;
  providerData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshToken {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

// =============================================================================
// JWT Payload
// =============================================================================

export interface JWTPayload {
  sub: number;      // user.id
  uuid: string;     // user.uuid
  role: UserRole;
  iat?: number;
  exp?: number;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

export interface PublicUser {
  id: number;
  uuid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  avatarUrl: string | null;
  emailVerified: boolean;
  authProvider?: AuthProvider;
}

// =============================================================================
// Zod Schemas for Validation
// =============================================================================

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(255, 'Display name must be at most 255 characters'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

// =============================================================================
// Express Augmentation
// =============================================================================

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface User {
      id: number;
      uuid: string;
      email: string | null;
      displayName: string | null;
      role: UserRole;
      avatarUrl: string | null;
      emailVerified: boolean;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

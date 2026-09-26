import { z } from 'zod/v4';
import { COLUMN_WIDTHS, type CheckValue } from '../db/schema.generated.js';

/**
 * Authentication types for Track Your Regions
 */

// =============================================================================
// Database Types
// =============================================================================

// The two enums both sides read, declared once (ADR-0065) and held to the
// schema's own by `db/curationLogActions.test.ts`.
import type { UserRole, AuthProvider } from '@tyr/shared/auth';
export type { UserRole, AuthProvider };

/** `curator_assignments.scope_type`, as its CHECK lists it. */
export type CuratorScopeType = CheckValue<'curator_assignments', 'scope_type'>;

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

/**
 * The pair a sign-in issues. Only the access token reaches a response body
 * (`SessionStarted` in `api/responses/auth.ts`); the refresh token goes into its
 * httpOnly cookie.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// =============================================================================
// Zod Schemas for Validation
// =============================================================================

export const registerSchema = z.object({
  // 254 is the longest address SMTP will carry (RFC 5321 § 4.5.3.1.3), and it
  // is the value stored in users.email — VARCHAR(255) — so the tighter of the
  // two bounds is the real one and stays a literal on purpose.
  email: z.string().email('Invalid email address').max(254, 'Email must be at most 254 characters'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  // Trimmed first, so a name of spaces is refused rather than stored and
  // later shown as a blank curator (#998).
  displayName: z.string()
    .trim()
    .min(1, 'Display name is required')
    .max(COLUMN_WIDTHS.users.display_name, `Display name must be at most ${COLUMN_WIDTHS.users.display_name} characters`),
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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augmentation requires `namespace` syntax; module augmentation cannot extend Express.User
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

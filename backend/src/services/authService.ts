import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import type { User, JWTPayload, AuthTokens, PublicUser, UserRole, AuthProvider } from '../types/auth.js';

// =============================================================================
// Configuration
// =============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_ISSUER = 'track-your-regions';
const JWT_AUDIENCE = 'track-your-regions-app';
const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY_DAYS = 7;

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET must be set in production. Generate one with: openssl rand -base64 32');
  }
  console.warn('WARNING: Using default JWT_SECRET — set JWT_SECRET env var for production.');
}

// =============================================================================
// Password Hashing
// =============================================================================

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// =============================================================================
// Token Hashing (for refresh tokens stored in DB)
// =============================================================================

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// =============================================================================
// JWT Generation
// =============================================================================

export function generateAccessToken(user: User): string {
  const payload: JWTPayload = {
    sub: user.id,
    uuid: user.uuid,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: crypto.randomUUID(),
  });
}

// =============================================================================
// Access Token Blacklist (in-memory, for logout invalidation — ASVS V7.3.5)
// =============================================================================
// Tokens only live 15 minutes, so the blacklist stays small.
// Entries are auto-cleaned every 5 minutes to remove expired JTIs.

const tokenBlacklist = new Map<string, number>(); // jti → expiry timestamp (ms)

// Clean up expired blacklist entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of tokenBlacklist) {
    if (expiresAt <= now) {
      tokenBlacklist.delete(jti);
    }
  }
}, 5 * 60 * 1000).unref();

export function blacklistAccessToken(token: string): void {
  try {
    // Decode without verification to extract jti and exp
    const decoded = jwt.decode(token) as { jti?: string; exp?: number } | null;
    if (decoded?.jti && decoded?.exp) {
      tokenBlacklist.set(decoded.jti, decoded.exp * 1000);
    }
  } catch {
    // If decode fails, nothing to blacklist
  }
}

function isBlacklisted(jti: string): boolean {
  return tokenBlacklist.has(jti);
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as unknown as JWTPayload & { jti?: string };

    // Check blacklist (for tokens issued after this change)
    if (payload.jti && isBlacklisted(payload.jti)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// =============================================================================
// Refresh Token Management
// =============================================================================

const MAX_REFRESH_TOKENS_PER_USER = 10;

export async function createRefreshToken(userId: number, familyId?: string): Promise<string> {
  const token = generateRefreshToken();
  const tokenHash = hashToken(token);
  const family = familyId || crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, family, expiresAt]
  );

  // Enforce concurrent session limit — revoke oldest tokens beyond the cap
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       AND id NOT IN (
         SELECT id FROM refresh_tokens
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [userId, MAX_REFRESH_TOKENS_PER_USER]
  );

  return token;
}

export async function verifyRefreshToken(token: string): Promise<{ userId: number; familyId: string | null } | null> {
  const tokenHash = hashToken(token);

  const result = await pool.query(
    `SELECT user_id, family_id, revoked_at FROM refresh_tokens
     WHERE token_hash = $1
       AND expires_at > NOW()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Token reuse detection: if this token was already revoked (used),
  // an attacker may have stolen it. Revoke the entire token family.
  if (row.revoked_at) {
    if (row.family_id) {
      console.warn(`[Auth] Refresh token reuse detected for family ${row.family_id} (user ${row.user_id}). Revoking entire family.`);
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [row.family_id]
      );
    }
    return null;
  }

  return { userId: row.user_id, familyId: row.family_id };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash]
  );
}

export async function revokeAllUserRefreshTokens(userId: number): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

// Rotate refresh token (revoke old, create new in same family)
export async function rotateRefreshToken(oldToken: string): Promise<string | null> {
  const verified = await verifyRefreshToken(oldToken);
  if (!verified) {
    return null;
  }

  await revokeRefreshToken(oldToken);
  return createRefreshToken(verified.userId, verified.familyId || undefined);
}

// =============================================================================
// User Management
// =============================================================================

export async function findUserById(id: number): Promise<User | null> {
  const result = await pool.query(
    `SELECT id, uuid, email, display_name, role, avatar_url, 
            auth_provider, provider_id, email_verified, created_at, last_seen_at
     FROM users WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapUserRow(result.rows[0]);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query(
    `SELECT id, uuid, email, display_name, role, avatar_url,
            auth_provider, provider_id, email_verified, created_at, last_seen_at,
            password_hash
     FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapUserRow(result.rows[0]);
}

export async function findUserByProvider(provider: AuthProvider, providerId: string): Promise<User | null> {
  // First check primary auth provider
  let result = await pool.query(
    `SELECT id, uuid, email, display_name, role, avatar_url,
            auth_provider, provider_id, email_verified, created_at, last_seen_at
     FROM users WHERE auth_provider = $1 AND provider_id = $2`,
    [provider, providerId]
  );

  if (result.rows.length > 0) {
    return mapUserRow(result.rows[0]);
  }

  // Then check linked providers
  result = await pool.query(
    `SELECT u.id, u.uuid, u.email, u.display_name, u.role, u.avatar_url,
            u.auth_provider, u.provider_id, u.email_verified, u.created_at, u.last_seen_at
     FROM users u
     JOIN user_auth_providers uap ON u.id = uap.user_id
     WHERE uap.provider = $1 AND uap.provider_id = $2`,
    [provider, providerId]
  );

  if (result.rows.length > 0) {
    return mapUserRow(result.rows[0]);
  }

  return null;
}

export async function createUser(data: {
  email: string;
  passwordHash?: string;
  displayName: string;
  authProvider?: AuthProvider;
  providerId?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
  role?: UserRole;
}): Promise<User> {
  const uuid = crypto.randomUUID();

  const result = await pool.query(
    `INSERT INTO users (uuid, email, password_hash, display_name, auth_provider, provider_id, avatar_url, email_verified, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, uuid, email, display_name, role, avatar_url, auth_provider, provider_id, email_verified, created_at, last_seen_at`,
    [
      uuid,
      data.email.toLowerCase(),
      data.passwordHash || null,
      data.displayName,
      data.authProvider || (data.passwordHash ? 'local' : null),
      data.providerId || null,
      data.avatarUrl || null,
      data.emailVerified ?? false,
      data.role ?? 'user',
    ]
  );

  return mapUserRow(result.rows[0]);
}

export async function updateUserLastSeen(userId: number): Promise<void> {
  await pool.query(
    `UPDATE users SET last_seen_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function getPasswordHash(userId: number): Promise<string | null> {
  const result = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId]
  );

  return result.rows[0]?.password_hash || null;
}

export async function updatePasswordHash(userId: number, passwordHash: string): Promise<void> {
  await pool.query(
    `UPDATE users SET password_hash = $1 WHERE id = $2`,
    [passwordHash, userId]
  );
}

/**
 * Check if a password appears in the Have I Been Pwned breached password database.
 * Uses k-Anonymity: only the first 5 characters of the SHA-1 hash are sent to HIBP.
 * Returns the breach count (0 means not found / safe).
 */
export async function checkBreachedPassword(password: string): Promise<number> {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.substring(0, 5);
  const suffix = sha1.substring(5);

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'TrackYourRegions/1.0' },
    });

    if (!response.ok) return 0; // Fail open — don't block registration if HIBP is down

    const text = await response.text();
    for (const line of text.split('\n')) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return parseInt(count) || 1;
      }
    }

    return 0;
  } catch {
    return 0; // Fail open on network errors
  }
}

// =============================================================================
// Email Verification Tokens
// =============================================================================

const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

export async function createVerificationToken(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function verifyEmailToken(token: string): Promise<User | null> {
  const tokenHash = hashToken(token);

  const result = await pool.query(
    `SELECT user_id FROM email_verification_tokens
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const userId = result.rows[0].user_id;

  // Mark email as verified
  await pool.query(
    `UPDATE users SET email_verified = true WHERE id = $1`,
    [userId]
  );

  // Delete the used token (and any other tokens for this user)
  await pool.query(
    `DELETE FROM email_verification_tokens WHERE user_id = $1`,
    [userId]
  );

  return findUserById(userId);
}

export async function deleteVerificationTokensForUser(userId: number): Promise<void> {
  await pool.query(
    `DELETE FROM email_verification_tokens WHERE user_id = $1`,
    [userId]
  );
}

// =============================================================================
// Token Pair Generation
// =============================================================================

export async function generateTokenPair(user: User): Promise<AuthTokens> {
  const accessToken = generateAccessToken(user);
  const refreshToken = await createRefreshToken(user.id);

  return { accessToken, refreshToken };
}

// =============================================================================
// Public User Mapper
// =============================================================================

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerified,
    authProvider: user.authProvider ?? undefined,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function mapUserRow(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    uuid: row.uuid as string,
    email: row.email as string | null,
    displayName: row.display_name as string | null,
    role: (row.role as UserRole) || 'user',
    avatarUrl: row.avatar_url as string | null,
    authProvider: row.auth_provider as AuthProvider | null,
    providerId: row.provider_id as string | null,
    emailVerified: row.email_verified as boolean,
    createdAt: row.created_at as Date,
    lastSeenAt: row.last_seen_at as Date,
  };
}

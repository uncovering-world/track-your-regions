import { pool } from '../db/index.js';
import { isProductionMode } from '../config/validateEnv.js';

export interface PromotionContext {
  /** Does ANY admin already exist? Bootstrap only fires when false. */
  adminExists: boolean;
  /** Normalized (lowercased, trimmed) ADMIN_EMAIL, or null if unset. */
  adminEmail: string | null;
  /** The account being considered, lowercased. */
  accountEmail: string;
  /** Is the account's email verified? */
  verified: boolean;
  isProduction: boolean;
}

export function shouldPromoteToAdmin(ctx: PromotionContext): boolean {
  if (ctx.adminExists) return false; // bootstrap only
  if (!ctx.verified) return false; // never promote unverified accounts
  if (ctx.adminEmail) return ctx.accountEmail === ctx.adminEmail; // allowlist match
  return !ctx.isProduction; // first-user fallback: dev only
}

/** Arbitrary fixed key so all bootstrap attempts serialize on the same advisory lock. */
const ADMIN_BOOTSTRAP_LOCK = 727274;

/**
 * Race-safe admin bootstrap. Inside one transaction on a single pooled client,
 * takes an advisory xact lock, checks whether any admin exists, and promotes
 * `userId` if policy (shouldPromoteToAdmin) allows. Returns true iff the row
 * was actually promoted.
 *
 * SECURITY: `verified` MUST reflect the account's real email-verification
 * state. Passing `true` for an unverified account defeats the unverified-
 * account guard and is a privilege-escalation footgun — callers own this.
 */
export async function maybePromoteToAdmin(userId: number, accountEmail: string, verified: boolean): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
  const isProduction = isProductionMode(process.env.NODE_ENV);
  const normalizedEmail = accountEmail.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_BOOTSTRAP_LOCK]);
    const existing = await client.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
    const shouldPromote = shouldPromoteToAdmin({
      adminExists: existing.rows.length > 0,
      adminEmail,
      accountEmail: normalizedEmail,
      verified,
      isProduction,
    });
    let promoted = false;
    if (shouldPromote) {
      const result = await client.query("UPDATE users SET role = 'admin' WHERE id = $1", [userId]);
      promoted = result.rowCount === 1;
    }
    await client.query('COMMIT');
    if (promoted) {
      // Audit: structured, greppable grant record. (A dedicated audit table is a follow-up.)
      console.warn(`🔑 ADMIN GRANT: user id=${userId} email=${normalizedEmail} reason=${adminEmail ? 'ADMIN_EMAIL match' : 'first-user dev fallback'}`);
    } else if (shouldPromote) {
      console.warn(`⚠️  ADMIN GRANT SKIPPED: user id=${userId} not found (UPDATE matched 0 rows)`);
    }
    return promoted;
  } catch (err) {
    // A dead connection makes ROLLBACK throw; swallow it so the ORIGINAL error
    // (the meaningful one) propagates. PostgreSQL auto-rolls back on disconnect.
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ADR-0215: the whole password is digested before bcrypt, which reads only its
// first 72 bytes, so a password is verified exactly as received (ASVS V6.2.8).

const SALT_ROUNDS = 12;

/** What a stored hash of this scheme starts with; one without it is bcrypt over the raw password. */
const SCHEME = 'hmac-sha256-bcrypt$';

/**
 * The digest's key separates it from any other SHA-256 of the same password,
 * so a digest leaked elsewhere cannot be tried against these hashes. It is no
 * secret: bcrypt's cost is what protects a stolen hash.
 */
const DIGEST_KEY = 'track-your-regions/password/v1';

/** The most bcrypt reads of its input. */
const BCRYPT_MAX_BYTES = 72;

/** The whole password as 44 base64 characters: within bcrypt's 72 bytes, and no NUL byte to stop it early. */
function digest(password: string): string {
  // The key is a public label that keeps these digests apart from any other SHA-256 of the password,
  // not a secret (ADR-0215 decision 2): both suppressions below say so to their linters.
  // eslint-disable-next-line sonarjs/hardcoded-secret-signatures -- a public label, not a secret (ADR-0215)
  return crypto.createHmac('sha256', DIGEST_KEY).update(password, 'utf8').digest('base64'); // nosemgrep: javascript.lang.security.audit.hardcoded-hmac-key.hardcoded-hmac-key -- a public label, not a secret (ADR-0215)
}

export async function hashPassword(password: string): Promise<string> {
  return SCHEME + await bcrypt.hash(digest(password), SALT_ROUNDS);
}

/**
 * Whether `password` is the one `stored` was made from, in one bcrypt compare
 * whichever scheme made it, so the time taken says nothing about the account.
 * A hash from before the scheme is bcrypt over the raw password: it is matched
 * only by a password bcrypt read whole, never by one past 72 bytes that shares
 * its first 72.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith(SCHEME)) return bcrypt.compare(digest(password), stored.slice(SCHEME.length));
  const matched = await bcrypt.compare(password, stored);
  return matched && Buffer.byteLength(password, 'utf8') <= BCRYPT_MAX_BYTES;
}

/** A hash from before the scheme, to be made again from the password its owner just signed in with. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(SCHEME);
}

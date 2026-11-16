# ADR-0215: A password is digested whole before bcrypt

**Date:** 2026-11-16
**Status:** Accepted

---

## Context

Passwords are hashed with bcrypt (`bcryptjs`, 12 rounds). bcrypt reads only the first 72 bytes
of its input, while the forms and `registerSchema` / `changePasswordSchema` accept up to 128
characters. So a password of 80 ASCII characters was stored as its first 72, and any password
sharing those 72 bytes signed in to the same account. A passphrase that is not ASCII reaches
the limit sooner: 64 Cyrillic characters are 128 bytes, and bcrypt read half of them.

ASVS 5.0 asks for two things here:

- V6.2.8 (L1): a password is verified exactly as received, without truncation. The checklist
  recorded it as fail (#2524, #2553).
- V6.2.9 (L2): passwords of at least 64 *characters* are permitted.

The database holds very few password hashes. On the dev stack there are five, all test
accounts. Production will start from a fresh database.

## Decision

1. **The whole password is digested before bcrypt.** `hashPassword` stores
   `hmac-sha256-bcrypt$` + bcrypt over the base64 HMAC-SHA-256 of the UTF-8 password
   (`backend/src/services/passwordHash.ts`). The digest is 44 characters, inside bcrypt's
   72 bytes, and base64 holds no NUL byte, which would end bcrypt's read early. Every byte of
   the password changes what bcrypt reads.
2. **The digest is keyed by a fixed label, not a secret.** The key
   (`track-your-regions/password/v1`) separates these digests from a plain SHA-256 of the same
   password. A SHA-256 leaked from another service then cannot be tried against our hashes
   ("password shucking"). bcrypt's cost is what protects a stolen hash, as before.
3. **A stored hash names its scheme.** A hash that does not start with the label is bcrypt over
   the raw password, from before this decision. `verifyPassword` checks either kind in one
   bcrypt compare, so timing reveals nothing about which kind an account holds. An old hash
   matches only a password of at most 72 bytes, which bcrypt read whole. A successful sign-in
   on an old hash stores it again in the new scheme (`local.ts`), and only while the account still
   holds the hash that sign-in checked (`replacePasswordHash`), so a password changed in between
   stays changed.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Cap the password at 72 UTF-8 bytes | Meets V6.2.8, but refuses a 64-character passphrase in Cyrillic, Greek or Japanese, which V6.2.9 asks to permit; travellers write in every script |
| Argon2id (the OWASP first choice) | A native dependency for the backend image and every developer's install, for a property bcrypt with a digest already gives |
| scrypt from Node's `crypto` | No dependency, but the OWASP parameters take 64–128 MB per hash, a lot for a small server under a burst of sign-ins |
| Unkeyed SHA-256 before bcrypt | Open to password shucking: a SHA-256 of the same password from another breach can be tested against our hashes without bcrypt's cost being paid per guess |
| A secret pepper as the HMAC key | Adds a secret whose loss locks out every account and whose leak removes its benefit. bcrypt's cost stays the protection, and the fixed label already stops shucking |
| No reader for old hashes (start clean) | Locks the dev stack's test accounts out, with no reset path. The reader is three lines, and the scheme label lets it be deleted once no old hash is left |

## Consequences

**Positive:**
- V6.2.8 passes: the whole password is what is checked, in any script.
- V6.2.9 is unchanged: 128 characters of any script are accepted and read whole.
- A future change of scheme has a place to go, since a stored hash names its scheme.

**Negative / Trade-offs:**
- The stored hash is 79 characters, no longer a bare bcrypt string; tools that expect one
  (none in this repository) would need the label stripped.
- Old hashes stay until their owners sign in. A test account that never signs in again keeps
  one, and an old hash of a password longer than 72 bytes can no longer be signed in with.

## References

- Related docs: `docs/tech/authentication.md` § Password Security, `docs/security/SECURITY.md`
- ASVS 5.0 V6.2.8, V6.2.9, V11.4.2; OWASP Password Storage Cheat Sheet § Pre-Hashing Passwords with bcrypt
- PR / issue: #2553

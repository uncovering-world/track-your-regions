import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import {
  findUserByEmail, getPasswordHash, hashPassword, needsRehash, replacePasswordHash, verifyPassword,
} from '../../services/authService.js';

// A hash of the current scheme to check an unknown address against: the same
// compare a real account costs, so "user not found" cannot be told by timing.
// Started when the strategy is configured, not when the module loads, so it is
// ready before the first request and an import makes no hash.
let dummyHash: Promise<string> | undefined;
const dummy = (): Promise<string> => (dummyHash ??= hashPassword('dummy-password-for-timing'));

/**
 * Local Strategy: Email/Password Authentication
 */
export function configureLocalStrategy(): void {
  void dummy();
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
      },
      async (email, password, done) => {
        try {
          const user = await findUserByEmail(email);

          if (!user) {
            // Perform dummy bcrypt compare to prevent timing oracle (ASVS V6.3.8)
            await verifyPassword(password, await dummy());
            return done(null, false, { message: 'Invalid email or password' });
          }

          // Check if user has a password (might be OAuth-only user)
          const passwordHash = await getPasswordHash(user.id);
          if (!passwordHash) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          const isValid = await verifyPassword(password, passwordHash);
          if (!isValid) {
            return done(null, false, { message: 'Invalid email or password' });
          }
          // A hash from before ADR-0215 is made again from the password just
          // checked, so the next sign-in reads the whole of it.
          // A failed write leaves the old hash, which still verifies: the sign-in goes on.
          if (needsRehash(passwordHash)) {
            await hashPassword(password)
              .then((hash) => replacePasswordHash(user.id, passwordHash, hash))
              .catch((error: unknown) => console.warn('Password rehash failed for user id=%d:', user.id, error));
          }

          return done(null, {
            id: user.id,
            uuid: user.uuid,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
            avatarUrl: user.avatarUrl,
            emailVerified: user.emailVerified,
          });
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}

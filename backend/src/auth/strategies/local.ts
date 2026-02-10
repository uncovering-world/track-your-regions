import bcrypt from 'bcryptjs';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { findUserByEmail, verifyPassword, getPasswordHash } from '../../services/authService.js';

// Pre-computed dummy hash for timing-safe user-not-found responses.
// Comparing against this takes the same time as a real bcrypt compare,
// preventing attackers from distinguishing "user not found" via timing.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

/**
 * Local Strategy: Email/Password Authentication
 */
export function configureLocalStrategy(): void {
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
            // Perform dummy bcrypt compare to prevent timing oracle (ASVS V6.5.1)
            await bcrypt.compare(password, DUMMY_HASH);
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

import passport from 'passport';
// @ts-expect-error - passport-apple types may not be complete
import AppleStrategy from 'passport-apple';
import { findUserByEmail, findUserByProvider, createUser } from '../../services/authService.js';

/**
 * Apple Sign-In Strategy
 *
 * TODO: This strategy is UNTESTED as it requires an Apple Developer account
 * to configure. The implementation follows the same pattern as Google OAuth
 * and should work once the following environment variables are set:
 *
 * - APPLE_CLIENT_ID: The Service ID from Apple Developer Console
 * - APPLE_TEAM_ID: Your Apple Developer Team ID
 * - APPLE_KEY_ID: The Key ID from Apple Developer Console
 * - APPLE_PRIVATE_KEY: The private key content (with \n for newlines)
 *
 * Apple Sign-In differences from Google:
 * - Uses POST for callback (not GET)
 * - User info is only provided on first authentication
 * - Private key authentication instead of client secret
 */
export function configureAppleStrategy(): void {
  const clientID = process.env.APPLE_CLIENT_ID;
  const teamID = process.env.APPLE_TEAM_ID;
  const keyID = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientID || !teamID || !keyID || !privateKey) {
    console.log('Apple Sign-In not configured (missing APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, or APPLE_PRIVATE_KEY)');
    return;
  }

  passport.use(
    new AppleStrategy(
      {
        clientID,
        teamID,
        keyID,
        privateKeyString: privateKey,
        callbackURL: '/api/auth/apple/callback',
        scope: ['name', 'email'],
        passReqToCallback: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (req: any, accessToken: string, refreshToken: string, idToken: any, profile: any, done: any) => {
        try {
          // Apple provides user info in the request body on first auth only
          const userInfo = req.body?.user ? JSON.parse(req.body.user) : null;

          const providerId = idToken.sub;
          const email = idToken.email || userInfo?.email;
          const displayName = userInfo?.name
            ? `${userInfo.name.firstName || ''} ${userInfo.name.lastName || ''}`.trim()
            : email?.split('@')[0] || 'User';

          // First, check if user exists by Apple provider ID
          let user = await findUserByProvider('apple', providerId);

          if (user) {
            return done(null, {
              id: user.id,
              uuid: user.uuid,
              email: user.email,
              displayName: user.displayName,
              role: user.role,
              avatarUrl: user.avatarUrl,
              emailVerified: user.emailVerified,
            });
          }

          // Check if user exists by email
          if (email) {
            user = await findUserByEmail(email);

            if (user) {
              if (user.emailVerified) {
                return done(null, {
                  id: user.id,
                  uuid: user.uuid,
                  email: user.email,
                  displayName: user.displayName,
                  role: user.role,
                  avatarUrl: user.avatarUrl,
                  emailVerified: user.emailVerified,
                });
              }
              return done(null, false, { message: 'An account with this email already exists. Please log in with your password.' });
            }
          }

          // Create new user
          if (!email) {
            return done(null, false, { message: 'Email is required for registration' });
          }

          user = await createUser({
            email,
            displayName,
            authProvider: 'apple',
            providerId,
            emailVerified: true, // Apple emails are verified
          });

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
          return done(error as Error);
        }
      }
    )
  );
}

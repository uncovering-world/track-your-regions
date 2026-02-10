import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { findUserByEmail, findUserByProvider, createUser } from '../../services/authService.js';

/**
 * Google OAuth 2.0 Strategy
 */
export function configureGoogleStrategy(): void {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.log('Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: '/api/auth/google/callback',
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const providerId = profile.id;
          const displayName = profile.displayName || email?.split('@')[0] || 'User';
          const avatarUrl = profile.photos?.[0]?.value || null;

          // First, check if user exists by Google provider ID
          let user = await findUserByProvider('google', providerId);

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

          // Check if user exists by email (might have registered with email/password)
          if (email) {
            user = await findUserByEmail(email);

            if (user) {
              // User exists with this email - they should link their account
              // For now, we'll allow login if email matches and is verified
              if (user.emailVerified) {
                return done(null, {
                  id: user.id,
                  uuid: user.uuid,
                  email: user.email,
                  displayName: user.displayName,
                  role: user.role,
                  avatarUrl: user.avatarUrl || avatarUrl,
                  emailVerified: user.emailVerified,
                });
              }
              // Email exists but not verified - this could be account takeover attempt
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
            authProvider: 'google',
            providerId,
            avatarUrl: avatarUrl || undefined,
            emailVerified: true, // Google emails are verified
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

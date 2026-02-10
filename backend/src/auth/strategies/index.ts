/**
 * Passport Strategies Directory
 *
 * This directory contains OAuth strategies for authentication.
 *
 * =============================================================================
 * ADDING A NEW OAUTH PROVIDER
 * =============================================================================
 *
 * To add a new OAuth provider (e.g., Facebook, VK, Kakao, LINE):
 *
 * 1. Install the passport strategy package:
 *    npm install passport-{provider}
 *    npm install -D @types/passport-{provider}  (if available)
 *
 * 2. Create a new strategy file (e.g., facebook.ts) following the pattern:
 *    - Import the strategy from passport-{provider}
 *    - Create a configure function that sets up the strategy
 *    - Handle user creation/lookup in the verify callback
 *    - Export the configure function
 *
 * 3. Add the provider to the auth_provider enum in the database:
 *    ALTER TYPE auth_provider ADD VALUE '{provider}';
 *
 * 4. Add routes in authRoutes.ts:
 *    - GET /api/auth/{provider} - Redirect to provider
 *    - GET/POST /api/auth/{provider}/callback - Handle callback
 *
 * 5. Add a sign-in button in the frontend LoginDialog component
 *
 * 6. Add required environment variables:
 *    - {PROVIDER}_CLIENT_ID
 *    - {PROVIDER}_CLIENT_SECRET
 *    - Any provider-specific variables
 *
 * =============================================================================
 * CURRENT STRATEGIES
 * =============================================================================
 *
 * - local.ts: Email/password authentication
 * - google.ts: Google OAuth 2.0
 * - apple.ts: Apple Sign-In (TODO: untested, needs Apple Developer account)
 *
 */

export { configureLocalStrategy } from './local.js';
export { configureGoogleStrategy } from './google.js';
export { configureAppleStrategy } from './apple.js';

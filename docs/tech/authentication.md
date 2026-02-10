# Authentication System

This document describes the authentication system for Track Your Regions, including setup, configuration, and usage.

## Overview

The authentication system uses:
- **JWT tokens** for stateless authentication (no server sessions)
- **Passport.js** for authentication strategies
- **bcryptjs** for password hashing
- **OAuth 2.0** for social login (Google, Apple)

## Access Levels

| Access Level | Permissions |
|--------------|-------------|
| **Public** | Browse world views, regions, and experiences; view map; explore hierarchies |
| **User** (authenticated) | Everything public + mark/unmark visited regions and experiences, view own profile |
| **Curator** | Everything user + curate experiences within assigned scope (reject/unreject, edit, manual assign/create) |
| **Admin** | Everything curator + create/edit/delete world views, sync experiences, run region assignments, curator management, editor access |

### What's Public (No Login Required)
- View all active world views (including the default GADM world view)
- Browse region hierarchies
- View region geometries on the map
- Navigate through regions and subregions
- Browse all experiences (UNESCO World Heritage Sites, etc.)
- View experience details, locations, and images
- Search and filter experiences

### What Requires Login
- Mark regions as visited
- Mark experiences as visited
- View visited regions and experiences statistics
- Access user profile

### What Requires Admin
- Create, edit, delete world views
- Add/remove regions and members
- Compute geometries
- Sync experiences from external sources (UNESCO, etc.)
- Run region assignment for experiences
- View sync logs and history, reorder sources
- Manage curator assignments and activity
- AI-assisted features

### What Requires Curator (or Admin)
- Reject/unreject experiences per region
- Edit experience fields (`name`, descriptions, `category`, `image_url`, tags)
- Manually assign/unassign experiences to regions
- Create manual experiences (stored under **Curator Picks** source)
- View curation audit history

## Environment Variables

Add these to your `.env` file:

### Required

```bash
# JWT secret for signing tokens - MUST be changed in production!
# Generate with: openssl rand -base64 32
JWT_SECRET=your-secure-random-secret-here

# Frontend URL for OAuth redirects
FRONTEND_URL=http://localhost:5173
```

### Google OAuth (Optional)

To enable "Sign in with Google":

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Navigate to "APIs & Services" → "Credentials"
4. Create "OAuth 2.0 Client ID" (Web application)
5. Add authorized redirect URI: `http://localhost:3001/api/auth/google/callback`
6. Copy the Client ID and Client Secret

```bash
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Apple Sign-In (Optional)

> **Note:** Apple Sign-In is implemented but **untested** as it requires an Apple Developer account ($99/year).

To enable "Sign in with Apple":

1. Enroll in [Apple Developer Program](https://developer.apple.com/programs/)
2. Create an App ID with "Sign in with Apple" capability
3. Create a Service ID for web authentication
4. Create a private key for Sign in with Apple
5. Configure the following:

```bash
APPLE_CLIENT_ID=com.yourcompany.yourapp.web
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_KEY_ID=XXXXXXXXXX
# Private key content with \n for newlines
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----"
```

## Email Verification

Local accounts (email/password) must verify their email before logging in. OAuth accounts (Google, Apple) are automatically verified.

### Flow

1. User submits the registration form
2. Server creates the user with `email_verified = false` and sends a verification email
3. Registration always returns `{ message: "Check your email to verify your account" }` — same response regardless of whether the email is new or already registered (credential enumeration resistance)
4. User clicks the verification link in the email → `GET /verify-email?token=...`
5. Frontend sends the token to `POST /api/auth/verify-email`
6. Server verifies the token hash, sets `email_verified = true`, and returns an access token (auto-login)
7. Login is blocked for unverified accounts with error code `EMAIL_NOT_VERIFIED`

### Anti-Enumeration

Registration no longer returns 409 for existing emails. Both new and existing emails produce the identical "Check your email" response. If an existing unverified account re-registers, the verification email is silently resent. This eliminates credential enumeration (OWASP ASVS V6.5.1).

### Verification Tokens

- 32 random bytes (256-bit entropy), stored as SHA-256 hash in `email_verification_tokens` table
- 24-hour expiry
- One-time use: consumed and deleted after successful verification
- All tokens for a user are deleted on resend (prevents stale token accumulation)
- Expired tokens cleaned up every 6 hours alongside refresh token cleanup

### Email Transport

- **Development**: No SMTP needed — emails are printed to the backend console with a clickable verification link
- **Production**: Standard SMTP via `nodemailer` (Resend, SendGrid, or any SMTP provider)
- See `docs/tech/email-setup.md` for full setup instructions

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/verify-email` | Verify email with token, auto-login on success |
| POST | `/api/auth/resend-verification` | Resend verification email (rate-limited: 3/hour) |

### Rate Limiting

- **Resend verification**: 3 requests per hour per IP

## Database Setup

Auth tables are created automatically when running the init scripts (via `npm run db:create`).

The schema includes:
- `user_role` enum (`user`, `curator`, `admin`)
- `auth_provider` enum (`local`, `google`, `apple`)
- `users` table with authentication columns (email, password_hash, role, etc.)
- `user_auth_providers` table for linking multiple OAuth accounts
- `refresh_tokens` table for JWT token rotation
- `email_verification_tokens` table for email verification flow

## Creating an Admin User

After running the migration, you can create an admin user:

### Option 1: Register via API, then promote

```bash
# Register a new user
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "SecurePassword123", "displayName": "Admin"}'

# Promote to admin via SQL
docker exec -i tyr-ng-db psql -U postgres -d track_regions \
  -c "UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';"
```

### Option 2: Insert directly via SQL

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "
INSERT INTO users (uuid, email, password_hash, display_name, role, auth_provider, email_verified)
VALUES (
  gen_random_uuid(),
  'admin@example.com',
  '\$2a\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.PQKXv.z7G1KRXC', -- 'admin123' hashed
  'Admin',
  'admin',
  'local',
  true
);"
```

> **Security Note:** Change the password immediately after first login!

## API Endpoints

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/register` | Register with email/password (sends verification email) | No |
| POST | `/api/auth/login` | Login with email/password (requires verified email) | No |
| POST | `/api/auth/verify-email` | Verify email with token (auto-login) | No |
| POST | `/api/auth/resend-verification` | Resend verification email | No |
| POST | `/api/auth/refresh` | Rotate tokens | No (uses httpOnly cookie) |
| POST | `/api/auth/logout` | Invalidate refresh token | No |
| POST | `/api/auth/change-password` | Change password (local accounts) | Yes |
| POST | `/api/auth/exchange-code` | Exchange one-time OAuth code for tokens | No |
| GET | `/api/auth/me` | Get current user profile | Yes |
| GET | `/api/auth/google` | Redirect to Google OAuth | No |
| GET | `/api/auth/google/callback` | Google OAuth callback (redirects with code) | No |
| GET | `/api/auth/apple` | Redirect to Apple Sign-In | No |
| POST | `/api/auth/apple/callback` | Apple Sign-In callback (redirects with code) | No |

### Request/Response Examples

#### Register

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "MySecurePassword123",
    "displayName": "John Doe"
  }'
```

Response (always the same, regardless of whether email exists):
```json
{
  "message": "Check your email to verify your account"
}
```

#### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "MySecurePassword123"
  }'
```

#### Authenticated Request

```bash
curl http://localhost:3001/api/world-views \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

#### Refresh Tokens

The refresh token is sent automatically via httpOnly cookie:

```bash
curl -X POST http://localhost:3001/api/auth/refresh \
  -b "tyr-refresh-token=<cookie-value>" \
  -H "Content-Type: application/json"
```

## Token Lifecycle

1. **Access Token**: Short-lived (15 minutes), sent in `Authorization: Bearer <token>` header, kept in memory only. Exception: SSE endpoints (`EventSource`) pass JWT as `token` query parameter since `EventSource` can't send custom headers. The `requireAuth` middleware checks both `Authorization` header and `req.query.token`. SSE route Zod schemas must include `token: z.string().optional()` so the `validate()` middleware doesn't strip it
2. **Refresh Token**: Long-lived (7 days), stored as httpOnly cookie (`tyr-refresh-token`, path `/api/auth`, SameSite=Strict in prod), hashed (SHA-256) in DB
3. **Token Rotation**: Each refresh invalidates the old refresh token and issues a new one within the same token family
4. **Token Family Tracking**: All rotated tokens share a `family_id`. If a revoked token is reused (indicating theft), the entire family is revoked, forcing re-login on all devices that shared that session chain
5. **JWT Claims**: Tokens include `iss` (track-your-regions), `aud` (track-your-regions-app), and `jti` (unique token ID), verified on every request. Payload contains only `sub` (user ID), `uuid`, and `role` — no PII
6. **Logout Blacklist**: On logout, the access token's `jti` is added to an in-memory blacklist. `verifyAccessToken()` checks this blacklist, immediately rejecting logged-out tokens instead of waiting for expiry. Blacklist entries auto-clean every 5 minutes
7. **Session Limits**: Max 10 concurrent refresh tokens per user. When the limit is exceeded, the oldest tokens are automatically revoked
8. **Token Cleanup**: Expired and revoked refresh tokens are cleaned up every 6 hours via the `cleanup_refresh_tokens()` database function

## OAuth Code Exchange

OAuth callbacks (Google, Apple) don't return tokens directly. Instead:
1. Backend generates a one-time authorization code (32 random bytes, 60s TTL)
2. Redirects to frontend with `?code=<auth-code>`
3. Frontend exchanges the code via `POST /api/auth/exchange-code`
4. Server returns access token in response body, sets refresh token as httpOnly cookie
5. The one-time code is deleted after use (replay-proof)

This prevents tokens from appearing in URLs, browser history, or server logs.

## Rate Limiting

Auth endpoints are rate-limited per IP via `express-rate-limit`:
- **Login**: 10 attempts / 15 minutes
- **Registration**: 5 / hour
- **Refresh**: 30 / minute
- **Resend verification**: 3 / hour
- **Verify email**: 10 / minute
- **Exchange code** (OAuth): 10 / minute

Uses `draft-7` standard headers (`RateLimit-Policy`, `RateLimit`).

## Password Security

- **Minimum length**: 8 characters. **Maximum**: 128 characters. No composition rules (per ASVS V6.2.5).
- **Breached password check**: Passwords are checked against the [Have I Been Pwned](https://haveibeenpwned.com/API/v3#PwnedPasswords) breached password database on registration and password change. Uses the k-Anonymity API — only the first 5 characters of the SHA-1 hash are sent, so the full password never leaves the server.
- **Fails open**: If the HIBP API is unavailable, registration/change proceeds without the check (availability over security for a non-critical check).
- **Password change** (`POST /api/auth/change-password`): Requires the current password, checks the new password against HIBP, then revokes all existing refresh tokens (forcing re-login on all other devices). Returns new tokens for the current session.

## Frontend Integration

The frontend automatically:
- Keeps access token in memory only (never persisted to storage)
- Sends refresh token via httpOnly cookie (automatic, no JS access)
- Attempts silent refresh on page load via cookie
- Automatically refreshes tokens on 401 responses
- Attaches `Authorization` header to all API requests

### Using the Auth Hook

```tsx
import { useAuth } from './hooks/useAuth';

function MyComponent() {
  const { user, isAuthenticated, isAdmin, isCurator, login, logout } = useAuth();

  if (!isAuthenticated) {
    return <LoginPrompt />;
  }

  return (
    <div>
      <p>Welcome, {user.displayName}!</p>
      {isAdmin && <AdminPanel />}
      {isCurator && <CurationTools />}
      <button onClick={logout}>Sign Out</button>
    </div>
  );
}
```

## Security Considerations

1. **JWT_SECRET**: Must be a strong, unique value in production. Never commit to version control.
2. **HTTPS**: Always use HTTPS in production for secure token transmission.
3. **HSTS**: Strict-Transport-Security header with max-age=1 year, includeSubDomains, preload.
4. **Token Storage**: Refresh token in httpOnly cookie (not accessible to JavaScript). Access token in memory only.
5. **Password Requirements**: Minimum 8 characters, maximum 128. No composition rules (per ASVS).
6. **Rate Limiting**: Auth endpoints rate-limited via `express-rate-limit`.
7. **JWT Algorithm**: Restricted to HS256 only (`algorithms: ['HS256']` in verify).
8. **OAuth Security**: One-time code exchange prevents token leakage in URLs/logs.
9. **CSRF Protection**: Three layers — Origin header verification on state-changing requests, SameSite=Strict on refresh cookie, access token in Authorization header (not cookie).
10. **Logout Invalidation**: Access token JTI blacklisted in-memory on logout (immediate effect, no 15-min window).

## Adding New OAuth Providers

To add a new OAuth provider (e.g., Facebook, GitHub):

1. Install the passport strategy:
   ```bash
   npm install passport-{provider}
   npm install -D @types/passport-{provider}
   ```

2. Create strategy file in `backend/src/auth/strategies/{provider}.ts`

3. Add provider to database enum:
   ```sql
   ALTER TYPE auth_provider ADD VALUE '{provider}';
   ```

4. Add routes in `authRoutes.ts`:
   ```typescript
   router.get('/{provider}', passport.authenticate('{provider}', { session: false }));
   router.get('/{provider}/callback', ...);
   ```

5. Add button in `LoginDialog.tsx`

6. Add environment variables for client ID/secret

See `backend/src/auth/strategies/index.ts` for detailed instructions.

## Troubleshooting

### "Invalid or expired token"
- Access token has expired. The frontend should automatically refresh.
- If persists, try logging out and back in.

### "Authorization header required"
- Request is missing the `Authorization: Bearer <token>` header.
- Ensure you're logged in and the token is being attached.

### Google OAuth not working
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set correctly.
- Check that redirect URI matches exactly in Google Console.
- Ensure the backend URL is accessible from the browser.

### Curator actions return 403
- Verify the account role is `curator` or `admin`.
- For region/source-scoped curators, verify the assignment covers the target region/source.

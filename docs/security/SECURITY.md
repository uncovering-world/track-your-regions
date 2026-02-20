# SECURITY.md

## OWASP ASVS Target Level: 2

We target ASVS Level 2 (standard security for apps handling personal data).
Level 1 requirements are mandatory. Level 2 requirements are expected.
Level 3 requirements are tracked but optional for now.

## Application Profile

- **Type**: Web application (travel/region tracking with user accounts)
- **Auth**: Email/password + Google OAuth 2.0 (Apple Sign-In planned)
- **Data sensitivity**: User travel history, visited regions, location preferences
- **APIs**: REST API (Express). Public read endpoint: `GET /api/world-views/regions/:regionId/members/descendant-geometries` (optionalAuth, publicReadLimiter)
- **File handling**: Server-side image downloads from Wikimedia/UNESCO (no user uploads currently)
- **Frontend**: MapLibre GL (WebGL) map rendering, SPA with React + MUI
- **Sessions**: JWT access tokens (15min, in-memory) + refresh tokens (httpOnly cookie, hashed in DB)
- **Roles**: user, curator (scope-based), admin

## Relevant ASVS Chapters (Priority Order)

1. V6 Authentication — Email/password + Google OAuth 2.0, JWT lifecycle
2. V8 Authorization — User data isolation, curator scopes, admin access
3. V7 Session Management — JWT access/refresh handling, token rotation
4. V1 Encoding & Sanitization — Experience data rendering, external data pipelines
5. V2 Validation & Business Logic — Region/experience operations, sync workflows
6. V4 API & Web Service — REST API hardening, CORS, rate limiting
7. V14 Data Protection — User travel data, visited regions, PII
8. V13 Configuration — Secret management, environment config, error responses
9. V5 File Handling — Server-side image downloads from external sources
10. V11 Cryptography — Password hashing (bcrypt), JWT signing
11. V12 Secure Communication — TLS in production
12. V16 Security Logging — Audit trail for auth events, sync operations

## Out of Scope (for now)

- V17 WebRTC (not used)
- V10 OAuth Authorization Server (we are a client, not a provider)
- V4.3 GraphQL (not used)
- V5 user file uploads (not implemented — images are server-side downloaded)

## Current Security Stack

| Layer | Implementation |
|-------|---------------|
| Password hashing | bcryptjs, 12 salt rounds |
| JWT | jsonwebtoken, HS256 only, iss/aud claims, 15min access + rotated refresh with family tracking |
| Auth middleware | requireAuth, requireAdmin, requireCurator, optionalAuth |
| Validation | Zod schemas on all routes (body, query, params via `validate()` middleware). SSE endpoints include `token` in query schema to preserve JWT for auth |
| ORM | Drizzle ORM + parameterized `pool.query()` |
| Headers | Helmet (CSP, X-Frame-Options, etc.) |
| CORS | Restricted to FRONTEND_URL origin |
| Rate limiting | express-rate-limit on all endpoint tiers (auth, search, public read, authenticated user). See [rate-limiting.md](../tech/rate-limiting.md) |
| Email verification | nodemailer with console fallback; 24h tokens, anti-enumeration |
| Password breach check | HIBP k-Anonymity API on register + password change |
| SAST | Semgrep via Docker (`npm run security:scan`) — p/owasp-top-ten, p/nodejs, p/react, p/secrets rulesets |
| Dependency scanning | `npm run security:deps` — npm audit for backend + frontend (production deps only, `--omit=dev`) |
| Containers | Dockerfiles run as non-root `node` user |

## Known Gaps

_No critical gaps remaining. Dependency scanning and SAST are now covered by Semgrep and npm audit._

# ADR-0007: JWT with httpOnly Refresh Tokens

**Date:** 2025-02-01
**Status:** Accepted

---

## Context

The app needs authentication that works across browser page reloads, is resistant to
XSS and CSRF attacks, and supports stateless multi-instance deployment. OAuth providers
(Google, Apple) must be supported alongside email/password.

## Decision

Use a dual-token architecture:
- **Access token** — short-lived JWT (15min, HS256), stored in-memory only on the frontend
- **Refresh token** — random 32-byte hex, stored as httpOnly cookie (`tyr-refresh-token`,
  `SameSite=Strict` in production, `path=/api/auth`)

OAuth callback uses a one-time auth code (60s TTL, in-memory Map) exchanged via POST —
tokens never appear in URLs.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| JWT in localStorage | Vulnerable to XSS — any injected script can steal the token |
| Server sessions (express-session) | Requires shared session store for multi-instance; adds state |
| Refresh token in response body only | Client must store it somewhere (localStorage = XSS risk) |
| OAuth tokens in redirect URL | Tokens visible in browser history, logs, referrer headers |

## Consequences

**Positive:**
- XSS-safe: httpOnly cookie is invisible to JavaScript
- CSRF-safe: SameSite=Strict prevents cross-origin cookie sending
- Stateless: JWT validated without DB lookup; scales horizontally
- Token rotation with family tracking detects reuse and revokes entire family
- OAuth code exchange keeps tokens out of URLs

**Negative / Trade-offs:**
- Access token lost on page reload — requires silent refresh via cookie on every load
- 15min blacklist window: revoked JWTs remain valid until expiry (mitigated by short TTL)
- Max 10 concurrent refresh tokens per user — older sessions evicted

## References

- Related docs: `docs/tech/authentication.md`, `docs/security/SECURITY.md`
- Backend: `backend/src/services/authService.ts`, `backend/src/routes/authRoutes.ts`
- Frontend: `frontend/src/hooks/useAuth.tsx`, `frontend/src/api/fetchUtils.ts`

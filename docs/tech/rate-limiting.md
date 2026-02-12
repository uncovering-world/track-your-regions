# Rate Limiting Strategy

All rate limiters are defined in `backend/src/middleware/rateLimiter.ts`. Route files import from this shared module — no inline rate limiter definitions.

## Tiers

### 1. Auth (strict)

High-value targets for brute force and credential stuffing.

| Limiter | Window | Max | Applied to |
|---------|--------|-----|------------|
| `loginLimiter` | 15 min | 10 | `POST /api/auth/login` |
| `registerLimiter` | 1 hour | 5 | `POST /api/auth/register` |
| `refreshLimiter` | 1 min | 30 | `POST /api/auth/refresh` |
| `verifyEmailLimiter` | 1 min | 10 | `POST /api/auth/verify-email` |
| `exchangeCodeLimiter` | 1 min | 10 | `POST /api/auth/exchange-code` |
| `resendLimiter` | 1 hour | 3 | `POST /api/auth/resend-verification` |

### 2. Search (moderate)

Endpoints that hit external APIs or perform text search.

| Limiter | Window | Max | Applied to |
|---------|--------|-----|------------|
| `searchLimiter` | 1 min | 30 | `GET /api/experiences/search`, `GET /api/geocode/search` |

### 3. Public read (generous)

Unauthenticated endpoints serving the main UI. Applied to all `optionalAuth` and fully public GET routes.

| Limiter | Window | Max | Applied to |
|---------|--------|-----|------------|
| `publicReadLimiter` | 1 min | 60 | World view/region reads, experience browsing, categories, treasures, geometries |

**Files using this limiter:**
- `worldViewRoutes.ts` — all `optionalAuth` GET routes (regions, geometries, members, hull params)
- `experienceRoutes.ts` — `GET /categories`, `GET /region-counts`, `GET /by-region/:id`, `GET /`, `GET /:id`, `GET /:id/locations`, `GET /:id/treasures`

### 4. Authenticated user (generous)

Per-IP limiting for logged-in user actions (tracking visits, viewed treasures).

| Limiter | Window | Max | Applied to |
|---------|--------|-----|------------|
| `authenticatedLimiter` | 1 min | 60 | All `userRoutes.ts` endpoints (visited regions/experiences/locations, viewed treasures) |

Applied via `router.use(authenticatedLimiter)` at the router level since all routes require auth.

### 5. Admin/curator (exempt)

Routes behind `requireAuth` + `requireAdmin` or `requireCurator` do **not** have rate limiting. Rationale:

- These are inaccessible to unauthenticated users
- Admin operations include long-running batch tasks (geometry computation, sync) where rate limiting could cause failures
- The attack surface is negligible (requires compromised admin credentials)

**Exempt files:** `adminRoutes.ts`, `divisionRoutes.ts` (mounted behind admin middleware), `viewRoutes.ts`, `aiRoutes.ts`, plus write operations in `worldViewRoutes.ts` and `experienceRoutes.ts` curation routes.

## Adding rate limiting to new endpoints

When adding a new route, choose the appropriate limiter:

| Endpoint type | Limiter to use | Import from |
|---------------|----------------|-------------|
| Public read (no auth) | `publicReadLimiter` | `middleware/rateLimiter.ts` |
| Public search / external API call | `searchLimiter` | `middleware/rateLimiter.ts` |
| Authenticated user action | `authenticatedLimiter` | `middleware/rateLimiter.ts` |
| Auth flow (login, register, etc.) | Create dedicated limiter | `middleware/rateLimiter.ts` |
| Admin/curator only | None needed | — |

**Important:** Always apply rate limiting middleware **before** the route handler in the middleware chain. For per-route application, place it as the first middleware argument:

```typescript
router.get('/example', publicReadLimiter, validate(schema, 'query'), optionalAuth, handler);
```

For router-wide application (when all routes in a file need the same limiter):

```typescript
router.use(authenticatedLimiter);
```

## Technical details

- All limiters use `standardHeaders: 'draft-7'` (returns `RateLimit-*` headers per IETF draft)
- Legacy `X-RateLimit-*` headers are disabled
- Keying is IP-based (default `express-rate-limit` behavior via `req.ip`)
- In-memory store (default); consider Redis store for multi-instance deployments

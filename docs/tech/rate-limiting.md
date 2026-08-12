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
| `authenticatedLimiter` | 1 min | 60 | All `userRoutes.ts` endpoints (visited regions/experiences/locations, viewed treasures), plus `POST /api/experiences/new-badges/seen` |

Applied via `router.use(authenticatedLimiter)` at the router level in `userRoutes.ts`, since all
its routes require auth. The badge-impression endpoint takes it per route instead: it lives in
`experienceRoutes.ts` among the curation routes the section below exempts, and it is not one of
them — it is an ordinary authenticated action, and the only endpoint there a client calls on its
own initiative rather than in response to a click.

### 5. Admin/curator (exempt by default, with named exceptions)

Routes behind `requireAuth` + `requireAdmin` or `requireCurator` are **not** rate limited by default. Rationale:

- These are inaccessible to unauthenticated users
- Admin operations include long-running batch tasks (geometry computation, sync) where rate limiting could cause failures
- The attack surface is negligible (requires compromised admin credentials)

**Exempt by default:** `adminRoutes.ts`, `divisionRoutes.ts` (mounted behind admin middleware), `viewRoutes.ts`, `aiRoutes.ts`, plus write operations in `worldViewRoutes.ts` and `experienceRoutes.ts` curation routes.

The exemption is about the *attack* surface, and it stops applying when a request
is expensive to the system regardless of who sends it. The exceptions are named here, and the
table is the list — deliberately without a count in front of it, because the count above a list is
what goes stale when a route is added to the row below (it has already happened twice here):

| Limiter | Window | Max | Applied to |
|---------|--------|-----|------------|
| `expensiveAdminLimiter` | 1 min | 5 | `POST /api/admin/wv-import/matches/:worldViewId/rematch` |
| `authenticatedLimiter` | 1 min | 60 | `POST /api/experiences/:id/publish`, `POST /api/experiences/:id/admission`, `POST /api/experiences/categories/:categoryId/publish-waiting` |

A re-match deletes every `region_members` row for a world view and then spends
20–130s re-resolving them. The endpoint already answers 409 while one is running,
which stops concurrent runs but not a rapid succession of them — and each run
discards the previous one's output. Deliberately its own limiter rather than one
applied to the whole admin mount, because the bulk workflows above legitimately
issue many requests a minute and must not inherit a limit sized for this.

`/:id/publish` is here because of one branch, not the whole endpoint: where a
publication releases a deferred withdrawal (ADR-0025), it re-places the object
into every world view with geometry after committing — deleting and reinserting
region rows. That is expensive regardless of who sends it, which is the test this
section states.

It takes the 60/min limiter rather than the 5/min one deliberately. The expensive
branch fires only for a point that moved; an ordinary publish is a single
transaction, and a curator answers a queue in batches — the first gated round is
about 18 arrivals. Five a minute would answer 429 in the middle of exactly the
work the curation gate exists to make possible, to bound a branch most publishes
never reach. Sixty bounds a runaway client and is invisible to a person reading
cards.

`/:id/admission` carries the same limiter, because it is the same branch and not
merely a similar one. Overriding a refusal on a gated arrival publishes its
contents through the shared `publishContents`, so it can release a deferred
withdrawal, and `setExperienceAdmission` then calls `placeAfterAdmissionRelease`
→ `placeAfterRelease` after releasing its client — the identical post-commit
placement, on the identical `withdrawalsReleased > 0` trigger. An earlier version
of this section said the four siblings had "no post-commit work"; that was true of
three of them and the criterion decides per branch, not per endpoint.

The three that remain (`/:id/state`, `/:id/accept-source`, `/review/queue`) stay
exempt, checked rather than assumed: each ends at `res.json` with nothing after
its `client.release()`.

`PUT /api/admin/sync/categories/:categoryId/curation-gate` — the switch that holds
a source's content for review — stays exempt too, and CodeQL flags it, so the
reason is here rather than only in a dismissal. It is one `UPDATE` of one row in a
three-row table, and it does no work itself: it changes what *future* runs do. A
flood of flips costs a flood of single-row updates, which is what the default
exemption on this router is for. The criterion above is about cost per request,
not about how much a request decides — and adding a limiter to satisfy an
analyser, against the rule this section states, would make the rule mean less
each time it is done.

`POST /api/experiences/categories/:categoryId/publish-waiting` carries
`authenticatedLimiter`, and it is the clearest case of the criterion rather than a
borderline one: it runs the publish transaction once per waiting object, so its
cost scales with the source's backlog instead of with the request, and it can
reach the post-commit placement on any of them. Named in full rather than as "the
same limiter" — the sentence used to sit at the end of the paragraph above, where
the nearest antecedent was the gate switch, a route that carries none.

CodeQL raises `js/missing-rate-limiting` on every route this section exempts, on
either router — the curator ones in `experienceRoutes.ts` and the admin gate switch
in `adminRoutes.ts` — and each such alert is dismissed against this section. The
count is deliberately not written down, because it has already been wrong twice:
once when a route was added to a row of this table, and once when this sentence
outlived the route it counted.

## Adding rate limiting to new endpoints

When adding a new route, choose the appropriate limiter:

| Endpoint type | Limiter to use | Import from |
|---------------|----------------|-------------|
| Public read (no auth) | `publicReadLimiter` | `middleware/rateLimiter.ts` |
| Public search / external API call | `searchLimiter` | `middleware/rateLimiter.ts` |
| Authenticated user action | `authenticatedLimiter` | `middleware/rateLimiter.ts` |
| Auth flow (login, register, etc.) | Create dedicated limiter | `middleware/rateLimiter.ts` |
| Admin/curator only | None needed | — |
| Admin/curator, **and** long-running or destructive | `expensiveAdminLimiter` | `middleware/rateLimiter.ts` |
| Curator batch whose cost scales with a backlog | `authenticatedLimiter` | `middleware/rateLimiter.ts` |

The criterion for the long-running row is not "is it admin-only" but "does a repeat
request cost more than the request": long-running, destructive, or discarding the
previous run's result. Being behind `requireAdmin` does not make a 130-second
destructive operation safe to fire six times a minute by accident.

The last row exists because those two answers pull apart for a curator working a
queue. `publish-waiting` qualifies as expensive — its cost is one transaction per
waiting object — but 5/min is a ceiling on *the person*, and a curator answering a
backlog in batches would hit it mid-work. So the rule is: bound the runaway client
at 60/min and leave the human alone, unless a single call is expensive on its own
(a re-match is 20–130s and discards its predecessor's output; a publish is one
transaction). § 5 above records which routes this has been applied to and why.

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

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
| `expensiveAdminLimiter` | 1 min | 5 | `POST /api/admin/wv-import/matches/:worldViewId/rematch`, `GET /api/admin/data-assertions` |
| `authenticatedLimiter` | 1 min | 60 | `POST /api/admin/data-assertions/accept`, `POST /api/experiences/:id/publish`, `POST /api/experiences/:id/admission`, `POST /api/experiences/categories/:categoryId/publish-waiting`, `POST /api/experiences/locations/:locationId/state`, `PATCH /api/experiences/locations/:locationId/edit`, `POST /api/experiences/:id/accept-source` |

The catalogue checks split across both buckets on the same rule, and the split is
the point. `GET /api/admin/data-assertions` runs a statement per assertion over
the whole catalogue — about 11 seconds, of which the rung rule is 8 because it
reads a full-resolution geometry column for every row — so it is expensive on its
own and takes the five-a-minute bucket. `POST …/accept` runs one of those statements and inserts
one row, and the state the screen exists for is a database where nobody has
answered for anything: a press per invariant. No count is written here, for the
reason the ASVS note gives: a number above a list is what goes stale when a rule
joins it, and a rule joining moves the statements and the invariants together.
The order the two buckets were in has since inverted, and the split survives it.
One statement now takes eight seconds on its own — the rung rule, which reads a
full-resolution geometry column (#685) — so the 60-a-minute bucket admits up to
eight minutes of database work per minute against the five-a-minute bucket's five
scans of about eleven seconds. What carries the split was never the ratio: it is
what each is a ceiling on. The report is a whole scan any caller can repeat at
will, while an accept is a person answering for one rule and runs out of rules to
answer for, and pressing the same one again records the same number. Every limiter here is keyed by IP,
so five a minute is five for the whole address that admin works from — on the
expensive bucket they would be refused halfway through their first pass, a minute
at a time, which is the failure the last row of "Adding rate limiting to new
endpoints" warns about.

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

The ones that remain — `/:id/state`, `/:id/decline-source`, `/:id/decline-held`,
`/:id/works/:treasureId/edit`, `/review/queue` — stay exempt, checked rather than
assumed: each ends at `res.json` with nothing after its `client.release()`. `/:id/decline-source` is the plainest of
them: it writes one small row per field and does not touch the experience at all,
because the value it refuses had already won every run. `/:id/decline-held` (#722)
is the same shape one gate over and joined the list on the same check rather than
on the resemblance: a handful of small rows, one `UPDATE experiences` that only ever
clears a pointer, an audit row, and nothing after the commit. Its opposite,
`/:id/publish`, is in the table above because publishing can reach
`placeAfterRelease`; refusing cannot, because it writes nothing that could move a
pin. `/:id/works/:treasureId/edit` (#720) is the newest and is the one worth reading
against its own sibling: `/locations/:locationId/edit` is in the table above
because a corrected coordinate always re-places the object, and a work has no
coordinate — one locked object, one locked row, an audit row, and nothing after
the commit. Resemblance to a limited route is not the criterion; reaching
`placeAfterRelease` is. `/:id/accept-source` was on this list until
accepting a coordinate started moving a pin; it is in the table above now, for the
reason given below it. That is the second time a route has left this list by
growing post-commit work, which is why the list is re-read against the handlers
rather than carried forward.

`POST /api/experiences/locations/:locationId/state` — a curator's verdict on one
point of an object (ADR-0026) — carries `authenticatedLimiter`, and it is worth
saying why the obvious reading is wrong, because the first draft of this section
took it. The endpoint looks like `/:id/state`: one locked row, one `UPDATE`, one
audit row, and an answer that leaves the point where it was is exactly that. An answer
that **changes what a reader sees** is not, in either direction — and both directions
are reachable, because **a withdrawn point holds no `auto` region rows**: the run that
marked it re-placed the experience, and placement takes offered points only
([ADR-0022](../decisions/0022-locations-are-marked-not-deleted.md)). Measured on the
live row before this was written: 0 region rows against the offered point's 3. So
revealing a point has to call `placeAfterRelease` after committing — the same
post-commit placement `/:id/publish` is limited for — or it puts a pin on the map that
counts in no region; and hiding one has to call it too, or a region goes on counting a
place nobody is shown. The criterion decides per branch, again.

`PATCH /api/experiences/locations/:locationId/edit` — a curator's correction to one
point (ADR-0029) — carries the same limiter, and it is the plainest case of the
criterion because there is no branch to decide. Its sibling above has an answer that
costs one locked row; this one does not: a coordinate a curator moved may fall in a
different region, so every correction that touches the coordinate calls
`placeAfterRelease` after committing, which is the same post-commit placement
`/:id/publish` is limited for. A rename is the one shape that places nothing — a label
is not a place — and it is not worth a second limiter to separate them.

`POST /api/experiences/:id/accept-source` joined them when accepting a coordinate
stopped being a pure claim release. Handing the object's `location` back also hands
back the pin that carried it, and the pin is put on the coordinate that run offered
rather than left for the next one to retire the row — so a place moves, and a place
that moves has to be re-placed after committing, exactly as the correction above does.
The other five fields it accepts place nothing, and the endpoint asks the criterion per
request the way `/state` does; the limiter is on the route either way, because a route
is what a limiter can be attached to.

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
- **Two read tiers take their ceiling from the environment**, because one IP is
  one visitor everywhere except the isolated E2E stack, where every request
  comes from a single browser container and the whole smoke suite shares one
  budget. `RATE_LIMIT_PUBLIC_READ_MAX` and `RATE_LIMIT_SEARCH_MAX` are read once
  at import by `readCeiling()`, and **only a positive integer moves them** —
  unset, empty, fractional, zero or unparseable is the production number, so an
  environment nobody configured is the strict one. `docker-compose.test.yml` is
  the only place that raises them, and it raises rather than removes them so a
  runaway loop is still stopped by something. `rateLimiter.test.ts` pins the
  fallbacks, the wiring, and that no auth or write tier reads the environment at
  all.

  Worth knowing for the next lane failure: exhausting this budget does not look
  like a rate-limit error anywhere. `GET /api/world-views` answers 429, the
  client reads the rejection as an empty list, and the app draws its "fresh
  installation" screen with no world view to adopt — which reads as a seeding
  problem. Suspect the budget when a whole suite's first navigation stops
  working and nothing in the failure names a limit (#592).

# SECURITY.md

## OWASP ASVS Target Level: 2

We target ASVS Level 2 (standard security for apps handling personal data).
Level 1 requirements are mandatory. Level 2 requirements are expected.
Level 3 requirements are tracked but optional for now.

## Application Profile

- **Type**: Web application (travel/region tracking with user accounts)
- **Auth**: Email/password + Google OAuth 2.0 (Apple Sign-In planned)
- **Data sensitivity**: User travel history, visited regions, location preferences
- **APIs**:
  - REST API (Express). Public read endpoint: `GET /api/world-views/regions/:regionId/members/descendant-geometries` (optionalAuth, publicReadLimiter)
  - Internal CV microservice (FastAPI, Python 3.12, port 8000). Routes: `POST /pipeline/phase1`, `/pipeline/phase2`, `/pipeline/match`, `/pipeline/respond/{review_id}`, `GET /health`. **Internal-only** — reachable only from the Node backend over the Docker bridge network; no CORSMiddleware; not exposed externally
- **File handling**: Server-side image downloads from Wikimedia/UNESCO (Node side). cv-python accepts curator-submitted map images via multipart upload (`UploadFile`) for the OCR/clustering pipeline; it processes the bytes in memory, never writes them to disk under user-controlled names
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

## Trust Boundaries

- **Browser ↔ Node backend** — public boundary. All standard ASVS hardening applies.
- **Node backend ↔ OpenAI** — the model is an untrusted execution surface, and stored operator text (a world view's `source`/`description`) reaches it. Treated as a boundary: that text is data, never instruction. With web search enabled the model also holds a tool, so injected text could otherwise redirect an outbound fetch.
- **Node backend ↔ cv-python** — private Docker bridge. cv-python has no auth; trust derives from network isolation. Anyone with intra-network access could call cv-python directly. ASVS L2 considers this defence-in-depth — adequate for the current threat model but documented as a known limitation; if cv-python ever moves out of the bridge or onto a shared cluster, a shared-secret header or mTLS becomes mandatory.
- **cv-python ↔ external services** — none. cv-python is sandboxed at the network level (only Wikimedia downloads happen on the Node side).

## Current Security Stack

| Layer | Implementation |
|-------|---------------|
| Password hashing | bcryptjs, 12 salt rounds |
| JWT | jsonwebtoken, HS256 only, iss/aud claims, 15min access + rotated refresh with family tracking |
| Auth middleware | requireAuth, requireAdmin, requireCurator, optionalAuth |
| World view visibility | Two mechanisms. `requireVisibleWorldView` gates the region/experience-by-region read surface by `world_views.is_public`, answering 404 (not 403) for a hidden or nonexistent world view. `getWorldViews` filters the world view listing the same way. `GET /api/experiences/:id` can't use that guard — the experience itself is public data, only its world-view association is sensitive — so it filters the `regions[]` array it returns instead, using the same predicate. Admins bypass all three. That array carries a **second** filter on a different axis since #521: a region is named only where the object has a point there that this caller may see, so an assignment a gated run made on an unread point does not disclose the region it landed in (ADR-0025 decision 5 has placement write such points into `experience_regions` deliberately). Admins bypass that one too, but they are not alone: it is relaxed on `maySeeUnreadExperience`, so a curator whose scope reaches the object is served the whole array — a curator reading a queue item has to be shown where publishing will put it. A manual assignment is exempt from it, having been made by a curator rather than derived from a point. See [world-views.md](../tech/world-views.md). Beyond the filtering itself: because the listing's rows depend on the caller, the response is marked `private, no-store` with `Vary: Origin, Authorization`, so it cannot be shared-cached and served to the wrong one. The client counterpart is in `useNavigation`: the listing is cached per identity, and when the visible list changes a selection absent from it is replaced, the address rewritten, and the selected region, division and breadcrumbs cleared — with Discover's own trail going with it, since #644 has Discover derive its trail from the same region rather than keeping one of its own, so a world view that stops being visible cannot stay on screen in either mode. Since #644 the world view, the region and the open card are all in the **address** (`/wv/5/r/6737-europe/e/1234-stonehenge`, [ADR-0034](../decisions/0034-a-place-has-an-address.md)), which changes what a URL can be used to ask and answers it the same way: every id in an address is restored through the reads above and no others, so a URL naming a hidden world view, a region of one, or an experience this caller may not see gets exactly the 404 those reads give — and the app then degrades to the nearest visible place silently, with no error surface and no distinction between "does not exist" and "not for you". A URL carries no personal state (no visited rows, no user ids), since addresses travel through referers, logs and chat. |
| Validation | Zod schemas on all routes (body, query, params via `validate()` middleware). SSE endpoints include `token` in query schema to preserve JWT for auth |
| ORM | Drizzle ORM + parameterized `pool.query()` |
| Headers | Helmet (CSP, X-Frame-Options, etc.), plus per-response cache control where a body varies by caller: `GET /api/world-views` sends `Cache-Control: private, no-store` and `Vary: Origin, Authorization`, because Express's default ETag + `Vary: Origin` says nothing about who asked and would let a proxy hand an admin's list, unpublished world views included, to an anonymous visitor |
| Response compression | `compression` middleware on every response the client accepts an encoding for (`backend/src/middleware/compression.ts`), brotli or gzip, above a 1 kB threshold. **Nothing under `/api/auth` is compressed**, whatever its size. Those bodies carry the access token, and compressing a body that mixes a secret with attacker-supplied input is the BREACH class of attack — an attacker who can both influence the reflected part and observe the response's size reads the secret out of how well it compresses. Nothing in this backend is known to be that shape today: no auth response reflects request input, the refresh token travels in a `Set-Cookie` header (headers are not compressed), and the catalogue reads that *do* carry attacker-influenceable text — a search term, a name from an external source — carry no secret beside it. The exclusion is there because that reasoning has to stay true on every route added later, and the prefix costs nothing to exclude: no route there is large enough to gain from compression. The path it tests is derived by `parseurl.original(req)` — the module Express's own router matches on — and lowercased, because Express routes case-insensitively. Taking the path from the same place the router takes it is what makes the two unable to disagree, and that is not a theoretical nicety: `req.url` has been rewritten by the time the filter runs (a request to `/api/auth/login` is handled with `req.url` set to `/login`), and `originalUrl` is a request *target* rather than a path — in absolute form, `POST http://host/api/auth/login HTTP/1.1`, which Node's parser accepts and Express still routes to the auth handler, it is the whole URI, so a string prefix test against it fails and the response would be compressed. Not browser-reachable today, since browsers send absolute form only to proxies — but the reverse proxy of #585 is exactly what would put one in front of this backend, and both cases are regression-tested. Two further exclusions are correctness rather than security: `text/event-stream` (the middleware buffers, so a progress stream would arrive in one lump) and the content types the library's default filter already refuses. On the caching side the middleware appends `Accept-Encoding` to `Vary`, which composes with the per-caller `Vary: Origin, Authorization` in the Headers row rather than replacing it — a shared cache keyed on one axis but not the other is the failure both are there to prevent |
| CORS | Restricted to FRONTEND_URL origin |
| Rate limiting | express-rate-limit on all endpoint tiers (auth, search, public read, authenticated user), plus one named admin exception — the destructive world-view re-match at 5/min. See [rate-limiting.md](../tech/rate-limiting.md) |
| Email verification | nodemailer with console fallback; 24h tokens, anti-enumeration |
| Password breach check | HIBP k-Anonymity API on register + password change |
| SAST (Node) | Semgrep via Docker (`npm run security:scan`) — p/default, p/owasp-top-ten, p/nodejs, p/react, p/secrets: **511 rules** over the whole repository. CI's Security Scan job runs this same npm script, so local and CI cannot drift; the image is pinned by digest. Why five packs and not one — see [Semgrep Ruleset Composition](#semgrep-ruleset-composition) |
| SAST (Python) | Bandit (`npm run security:py:bandit`) + Semgrep (`npm run security:py:semgrep`) — p/default, p/python, p/owasp-top-ten, p/secrets: **330 rules** on `cv-python`. Run by CI through the same npm script and pinned by digest. Ruff `S` (flake8-bandit) ruleset enforced inline at lint time |
| Dependency scanning (Node) | `npm run security:deps` — npm audit for backend + frontend (production deps only, `--omit=dev`) |
| Dependency scanning (Python) | `npm run security:py:deps` — pip-audit on `cv-python/requirements.txt` |
| Container CVE scanning | `npm run security:image` — Trivy scans the cv-python Docker image, fails on HIGH/CRITICAL **that have a fix available** (`--ignore-unfixed`, matching the CI job). A CVE with no released patch cannot be acted on in a Dockerfile that already runs `apt-get upgrade`, so blocking on one would stop every unrelated PR until the distro catches up; `cv-python/Dockerfile` pulls the newest published packages at build time, which is the actionable half |
| Gate tooling provenance | Every tool the **Node and Docker** half of `npm run check` runs is pinned by identity rather than resolved at run time. `madge` is a root devDependency installed from the tracked root `package-lock.json` — integrity-hashed, `npm ci` in CI — and the shellcheck and hadolint images carry an `@sha256:` digest beside their tag, as the Semgrep image already did. Until #490, `lint:circular` ran `npx --yes madge@8.0.0`, which resolved madge's entire transitive tree from the registry on every invocation: the code that executed in CI was whatever the registry served that minute, unrecorded and unrepeatable, and a resolution failure inside it read as a dependency problem in this repo. **The Python half is weaker, and this row does not claim otherwise**: `cv-python/requirements-dev.txt` pins each tool's own version (`ruff==0.8.4`, `mypy==1.13.0`, `bandit==1.8.0`, `pip-audit==2.7.3`) and nothing beneath it — there is no lock file and no `--require-hashes`, so those transitive trees resolve fresh from PyPI on every `setup:py:dev`, which is the shape `npx --yes madge@8.0.0` had |
| Static analysis (semantic) | CodeQL (JS+Python) via GitHub default-setup code scanning |
| Secret detection | GitHub native secret scanning + push protection (server-side) — these read every file type, but match **known provider patterns only**; generic-secret detection is opt-in and not enabled. Semgrep `p/secrets` (CI) is the source-code half, **bounded by `.semgrepignore`**, which drops `*.yaml`, `*.yml`, `*.json`, `*.sql` and `*.md` — so `docker-compose.yml`, `martin/config.yaml`, `.github/workflows/*.yml`, every `package.json` and `db/init/01-schema.sql` are never read by it. The two layers therefore do **not** compose into full cover: a generic credential in an excluded config file is seen by neither. See Known Gaps |
| Curator-scoped publication | `POST /api/experiences/:id/publish` (`requireAuth + requireCurator`, [ADR-0025](../decisions/0025-per-source-curation-gate.md)), `POST /api/experiences/categories/:categoryId/publish-waiting` (same guards) and `POST /api/experiences/:id/admission` (where overriding a refusal on an unread arrival marks it read and publishes its contents through the same code) are the endpoints that make content from a gated source visible to readers — named rather than counted, since the count in this sentence was wrong within one PR of being written. They are the counterpart to the withdrawal row below: **they** move rows *toward* the public, so **their** authorization is the whole of their safety. All three reach `publishContents` and stamp `published_at`, which is why the claim belongs to the set rather than to the first of them. Scope is resolved server-side by `resolveExperienceScope` before the transaction opens — the same function every other experience-level curator write uses — so a region-scoped curator cannot publish an object outside the regions they cover, and the audit row names the region their authority came from. Two IDOR surfaces beyond the container: `locationIds` and `treasureIds` are re-scoped inside the statements that use them (`experience_id = $1`, and the treasure write goes through this experience's own `experience_treasures` rows), so an id belonging to another object publishes nothing. Everything the decision rests on — the row's state, `curated_fields`, and the run whose proposal is held — is re-read under `SELECT … FOR NO KEY UPDATE` (`OBJECT_LOCK`, the one mode every curator write takes on an object — it self-conflicts, so two curators still serialise, and it does not conflict with the key share a foreign key takes, which is what keeps a curator and a sync run from deadlocking on the same object) in the writing transaction, and `expectedSyncLogId` is compared against it, so a stale card answers 409 with the current server-side value instead of publishing content the caller never saw. Held values come from the run's own changeset, never from the request body; the request carries ids and one run id and nothing else that reaches a column. One deliberate widening on the response side: where the post-commit region re-assignment fails, the reply names the world views it failed for — `id` and `name`, including a world view whose `is_public` is false. That is accepted rather than overlooked. The remedy is admin-only, so a curator's only actionable step is to tell an admin which object and which world view, and an id alone makes them the messenger of a number they cannot read; measured against what the role already sees — every unpublished row and every held proposal in their scope — the name of a structure they are reporting a failure in is the smaller disclosure. It reaches no reader: the field appears on the responses of the curator-gated endpoints that can trigger that re-assignment — `/:id/publish`, `/:id/admission` (where an override publishes an arrival's contents), `publish-waiting`, which carries one entry per object it released, `/locations/:locationId/state`, whose answer re-places the point in either direction whenever it changes what a reader sees — revealing a withdrawn point and hiding one a curator called gone both reach placement, so the name can arrive on either branch — `/locations/:locationId/edit`, where a corrected coordinate is a region fact and the object is re-placed on it, and `/:id/accept-source`, which puts a released pin back on the source's coordinate and therefore places for the same reason, and `requireCurator` gates every one of them. Named rather than counted, because the count in this sentence has already gone stale once by a route joining the set. The batch differs from the single publish in blast radius rather than in guards: scope is resolved per object rather than once, so a region-scoped curator releases only what they cover and the reply reports the rest as a count rather than publishing it; each object is its own transaction, its own `OBJECT_LOCK` re-read and its own audit row; and gate-held field proposals are deliberately excluded, because applying one rewrites a row a reader is already looking at with a value nobody read, and a batch cannot satisfy `expectedSyncLogId` truthfully. What the batch does hold that the single endpoint does not is an unbounded loop over a source's backlog inside one request — reachable, measured and tracked as #535 |
| Automated content withdrawal | One path lets a sync run remove content from public view without a human: a category's own rule refusing a row (`admission`, [ADR-0024](../decisions/0024-a-category-may-refuse-what-the-source-still-lists.md)). Everything else a run observes is inert until a curator answers it, and that property is deliberate — an upstream outage must not empty the site. The narrowing is bounded by four guards in `services/sync/admission.ts`: only a source declaring `recomputesMembership` may sweep, the run must have finished with zero errors and uncancelled, the admitted set must hold at least half the previous one, and a row a curator pinned is never touched. A refusal names the object and carries the rule's reason, so every withdrawal is attributable and reversible from the review queue — including after a curator has confirmed it, since the queue keeps a `keptOut` list of confirmed refusals and `override` stays open on a pinned row. That is deliberate: a withdrawal a curator cannot undo is a withdrawal, and this is the one axis whose rows no reader toggle reveals. Curator-created rows (`is_manual`) are outside the mechanism entirely |
| Curator verdicts on one point | `POST /api/experiences/locations/:locationId/state` (`requireAuth + requireCurator`, [ADR-0026](../decisions/0026-a-run-records-what-a-container-holds.md)) answers whether a point a sync stopped offering is delisted, gone, or was never gone. A point carries no scope of its own, so the only id in the request is resolved to its containing experience server-side and `resolveExperienceScope` is then asked about *that* — a region-scoped curator cannot answer for a point inside an object outside their regions, and the audit row names the region their authority came from. The row's two axes and its flag are re-read under the row's own `FOR UPDATE`, inside a transaction that has already taken `OBJECT_LOCK` on the containing experience, and compared with the `expected` block the card sent, so a stale card answers 409 with the current server-side values rather than recording a verdict about a question that has moved. On the visibility side, what this endpoint can do is exact rather than narrow, and it moves in both directions. `missing_since` is now half of what every reader-facing read carries — `offeredLocationSql` is `missing_since IS NULL AND existence <> 'lost'` (ADR-0026 decision 7) — so the false-alarm answer (`present` + `extant`) reveals a flagged point by clearing the flag, `former` leaves a flagged point exactly as invisible as the run left it, and **`lost` can remove an offered point from view**, which is the one answer here that takes something away from readers. That is the verdict's purpose — a component a curator says is demolished is nowhere to send anyone — and it is bounded the way the rest of this row describes: curator-gated and scope-resolved through the containing experience, compared against the `expected` block under the write lock, logged as `location_marked_lost` naming the point, reversible through the same endpoint, and never a deletion. It also re-places the object either way, so a region stops counting a place nobody is shown. Nothing here deletes — `user_visited_locations.location_id` cascades, so a delete would erase someone's record of having stood there ([ADR-0022](../decisions/0022-locations-are-marked-not-deleted.md)) — and every verdict stays correctable through the same endpoint, logged as `location_state_restored`. One deliberate disclosure on the read side: the queue's withdrawal card tells a curator **whether anyone had visited** the point (`visited`, a boolean from `user_visited_locations`). It names no person and carries no count, and it is what makes the verdict a decision rather than tidying — a place somebody stood in stops being displayed either way. Accepted as the smaller disclosure against the alternative of a curator answering blind, and measured against what the role already sees: every unpublished row and every held proposal in their scope. It is behind `requireCurator` and reaches no reader. The **answered** half of that card (`answeredWithdrawals`, #544) carries the same boolean on the same terms, and one disclosure of its own: it names the curator who gave the standing verdict. That name is read from `experience_curation_log` under the log's own scope predicate — the one `getCurationLog` and the conflict card use — and not off `experience_locations.state_decided_by`, which carries no region and would therefore name a curator whose act the log endpoint drops for the same reader. A verdict made in a region this curator does not cover arrives unnamed, and the card says "a curator": somebody decided, and who is not this reader's to see. The list itself is scoped like every other kind, through `CURATOR_SCOPED_REGIONS_CTE` on the containing object |
| Curator corrections to one point | `PATCH /api/experiences/locations/:locationId/edit` (`requireAuth + requireCurator + authenticatedLimiter`, [ADR-0029](../decisions/0029-what-an-object-is-made-of-can-be-curated.md)) is the write beside the verdict above, and it is scoped the same way: a point carries no scope of its own, so the only id in the request is resolved to its containing experience server-side and `resolveExperienceScope` is asked about *that*. A region-scoped curator cannot correct a point inside an object outside their regions, and the audit row (`location_edited`) names the region their authority came from. The body is `name`, `latitude`, `longitude` and nothing else — bounded by Zod (`±90`/`±180`, 500 characters) and refused unless the coordinate arrives as a pair, since half a move names somewhere nobody chose. Every value is a bound parameter; the only interpolation in the statements is the shared `offeredLocationSql`/`publishedContentSql` fragments and a claim-key literal from a two-member TypeScript union, neither of which a request can reach. **What it can do to readers** is the part worth stating exactly: it writes a claim, so the source stops being able to correct that field on any later run — the same effect `curated_fields` has always had on an experience, now available on rows that outnumber objects four to one, and taken back only by `accept-source` on the object, which releases the coordinate on both levels at once because releasing one of them is what leaves the object and its pin disagreeing, and which writes that run's own offered coordinate onto the released pin rather than leaving the next run to retire the row — and only where the object holds one reader-visible point, so a serial site's corrected component has no way back at all — and where the object holds exactly one point a reader is positioned over *and it is this one*, it also moves the object's own coordinate. Both conditions live inside the statement's own `WHERE` rather than in a read before it, so a second point arriving in between cannot leave the anchor moved for a reason that stopped being true. It re-places the experience into regions after committing, which is why it carries the same limiter `/:id/publish` does and why its reply is one of the responses that **name** the world views a failed re-assignment left stale — the disclosure argued for two rows above, on the same terms. It deletes nothing: a correction is reversible by another correction, and the trail names both sides of every change |
| Cached source answers | `GET`/`DELETE /api/admin/sync/categories/:categoryId/cache` and `PUT …/cache/:kind/ttl` ([ADR-0030](../decisions/0030-answers-from-a-source-are-kept-with-an-expiry.md)) are admin-only by the mount (`router.use('/api/admin', requireAuth, requireAdmin, …)`), like everything on that router. Every request value is bound rather than interpolated: the category id is a parsed integer, the kind is a Zod-bounded string compared by equality — an unknown kind deletes nothing — and the lifetime is a number bounded at both ends (a minute to a month), so neither a zero nor an unbounded lifetime can be set. What the panel renders back is our own text and third-party text side by side: `label` is built by the call site, but it interpolates Wikidata's own class labels (`pool: painting, 100+ sitelinks`), and `query_text` is our SQL. Both are rendered as React children and never as markup, which is the same escaping every other source-derived string on an admin screen gets. The cached bodies themselves are never served to a reader — they decide only whether a sync asks the source again, and a run can be told to ignore them entirely |
| Catalogue checks | `GET /api/admin/data-assertions` and `POST /api/admin/data-assertions/accept` ([ADR-0032](../decisions/0032-a-rule-stays-absolute-and-the-debt-is-recorded.md)) are admin-only by the mount (`router.use('/api/admin', requireAuth, requireAdmin, …)`) and rate-limited apart from each other: the read carries `expensiveAdminLimiter` (5/min) because a statement per assertion over the whole catalogue is expensive whoever sends them (no count here: a number above a list goes stale when a rule joins it), while the accept carries `authenticatedLimiter` (60/min) — it re-runs one of those statements and inserts one row. Since #685 one of those statements takes eight seconds on its own — the rung rule, which reads a full-resolution geometry column — so the order the two buckets were in has inverted: 60 accepts a minute is up to eight minutes of database work per minute from one address, against the report bucket's five scans of about eleven seconds. What carries the split was never the ratio but what each is a ceiling on. The report is a whole scan any caller can repeat at will; an acceptance records one rule, and a person answering for them runs out of rules to answer for; a second press of one records the same number. The 5/min bucket is keyed by IP like every limiter here, so it is five for the whole address an admin works from and would refuse them halfway through answering for a database nobody has answered for yet. **The write takes an id and no number**: the body carries `assertionId` only, Zod-bounded to the column's own width, and the count recorded is the one the server measures as it records it, so neither a stale screen nor a hand-made request can write a figure the catalogue never held. The id is compared by equality against the in-code list — an unknown one records nothing — and a `watch` is refused, since its rows are legitimate and there is nothing to answer for. Nothing user-supplied reaches a column except that id and the authenticated user's own id. What the report renders back is catalogue text from outside sources: the sentences are built server-side and every stored string passes through a helper that replaces control characters, because a Wikidata label is editable by anybody and a name carrying an escape sequence would otherwise reach a terminal or a log intact; on the screen they are React children and never markup. The report names places and objects, never a person — the visit count is grouped by place, so who went where does not travel to an admin screen |
| Containers | Dockerfiles run as non-root user (`node` for backend/frontend, `appuser` for cv-python) |
| LLM prompt construction | System prompts are static. Operator-supplied text (`world_views.source`, `world_views.description`) is sanitised by `sanitizePromptData()` and quoted inside `<<< >>>` in the **user** message only; every system prompt carries `UNTRUSTED_DATA_RULE`. See `backend/src/services/ai/openaiShared.ts` |

## Semgrep Ruleset Composition

Both scans run `p/default` — Semgrep's own curated baseline — alongside the
targeted packs. It was added in #481, after a planted `eval(userInput)` produced
zero findings under the previous four-pack Node configuration. `p/default` flags
it as `javascript.browser.security.eval-detected`, and the probe is re-run
whenever this configuration changes: plant the call in a `.ts` and a `.js` file,
`git add -N` them (Semgrep only scans git-tracked paths), and confirm
`npm run security:scan` reports both and exits non-zero.

The other packs are kept rather than folded in, and that is a measurement rather
than an assumption. The measurement has to be **leave-one-out** — for each pack,
what is lost if it alone is removed from the configuration — and not pairwise
against `p/default`. Pairwise is the tempting version and it gives the wrong
answer: `react-unsanitized-property` is absent from `p/default`, which makes
`p/react` look load-bearing until you notice `p/owasp-top-ten` carries it too.

Rule ids at the pinned version, via `semgrep show dump-config p/<pack>`:

| Pack | Rule ids | Unique to it in the Node config | Unique in the Python config |
|---|---|---|---|
| `p/default` | 947 | **479** | **478** |
| `p/owasp-top-ten` | 503 | **67** | **38** |
| `p/secrets` | 50 | **1** — `detected-google-gcm-service-account` | **1** — same |
| `p/nodejs` | 36 | **0** | not in this config |
| `p/react` | 4 | **0** | not in this config |
| `p/python` | 139 | not in this config | **0** |

(Rule *ids* in a pack, not rules *run*: the run counts of 511 and 330 are what
survives filtering to the languages and files actually present.)

So three packs carry the configuration — `p/default`, `p/owasp-top-ten` and, by
exactly one rule, `p/secrets`. The language packs `p/nodejs`, `p/react` and
`p/python` contribute **nothing** at this version; each is fully covered by the
union of the others. They are kept anyway, and uniformly: dropping them would
trade a redundancy anyone can see for a silent dependency on Semgrep never
recomposing its packs, and the failure mode of that dependency is a rule
quietly ceasing to run. Rules are deduplicated by id, so the redundancy costs no
scan time. Re-run the leave-one-out when the pinned version is bumped — if a
language pack ever grows a unique rule again, that is worth knowing.

### Accepted suppressions

Adding `p/default` raised 54 findings on this repository. 17 were fixed and 37
suppressed. Every suppression is inline (`// nosemgrep: <rule-id> -- <reason>`)
rather than a rule-level `--exclude-rule`, so each rule stays live for code
written after this branch:

| Rule | Suppressed | Why it cannot fire there |
|---|---|---|
| `unsafe-formatstring` | 28 | The interpolated value is a number or a module constant, so no format specifier can reach `util.format`. The **16** sites where externally-sourced text *did* sit in the format-string position — Wikivoyage page titles, Commons filenames, imported region names, a `req.params` Wikidata id, synced item ids — were fixed instead, by making the format string constant and passing the value as an argument |
| `path-join-resolve-traversal` | 3 | In `wikivoyageExtract/index.ts`, one path comes from `readdirSync` of the cache dir itself and the other is inside `safeCachePath`, past its own rejection of separators and `..` and ahead of its `dirname` re-check. The third is a test fixture loader |
| `detect-non-literal-regexp` | 2 | One re-compiles an existing `RegExp` from its own `source` to add the `g` flag; the other is an alternation of regex-escaped literals — no quantifier over a group, so no catastrophic backtracking |
| `formatted-sql-query` + `sqlalchemy-execute-raw-query` | 4 (2 lines × 2 rules) | `db/init-db.py` uses `sqlite3`, not SQLAlchemy. The interpolated value is a SQL **identifier**, which cannot be bound as a parameter — so it is validated instead: the GeoPackage layer name must match `TABLE_NAME_RE` where it is read out of `sqlite_master`, or the script exits. The suppression rides on that check |

The one remaining fix was `missing-integrity` on `frontend/index.html`, which
loaded `maplibre-gl.css` from `unpkg.com` with no subresource integrity. Rather
than add an SRI hash, the tag was removed: `maplibre-gl` is already a frontend
dependency, so the stylesheet now comes from the package via `main.tsx`. That
drops a third-party runtime dependency and closes the gap where the hard-pinned
CDN version could drift from the one in `package.json`.

## cv-python Hardening (V5/V8/V13/V16)

The Python service has a smaller surface than the Node backend but introduces new V5 (file upload) territory and a V8 boundary (intra-cluster traffic):

| Concern | Status | Notes |
|---|---|---|
| File upload size cap | enforced | `BodySizeLimitMiddleware` (`cv-python/app/middleware.py`) rejects requests with `Content-Length` exceeding `CV_MAX_BODY_BYTES` (default 100 MB) before the body is buffered, returning 413. Uvicorn has no equivalent CLI flag — middleware is the standard ASGI mechanism. |
| File-format validation | enforced | `decode_image()` checks `cv2.imdecode` return for `None` and rejects non-image bytes; image dimensions clamped after decode |
| Authentication | n/a (network-isolated) | Trust boundary documented above |
| Authorization | n/a | Service has no per-resource state |
| Error response sanitization | enforced | NDJSON `{"type":"error","message":...}` carries a generic message; full traces stay in container stdout |
| Worker-thread bounds | enforced | uvicorn `--limit-concurrency`; no unbounded `threading.Thread` daemons |
| Logging | partial | `print()` to stdout, collected by Docker. Structured logging is a follow-up |
| Container | enforced | Non-root user, slim base, no secrets baked in, Trivy fails on **fixable** HIGH/CRITICAL (see the scanning row above for why unfixable ones do not block) |

## Development-Only Switches

| Switch | Guard | Notes |
|---|---|---|
| `SYNC_SOURCE_FIXTURE` | **Refused outright when `NODE_ENV=production`** (`fixtureSource.ts`) — the only guard on the variable itself | Substitutes a local JSON file for the live UNESCO API during sync development; the value is a **directory path**, set by the operator in the environment (`/app/data/sync-fixtures` in the Docker stack) and used as given. It is not validated, and does not need to be: it never comes from a request, and anyone able to set it can already run arbitrary code in the container. The environment gate is the control, because what this switch replaces is the source of truth for a category's data. Separately, the *file name* read from that directory is a module constant (`unesco.json`) checked to be a bare name, so the read cannot walk out of the configured directory |

## Known Gaps

- **Semgrep reads source files only.** `.semgrepignore` excludes `*.yaml`,
  `*.yml`, `*.json`, `*.sql` and `*.md` on the stated grounds that they are
  "non-source files (no security-relevant code)". That is true of the SAST
  rulesets and false of `p/secrets`: config and manifest files are where
  credentials usually sit. `docker-compose.yml`, `martin/config.yaml`, the
  workflow files, every `package.json` and `db/init/01-schema.sql` are outside
  its reach.

  The compensating control is narrower than it first looks. GitHub's native
  secret scanning and push protection match **known provider patterns** — AWS,
  Stripe, GitHub tokens. Generic credentials need generic-secret detection,
  which is opt-in and not enabled here. And generic is the likely shape in
  precisely these files: `docker-compose.yml` carries `POSTGRES_PASSWORD`,
  `DB_PASSWORD` and a `DATABASE_URL` connection string, `martin/config.yaml` a
  `connection_string`. They interpolate env vars today rather than holding
  literals, so nothing is currently exposed — but no layer is watching that
  shape, so the protection is a convention rather than a control. **Still open
  after #481**, which widened the *ruleset* and deliberately left the *file*
  exclusions alone: the two are independent, and lifting the exclusions changes
  which files `p/secrets` reads rather than which rules it runs. That is its own
  change, with its own triage.
- **Four files are only partially analysed by Semgrep.** Its parser reports a
  syntax error and analyses what it can: `martin/warm-tiles.sh:1`,
  `backend/src/services/wikivoyageExtract/parser.ts:83`,
  `frontend/src/components/WorldViewEditor.tsx:544`,
  `scripts/setup-integrations.sh:33`. The code itself is valid — `tsc` and
  ESLint pass on the two TypeScript files, and shellcheck on the two shell
  ones — so this is a limitation of Semgrep's own grammars, not a defect to fix
  in the source. Overall coverage
  is ~99.9% of lines. Running with `--strict` would turn this into a build
  failure, which is why the scans do not use it: it would fail every PR for a
  reason unrelated to security, and the alternative — excluding the files —
  would trade a warning for a real hole. Re-check when the pinned Semgrep
  version is bumped; parser coverage is the kind of thing that improves.
- **Semgrep's ruleset was narrower than assumed (resolved).** Until #481 the
  Node scan ran four targeted packs and not `p/default`, so a planted
  `eval(userInput)` produced zero findings in either `.ts` or `.js`.
  `p/default` is now in both scans — Node 266 → **511** rules, Python 199 →
  **330** — the 54 findings it raised were triaged (17 fixed, 37 suppressed
  inline with stated reasons), and the eval probe is confirmed to report and to
  exit non-zero. See [Semgrep Ruleset Composition](#semgrep-ruleset-composition).
- **CI ran no Semgrep until August 2026 (resolved).** The Security Scan job
  used the deprecated `semgrep/semgrep-action@v1`, pinned to semgrep 1.36.0,
  which died on registry rules carrying `severity: MEDIUM` and exited zero
  anyway — so the required check passed without scanning, in every run whose
  logs are still retained. Fixed by running the same npm scripts CI-side
  (#479).

  Scoped deliberately: this was a Semgrep outage, **not** a SAST outage. CodeQL
  (JS+Python, default setup) ran throughout — see the stack table above and
  `audit-2026-05-10.md` — so semantic and dataflow analysis was never absent.
  What went missing in CI was Semgrep's pattern layer, `p/secrets` included.
  Local `npm run security:*` was unaffected and did scan, so code that went
  through the documented pre-push tier was covered; the exposure was anything
  merged on CI-green alone. Recorded because "the check was green" is not
  evidence for that period.
- **World view visibility does not reach the tile server.** `requireVisibleWorldView` and
  `getWorldViews` bound the REST API (see the security stack table above). Martin no longer
  auto-publishes tables — `martin/config.yaml` carries `auto_publish: { tables: false }`, which
  removed 27 table sources including every column of `experiences` — but `functions: true` still
  auto-discovers and publishes every compatible **function** in the database on its own public
  port (`ports:` in `docker-compose.yml`) with no authentication, so a hidden world view's
  geometry stays fetchable by tile id regardless of `is_public`. Five of the six published sources
  now take an id and answer a request that names none with an empty tile; the sixth,
  `tile_gadm_root_divisions`, takes none by design and draws the root GADM divisions for every
  caller alike. But the five do not all take the *world view's* id, so what a caller has to know
  differs by source. The three that answer for one world view take its id: `tile_region_islands`
  since #660 (the one the map itself drew unscoped), `tile_world_view_root_regions` and
  `tile_world_view_all_leaf_regions` since #662; until then both filtered on
  `p_world_view_id IS NULL OR …`, so a request naming no world view answered for all of them at
  once and a hidden world view's regions came back without anyone having to guess anything.
  `tile_region_subregions` reads the same table and takes a **region** id instead, with no
  world-view filter at all, so a hidden world view's subtree is reachable from any region id
  inside it without its own id ever being known. And the **default** world view is behind no id
  whatsoever: its map is GADM itself, drawn by `tile_gadm_root_divisions`, which takes no
  parameter, and `tile_gadm_subdivisions`, which takes a division id — so a default world view
  whose `is_public` is false is served unauthenticated with nothing to know. `is_public` governs
  it exactly as it governs any other world view and `is_default` carries no visibility meaning of
  its own, which is what makes that a reachable state rather than a hypothetical one
  (`docs/tech/world-views.md` § The default World View). Requiring the parameter narrows this
  gap; the ids are small integers, and of the six sources
  only three answer for a named world view at all — two take a different id and one takes none —
  so it does not close it. That set is discovered, not
  enumerated: it currently resolves to the six `tile_*` functions in `martin/README.md` § Function
  Sources, and a newly added compatible function would be published the same way, with no edit to
  `martin/config.yaml`. A Martin-level `postgres.functions` allowlist could pin those six
  explicitly, but building one now would be work the fix below throws away: once Martin sits
  behind an authorizing proxy, the proxy decides access per request and a function-name allowlist
  is redundant. The fix is the pattern already used for cv-python below: drop the `ports:` mapping
  so Martin is reachable only on the Docker compose network (`expose:` only), plus an authorizing
  proxy in the backend (e.g.
  `/api/tiles/:source/:z/:x/:y` against a per-source allowlist) that MapLibre reaches via
  `transformRequest`. Deferred to the tile-boundary follow-up branch, which will carry its own ADR.

  The `auto_publish: { tables: false }` change above is not live merely because it is committed.
  `docker-compose.yml` bind-mounts `martin/config.yaml` read-only and starts Martin with
  `--config /config.yaml`, so a running container keeps its old catalog — the 27 retired table
  sources keep being served — until it is recycled. On a deployed instance, restart Martin and
  confirm with the same two checks used to verify this fix:

  ```bash
  docker compose restart martin
  curl -s localhost:3000/catalog | jq '.tiles | keys'      # function sources only
  curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/experiences.1/14/8186/5447   # 404
  ```

  The scope requirement above has the same property for the same reason, one layer down. A
  function definition lives in the database, not in the image, so it reaches an existing instance
  only when `db/init/01-schema.sql` is re-applied there (the signatures do not change, so
  `CREATE OR REPLACE` carries it and no migration file is involved). And a running Martin holds an
  in-process tile cache — `cache_size_mb` is unset in `martin/config.yaml`, so its default is in
  effect — which is keyed on the request URL: measured on the development stack, an unscoped tile
  already served kept answering `HTTP 200` with the old bytes after the functions were replaced,
  while an unscoped tile not yet in the cache answered `HTTP 204`. Restart Martin after applying,
  and verify on a tile the cache cannot already hold:

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' \
    'localhost:3000/tile_world_view_all_leaf_regions/5/16/11'                   # 204
  curl -s -o /dev/null -w '%{http_code}\n' \
    'localhost:3000/tile_world_view_all_leaf_regions/5/16/11?world_view_id=5'   # 200
  ```

  The first line holds anywhere; the second names the development database's world view, and needs
  substituting for an id whose world view actually has regions inside the tile chosen — the same
  caveat `docs/tech/performance.md` carries for the probe's defaults. Two `204`s otherwise read as
  a deploy that did not land, when what they are is an empty tile for a scope with nothing in it.
- **The `Vary`/`no-store` treatment is on the world view listing only.** The sibling `optionalAuth` reads answer an anonymous caller with *less data* rather than 401 — `listExperiences`, `/experiences/by-region/:regionId` (curator rejection visibility, **and `is_new`, which varies per user rather than per role**), `/experiences/:id` (its `regions[]` filtered by world view visibility), `/experiences/region-counts`, `/experiences/:id/locations`, `/experiences/by-region/:regionId/locations` — and none of them says so in its headers. Same exposure as the listing had: a shared cache in front of the API could serve a curator's or admin's view to an anonymous visitor. The `is_new` flag widens that from three role-shaped variants to one per reader, so a cache keyed on the URL alone would leak one reader's badge state to another — still only their chips, not their data, but it is the first response here whose variance is per identity. Bounded today only by there being no such cache deployed. Tracked in #460 along with the client-side half.
- cv-python uses `print()` rather than structured `logging`. Acceptable at L2 (no auth/authz events to log), but follow up with a logging adapter once the audit/observability story expands.
- Python dev tooling (`mypy`, `pytest`, `bandit`) lives in `cv-python/requirements-dev.txt` and requires a venv at `cv-python/.venv` for the local gates — not tools on PATH, which the npm scripts never reach: each one invokes `.venv/bin/<tool>` by path, and `scripts/require-py-tools.sh` now fails the gate outright when they are absent rather than letting it read as environment noise. CI covers both shapes across two jobs: the checks job builds the same venv with `npm run setup:py:dev`, and the Python test job installs into the runner's own interpreter with `actions/setup-python` + pip.
- **Accepted advisory (June 2026):** `torch 2.12.0` — [GHSA-rrmf-rvhw-rf47](https://github.com/advisories/GHSA-rrmf-rvhw-rf47), low severity, memory corruption in `torch.jit.script`. No patched release exists (range `<= 2.12.0`, no fix version). torch is not a direct dependency — it is pulled transitively by `easyocr`, which uses it only for internal model inference; nothing in cv-python calls `torch.jit.script`, let alone on untrusted input. Suppressed via `--ignore-vuln` in the `security:py:deps` npm script; **remove the ignore once a fixed torch release ships.**

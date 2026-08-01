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
| World view visibility | Two mechanisms. `requireVisibleWorldView` gates the region/experience-by-region read surface by `world_views.is_public`, answering 404 (not 403) for a hidden or nonexistent world view. `getWorldViews` filters the world view listing the same way. `GET /api/experiences/:id` can't use that guard — the experience itself is public data, only its world-view association is sensitive — so it filters the `regions[]` array it returns instead, using the same predicate. Admins bypass all three. See [world-views.md](../tech/world-views.md). Beyond the filtering itself: because the listing's rows depend on the caller, the response is marked `private, no-store` with `Vary: Origin, Authorization`, so it cannot be shared-cached and served to the wrong one. The client counterpart is in `useNavigation`: the listing is cached per identity, and when the visible list changes a selection absent from it is replaced, `?wv` rewritten, and the selected region, division and breadcrumbs cleared — with Discover's own trail dropped by `useDiscoverExperiences` on the same trigger, so a world view that stops being visible cannot stay on screen in either mode. |
| Validation | Zod schemas on all routes (body, query, params via `validate()` middleware). SSE endpoints include `token` in query schema to preserve JWT for auth |
| ORM | Drizzle ORM + parameterized `pool.query()` |
| Headers | Helmet (CSP, X-Frame-Options, etc.), plus per-response cache control where a body varies by caller: `GET /api/world-views` sends `Cache-Control: private, no-store` and `Vary: Origin, Authorization`, because Express's default ETag + `Vary: Origin` says nothing about who asked and would let a proxy hand an admin's list, unpublished world views included, to an anonymous visitor |
| CORS | Restricted to FRONTEND_URL origin |
| Rate limiting | express-rate-limit on all endpoint tiers (auth, search, public read, authenticated user), plus one named admin exception — the destructive world-view re-match at 5/min. See [rate-limiting.md](../tech/rate-limiting.md) |
| Email verification | nodemailer with console fallback; 24h tokens, anti-enumeration |
| Password breach check | HIBP k-Anonymity API on register + password change |
| SAST (Node) | Semgrep via Docker (`npm run security:scan`) — p/owasp-top-ten, p/nodejs, p/react, p/secrets rulesets |
| SAST (Python) | Bandit (`npm run security:py:bandit`) + Semgrep (`npm run security:py:semgrep`) — p/python, p/owasp-top-ten, p/secrets. Ruff `S` (flake8-bandit) ruleset enforced inline at lint time |
| Dependency scanning (Node) | `npm run security:deps` — npm audit for backend + frontend (production deps only, `--omit=dev`) |
| Dependency scanning (Python) | `npm run security:py:deps` — pip-audit on `cv-python/requirements.txt` |
| Container CVE scanning | `npm run security:image` — Trivy scans the cv-python Docker image, fails on HIGH/CRITICAL **that have a fix available** (`--ignore-unfixed`, matching the CI job). A CVE with no released patch cannot be acted on in a Dockerfile that already runs `apt-get upgrade`, so blocking on one would stop every unrelated PR until the distro catches up; `cv-python/Dockerfile` pulls the newest published packages at build time, which is the actionable half |
| Static analysis (semantic) | CodeQL (JS+Python) via GitHub default-setup code scanning |
| Secret detection | GitHub native secret scanning + push protection (server-side); Semgrep `p/secrets` (CI) |
| Containers | Dockerfiles run as non-root user (`node` for backend/frontend, `appuser` for cv-python) |
| LLM prompt construction | System prompts are static. Operator-supplied text (`world_views.source`, `world_views.description`) is sanitised by `sanitizePromptData()` and quoted inside `<<< >>>` in the **user** message only; every system prompt carries `UNTRUSTED_DATA_RULE`. See `backend/src/services/ai/openaiShared.ts` |

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

## Known Gaps

- **World view visibility does not reach the tile server.** `requireVisibleWorldView` and `getWorldViews` bound the REST API (see the security stack table above), but Martin (`martin/config.yaml`) auto-publishes every table and function — including a hidden world view's regions — on its own public port (`ports:` in `docker-compose.yml`) with no authentication, so its geometry stays fetchable by tile id regardless of `is_public`. The fix is the pattern already used for cv-python below: drop the `ports:` mapping so Martin is reachable only on the Docker compose network (`expose:` only), plus an authorizing proxy in the backend (e.g. `/api/tiles/:source/:z/:x/:y` against a per-source allowlist) that MapLibre reaches via `transformRequest`. Deferred to the tile-boundary follow-up branch, which will carry its own ADR.
- **The `Vary`/`no-store` treatment is on the world view listing only.** The sibling `optionalAuth` reads answer an anonymous caller with *less data* rather than 401 — `listExperiences`, `/experiences/by-region/:regionId` (curator rejection visibility), `/experiences/:id` (its `regions[]` filtered by world view visibility), `/experiences/region-counts`, `/experiences/:id/locations`, `/experiences/by-region/:regionId/locations` — and none of them says so in its headers. Same exposure as the listing had: a shared cache in front of the API could serve a curator's or admin's view to an anonymous visitor. Bounded today only by there being no such cache deployed. Tracked in #460 along with the client-side half.
- cv-python uses `print()` rather than structured `logging`. Acceptable at L2 (no auth/authz events to log), but follow up with a logging adapter once the audit/observability story expands.
- Python dev tooling (`mypy`, `pytest`, `bandit`) lives in `cv-python/requirements-dev.txt` and assumes a venv at `cv-python/.venv` or system-installed tools on PATH for the local `npm run check`. CI installs via `actions/setup-python` + pip.
- **Accepted advisory (June 2026):** `torch 2.12.0` — [GHSA-rrmf-rvhw-rf47](https://github.com/advisories/GHSA-rrmf-rvhw-rf47), low severity, memory corruption in `torch.jit.script`. No patched release exists (range `<= 2.12.0`, no fix version). torch is not a direct dependency — it is pulled transitively by `easyocr`, which uses it only for internal model inference; nothing in cv-python calls `torch.jit.script`, let alone on untrusted input. Suppressed via `--ignore-vuln` in the `security:py:deps` npm script; **remove the ignore once a fixed torch release ships.**

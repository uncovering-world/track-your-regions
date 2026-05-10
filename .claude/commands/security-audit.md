# Security Audit (OWASP ASVS 5.0)

Run a security audit of the codebase against OWASP ASVS 5.0 requirements.

## Instructions

1. Read `/docs/security/SECURITY.md` for the application security profile
2. Read `/docs/security/asvs-checklist.yaml` for current verification status
3. Scan the codebase systematically by ASVS chapter (focus on chapters listed in SECURITY.md)
4. For each requirement, check if the codebase satisfies it
5. Update `asvs-checklist.yaml` with findings
6. Generate a report at `/docs/security/audit-YYYY-MM-DD.md`

## Audit Focus Areas

### Authentication (V6)
- Check password handling: hashing algorithm, min length enforcement, common password check
- Check OAuth/OIDC implementation: token validation, state parameter
- Check rate limiting on login/registration endpoints
- Check for credential exposure in logs or error messages

### Authorization (V8)
- Check every API endpoint for auth middleware
- Look for IDOR vulnerabilities (user A accessing user B's data)
- Check role-based access: regular user vs curator vs admin
- Verify curator scope enforcement (global, source, region)

### Self-contained Tokens / JWT (V9)
- Verify JWT algorithm allowlist (no 'None' algorithm accepted)
- Check token expiration validation (exp, nbf claims)
- Verify key material comes from trusted source (not token headers)
- Check if token type (access vs refresh) is validated

### Web Frontend Security (V3)
- Check HSTS configuration and max-age
- Verify CSP headers (Helmet defaults)
- Check CSRF protection strategy (JWT in Auth header vs cookies)
- Verify content rendering safety (React auto-escaping)

### Input Handling (V1 + V2)
- Check all database queries for parameterization (no string concatenation)
- Check experience data pipeline (external API data rendered in UI)
- Check URL construction (especially for external API calls to Wikidata, Wikimedia)
- Check for XSS in rendered experience names, descriptions, user names

### Data Protection (V14)
- Check what's stored in localStorage/sessionStorage
- Check API responses for over-exposure of user data
- Check if travel/visit data is properly access-controlled

### Configuration (V13)
- Scan for hardcoded secrets, API keys, database credentials
- Check .env handling and .gitignore
- Check error handling doesn't leak stack traces

### File Handling (V5)
- Check image download validation (content-type, path sanitization) — Node side
- Check file storage path construction
- Check that downloaded files aren't in executable paths
- **cv-python multipart uploads**: each `UploadFile` parameter (`/pipeline/phase1`, `/pipeline/phase2`, `/pipeline/match`) must enforce: (1) max body size via the ASGI `BodySizeLimitMiddleware` in `cv-python/app/middleware.py` (`CV_MAX_BODY_BYTES`, default 100 MB) — uvicorn has no equivalent CLI flag; deployment may add a reverse-proxy `client_max_body_size` cap in front, (2) image-format allowlist before `cv2.imdecode`, (3) null-check on `cv2.imdecode` return (handled by `decode_image()` raising `InvalidImageBytes`), (4) bounded width/height after decode

### API Security (V4)
- Check CORS configuration
- Check rate limiting (if present)
- Check request size limits
- Verify Content-Type header matches response body
- **cv-python**: verify the service is reachable only from the Node backend (Docker network isolation alone is defence-in-depth, not zero-trust); check whether a shared-secret header or mTLS is needed; check uvicorn's `--limit-concurrency` and request timeout

### cv-python service (FastAPI, internal)

- **V8 (Authorization)** — service has no auth currently; verify the deployment relies on Docker network isolation and `--host` binding is justified. If the service is ever moved out of the internal network, add a bearer/shared-secret check via `Depends`
- **V13 (Configuration)** — Dockerfile must run as non-root (currently `appuser`), pin the base image, no secrets baked in, no debug routes exposed
- **V13.4 (Error handling)** — workers stream errors via NDJSON (`{"type":"error","message":...}`). Verify the message is sanitised; raw `str(exception)` leaks paths and stack info. Add an exception handler that strips internals
- **V2.4 (Input validation)** — `params: str = Form(...)` + `json.loads()` is unvalidated. Wrap in a Pydantic model so schema violations return 422 instead of crashing the worker
- **V5 (File uploads)** — see "File Handling" above
- **V11/V12** — N/A (no crypto or external traffic from cv-python)
- **V16 (Logging)** — service uses `print()` to stdout (collected by Docker). Consider replacing with `logging` and structured fields

### Python tooling expectations

The Python toolchain must be wired up in CI on par with the Node side:
- **Lint + format** — Ruff (`E/F/W/B/I/UP/C4/SIM/RET/S` rules)
- **Type check** — mypy (permissive defaults, tighten over time)
- **Tests** — pytest with coverage
- **SAST** — Bandit (idiom-aware) + Semgrep `p/python` + `p/owasp-top-ten` + `p/secrets`
- **Dependency vulns** — pip-audit on `cv-python/requirements.txt`
- **Container CVEs** — Trivy scanning the cv-python Docker image (HIGH/CRITICAL fail)
- **CodeQL** — JS+Python via GitHub default-setup code scanning

## Report Format

```markdown
# Security Audit Report — [DATE]

## Summary
- Total requirements checked: X
- Pass: X | Fail: X | Partial: X | N/A: X
- Critical findings: X
- Level 1 compliance: X%
- Level 2 compliance: X%

## Critical Findings
[List with code references, severity, and remediation]

## Chapter Results
[Per-chapter breakdown]

## Recommendations
[Prioritized action items]
```

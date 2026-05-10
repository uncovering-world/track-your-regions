# Quick Security Check

Run a focused security check on recently changed files.

## Instructions

1. Identify files changed in the current branch (use `git diff --name-only main`)
2. For each changed file, apply the **language-agnostic** checks below, then the **language-specific** checks for whichever stack the file belongs to (Node/TS in `backend/` `frontend/`; Python in `cv-python/`).
3. Report findings inline with `file:line` references.
4. Classify as CRITICAL / HIGH / MEDIUM / LOW.

### Language-agnostic checks (apply to every changed file)

- Hardcoded secrets, API keys, tokens, private keys
- Missing auth on new endpoints (Express middleware OR FastAPI `Depends`)
- IDOR — user-supplied IDs used without ownership/scope check
- Insecure file operations (user-controlled paths, missing path canonicalization)
- Sensitive data in logs (passwords, tokens, precise user coordinates, raw image EXIF)
- Missing input validation on new endpoints (Zod on Node side, Pydantic on Python side, or explicit checks)
- New linter suppressions added without `-- reason` (per `docs/tech/development-guide.md` § Linter Suppressions)

### Node / TypeScript-specific (`backend/`, `frontend/`)

- SQL injection — `pool.query(`${userInput}`...)` or template strings concatenated into queries (must use `$1, $2, ...` placeholders / Drizzle)
- XSS — unescaped user-generated content rendered into HTML / `dangerouslySetInnerHTML`
- Missing `requireAuth` / `requireAdmin` / `requireCurator` on new routes
- JWT misuse — verifying without algorithm allowlist, missing iss/aud, accepting expired tokens
- Cookie flags — refresh tokens missing `httpOnly`, `Secure`, `SameSite`

### Python / FastAPI-specific (`cv-python/`)

- **Insecure deserialization** — `pickle.loads`, `marshal.loads`, `shelve` on untrusted input (RCE)
- **Unsafe YAML** — `yaml.load(...)` without `Loader=SafeLoader` (use `yaml.safe_load`)
- **Dynamic code construction** — `eval(...)` / `exec(...)` / `compile(... 'exec')` on user data (RCE)
- **Shell-mode subprocess** — `subprocess.*(..., shell=True)` with user input (command injection)
- **f-string SQL** — `cur.execute(f"SELECT ... {user_var}")` (use parameterized queries with `%s`)
- Missing FastAPI `Depends(authn_fn)` / `Depends(authz_fn)` on new routes
- Multipart `UploadFile` accepted without **size limits** or **content-type validation** (`cv2.imdecode` returns `None` on garbage but worker may not check; `request.stream()` consumes unbounded bytes)
- `params: str = Form(...)` followed by `json.loads(params)` without a Pydantic model — schema bypass / DoS via huge nested structures
- Raw exception strings returned in response bodies (`str(e)` in error handlers leaks paths/stack)
- `print(f"... {sensitive} ...")` debug statements in handlers
- Weak crypto / hashing — `hashlib.md5`, `hashlib.sha1` for security purposes (use `sha256+`); `random.random()` for tokens (use `secrets.token_hex()`)
- `requests.get/post(..., verify=False)` — TLS verification disabled
- Bare `except Exception: pass` without logging (mask real errors); if intentional, suppress with `# noqa: S110  # nosec B110 -- <reason>`

Keep the output concise. Only report actual issues, not theoretical concerns.

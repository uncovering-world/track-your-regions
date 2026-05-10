# Deep Security Review

Perform an in-depth OWASP ASVS security review of the specified file or module.

## Instructions

1. Read the file(s) specified: $ARGUMENTS
2. Map the code to relevant ASVS requirements
3. Check for:

### Injection (V1)
- SQL/NoSQL queries: are they parameterized?
  - Node/TS: `pool.query('... $1 ...', [val])` or Drizzle — never template strings
  - Python/psycopg: `cur.execute('... %s ...', (val,))` — never f-string interpolation
- HTML output: is it escaped/encoded?
- URL construction: is user input encoded?
- OS commands: any spawn / subprocess call with user data?
  - Node: prefer `execFile` over the shell-mode call; never pass user input through a shell
  - Python: never `subprocess.*(..., shell=True)` with user data; prefer the list form
- Insecure deserialization (Python): the `pickle` / `marshal` / `shelve` modules and `yaml.load(...)` without `SafeLoader` on untrusted data — all RCE
- Dynamic code construction (Python): `eval` / `exec` on user data — RCE

### Business Logic (V2)
- Can any validation be bypassed by manipulating request order or values?
- Are data mutations properly authorized?
- Race conditions in concurrent operations (e.g. sync services)?

### Auth & Session (V6, V7)
- Is authentication required and verified?
- Are session tokens handled securely?
- Token expiration checked?

### Self-contained Tokens (V9)
- JWT algorithm restricted to allowlist?
- Token expiration (exp) and not-before (nbf) validated?
- Token type (access vs refresh) distinguished?

### Authorization (V8)
- Does this code check that the requesting user owns the resource?
- Are there privilege escalation paths?
- Can a regular user access curator/admin functions?
- Are curator scopes properly checked?

### Data Handling (V14)
- Is sensitive data (visit history, travel data) properly scoped?
- Are API responses minimal (no data over-exposure)?
- Is PII logged?

### Cryptography & Randomness (V11)
- **Hashing (Python)**: `hashlib.md5`/`hashlib.sha1` for security purposes — use `sha256` or stronger
- **Tokens (Python)**: `random.random()` / `random.choice()` for tokens — use `secrets.token_hex()` / `secrets.token_urlsafe()`
- **Hashing (Node)**: `crypto.createHash('md5'/'sha1')` for security — use sha256+
- **Tokens (Node)**: `Math.random()` for tokens — use `crypto.randomBytes()`

### Network / TLS (V12)
- **Python**: any HTTP client with `verify=False` (`requests`, `httpx`, `urllib3`) — TLS verification disabled
- **Python**: hard-coded self-signed cert acceptance (`ssl._create_unverified_context`)
- **Node**: `rejectUnauthorized: false` on TLS clients

### File Handling (V5)
- **Python `UploadFile`**: max size enforced? content-type allowlist? `cv2.imdecode` return checked for `None`? width/height bounded after decode?
- **Node multer / direct streaming**: same checks
- Path traversal: any user-controlled segment used in `open(...)` / `fs.readFile`?

### FastAPI / cv-python specific
- Each `@router.post(...)` route: where's the auth check? If relying on Docker network isolation, is that documented and enforced (no `--host` to public, no port forwarding)?
- `params: str = Form(...)` then `json.loads(params)` — replace with a Pydantic model
- Raw exception messages in streaming responses (`{"type":"error","message": str(e)}`) — sanitise
- Worker threads / `threading.Thread(daemon=True)` without bounds — DoS via thread exhaustion

4. Output: findings with line numbers, severity, and specific fix recommendations

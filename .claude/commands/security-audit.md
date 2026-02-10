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
- Check image download validation (content-type, path sanitization)
- Check file storage path construction
- Check that downloaded files aren't in executable paths

### API Security (V4)
- Check CORS configuration
- Check rate limiting (if present)
- Check request size limits
- Verify Content-Type header matches response body

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

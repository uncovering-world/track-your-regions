# OWASP ASVS 5.0 Security Audit with Claude Code

> **Reference:** [OWASP Application Security Verification Standard 5.0](https://github.com/OWASP/ASVS/tree/v5.0.0)

## Integration into Your Development Workflow

This guide shows how to use Claude Code as an automated security auditor based on OWASP ASVS 5.0, integrated directly into your travel app development process.

---

## Architecture Overview

```
Developer writes code
        │
        ▼
┌─────────────────────┐
│   Claude Code CLI    │
│  /security-audit     │
│                      │
│  Reads: CLAUDE.md    │
│  + SECURITY.md       │
│  + OWASP checklist   │
│                      │
│  Scans: codebase     │
│  Reports: findings   │
└─────────────────────┘
        │
        ▼
  Security report in
  /docs/security/
```

---

## Step 1: Create a Security Profile (SECURITY.md)

Place this in your project root alongside CLAUDE.md. Claude Code reads it on `/init`.

```markdown
# SECURITY.md

## OWASP ASVS Target Level: 2

We target ASVS Level 2 (standard security for apps handling personal data).
Level 1 requirements are mandatory. Level 2 requirements are expected.
Level 3 requirements are tracked but optional for now.

## Application Profile

- **Type**: Web application (travel tracking with user accounts)
- **Auth**: OAuth2/OIDC (social login) + email/password
- **Data sensitivity**: User travel history, location data, quiz results, personal preferences
- **APIs**: REST API, potentially GraphQL later
- **File handling**: User photo uploads (GeoGuessr content, profile images)
- **Frontend**: WebGL map rendering, SPA with reactive framework
- **Sessions**: JWT + server-side session store

## Relevant ASVS Chapters (Priority Order)

1. V6 Authentication — OAuth/OIDC + password auth
2. V8 Authorization — User data isolation, curator roles, admin access
3. V7 Session Management — JWT handling, session timeout, decay
4. V1 Encoding & Sanitization — User-generated quiz content, UGC pipeline
5. V2 Validation & Business Logic — Quiz scoring, connection level calculations
6. V14 Data Protection — Location data, travel history, PII
7. V4 API & Web Service — REST API hardening
8. V13 Configuration — Secret management, environment config
9. V5 File Handling — Image uploads for GeoGuessr, user photos
10. V11 Cryptography — Password hashing, token signing
11. V12 Secure Communication — TLS everywhere
12. V16 Security Logging — Audit trail for auth events

## Out of Scope (for now)

- V17 WebRTC (not used)
- V10 OAuth Authorization Server (we're a client, not a provider)
- V4.3 GraphQL (not yet implemented)
```

---

## Step 2: OWASP ASVS Checklist as Code

Create `/docs/security/asvs-checklist.yaml` — a machine-readable checklist Claude Code can reference and update.

```yaml
# asvs-checklist.yaml
# OWASP ASVS 5.0 Security Verification Checklist
# Status: pass | fail | partial | n/a | not-checked
# Updated by: claude-code security audit runs

meta:
  target_level: 2
  last_audit: null
  app: travel-tracker

chapters:

  V1_encoding_sanitization:
    V1.2.1:
      desc: "Output encoding for HTTP response relevant to context"
      level: 1
      status: not-checked
      notes: ""
    V1.2.2:
      desc: "URL encoding for dynamically built URLs, safe protocols only"
      level: 1
      status: not-checked
      notes: ""
    V1.2.3:
      desc: "Output encoding for dynamic JavaScript/JSON content"
      level: 1
      status: not-checked
      notes: ""
    V1.2.4:
      desc: "Parameterized queries for all database operations"
      level: 1
      status: not-checked
      notes: ""
    V1.2.5:
      desc: "OS command injection protection"
      level: 1
      status: not-checked
      notes: ""

  V2_validation_business_logic:
    V2.2.1:
      desc: "Anti-automation controls for sensitive endpoints"
      level: 1
      status: not-checked
      notes: "Rate limiting on quiz submissions, login, registration"
    V2.3.1:
      desc: "Business logic flow enforced server-side"
      level: 1
      status: not-checked
      notes: "Connection level calculations must be server-side only"

  V5_file_handling:
    V5.2.1:
      desc: "File size limits enforced"
      level: 1
      status: not-checked
      notes: "GeoGuessr photos, profile images"
    V5.2.2:
      desc: "File extension + magic bytes validation"
      level: 1
      status: not-checked
      notes: ""
    V5.3.1:
      desc: "Uploaded files not executable server-side"
      level: 1
      status: not-checked
      notes: ""
    V5.3.2:
      desc: "No user-controlled file paths"
      level: 1
      status: not-checked
      notes: ""

  V6_authentication:
    V6.1.1:
      desc: "Rate limiting and anti-brute-force documented"
      level: 1
      status: not-checked
      notes: ""
    V6.2.1:
      desc: "Passwords >= 8 chars (recommend 15+)"
      level: 1
      status: not-checked
      notes: ""
    V6.2.2:
      desc: "Users can change password"
      level: 1
      status: not-checked
      notes: ""
    V6.2.3:
      desc: "Password change requires current password"
      level: 1
      status: not-checked
      notes: ""
    V6.2.4:
      desc: "Passwords checked against top 3000 common passwords"
      level: 1
      status: not-checked
      notes: ""
    V6.2.5:
      desc: "No composition rules restricting character types"
      level: 1
      status: not-checked
      notes: ""
    V6.2.6:
      desc: "Password fields use type=password"
      level: 1
      status: not-checked
      notes: ""
    V6.2.7:
      desc: "Paste and password managers allowed"
      level: 1
      status: not-checked
      notes: ""
    V6.2.8:
      desc: "Password verified as-is, no truncation or case changes"
      level: 1
      status: not-checked
      notes: ""
    V6.2.9:
      desc: "Passwords up to 64+ chars permitted"
      level: 2
      status: not-checked
      notes: ""
    V6.2.12:
      desc: "Passwords checked against breached password sets"
      level: 2
      status: not-checked
      notes: "e.g. HaveIBeenPwned API"

  V7_session_management:
    V7.2.1:
      desc: "Session tokens cryptographically random, >= 128 bits entropy"
      level: 1
      status: not-checked
      notes: ""
    V7.3.1:
      desc: "Session timeout configured"
      level: 1
      status: not-checked
      notes: ""

  V8_authorization:
    V8.2.1:
      desc: "Authorization enforced server-side, not client-side only"
      level: 1
      status: not-checked
      notes: "Critical: quiz scores, connection levels, curator permissions"
    V8.3.1:
      desc: "Users can only access their own data (IDOR protection)"
      level: 1
      status: not-checked
      notes: "User travel data, quiz results, checklist state"

  V13_configuration:
    V13.3.1:
      desc: "No secrets in source code or config files"
      level: 1
      status: not-checked
      notes: "API keys for Wikidata, Reddit, GBIF, IUCN, etc."
    V13.4.1:
      desc: "No sensitive data in error messages"
      level: 1
      status: not-checked
      notes: ""

  V14_data_protection:
    V14.2.1:
      desc: "Sensitive data identified and classified"
      level: 1
      status: not-checked
      notes: "Location history, travel patterns = high sensitivity"
    V14.3.1:
      desc: "Sensitive data not stored in browser storage unencrypted"
      level: 1
      status: not-checked
      notes: ""
```

---

## Step 3: Claude Code Custom Slash Commands

### `/security-audit` — Full Codebase Audit

Create `.claude/commands/security-audit.md`:

```markdown
# Security Audit (OWASP ASVS 5.0)

Run a security audit of the codebase against OWASP ASVS 5.0 requirements.

## Instructions

1. Read `/docs/security/SECURITY.md` for the application security profile
2. Read `/docs/security/asvs-checklist.yaml` for current verification status
3. Scan the codebase systematically by ASVS chapter (focus on chapters listed in SECURITY.md)
4. For each requirement, check if the codebase satisfies it
5. Update `asvs-checklist.yaml` with findings
6. Generate a report at `/docs/security/audit-YYYY-MM-DD.md`

## Audit Focus Areas (for this app)

### Authentication (V6)
- Check password handling: hashing algorithm, min length enforcement, common password check
- Check OAuth/OIDC implementation: token validation, state parameter, nonce
- Check rate limiting on login/registration endpoints
- Check for credential exposure in logs or error messages

### Authorization (V8)
- Check every API endpoint for auth middleware
- Look for IDOR vulnerabilities (user A accessing user B's travel data)
- Check role-based access: regular user vs curator vs admin
- Verify connection level calculations are server-side only

### Input Handling (V1 + V2)
- Check all database queries for parameterization (no string concatenation)
- Check user-generated content pipeline (quiz questions, checklist suggestions)
- Check URL construction (especially for external API calls to Wikidata, Reddit, etc.)
- Check for XSS in rendered quiz content, map labels, user names

### Data Protection (V14)
- Check what's stored in localStorage/sessionStorage
- Check API responses for over-exposure of user data
- Check if location data is properly access-controlled

### Configuration (V13)
- Scan for hardcoded secrets, API keys, database credentials
- Check .env handling and .gitignore
- Check error handling doesn't leak stack traces

### File Handling (V5)
- Check image upload validation (type, size, magic bytes)
- Check file storage path construction
- Check that uploads aren't directly executable

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
```

### `/security-check` — Quick Pre-commit Check

Create `.claude/commands/security-check.md`:

```markdown
# Quick Security Check

Run a focused security check on recently changed files.

## Instructions

1. Identify files changed in the current branch (use `git diff --name-only main`)
2. For each changed file, check for:
   - Hardcoded secrets or API keys
   - SQL/NoSQL injection (string concatenation in queries)
   - XSS (unescaped user input in HTML/JS output)
   - Missing auth middleware on new endpoints
   - IDOR potential (user ID from request used without ownership check)
   - Insecure file operations (user-controlled paths)
   - Sensitive data in logs
   - Missing input validation on new endpoints
3. Report findings inline with file:line references
4. Classify as CRITICAL / HIGH / MEDIUM / LOW

Keep the output concise. Only report actual issues, not theoretical concerns.
```

### `/security-review [file]` — Single File Deep Review

Create `.claude/commands/security-review.md`:

```markdown
# Deep Security Review

Perform an in-depth OWASP ASVS security review of the specified file or module.

## Instructions

1. Read the file(s) specified: $ARGUMENTS
2. Map the code to relevant ASVS requirements
3. Check for:

### Injection (V1)
- SQL/NoSQL queries: are they parameterized?
- HTML output: is it escaped/encoded?
- URL construction: is user input encoded?
- OS commands: any exec/spawn with user data?
- Template injection risks

### Business Logic (V2)
- Can any validation be bypassed by manipulating request order or values?
- Are calculations (quiz scores, connection levels) done server-side?
- Race conditions in concurrent operations?

### Auth & Session (V6, V7)
- Is authentication required and verified?
- Are session tokens handled securely?
- Token expiration checked?

### Authorization (V8)
- Does this code check that the requesting user owns the resource?
- Are there privilege escalation paths?
- Can a regular user access curator/admin functions?

### Data Handling (V14)
- Is sensitive data (location, travel history) properly scoped?
- Are API responses minimal (no data over-exposure)?
- Is PII logged?

4. Output: findings with line numbers, severity, and specific fix recommendations
```

---

## Step 4: Add to CLAUDE.md

Add this section to your existing CLAUDE.md so Claude Code always has security context:

```markdown
## Security Standards

This project follows OWASP ASVS 5.0 Level 2.
Security profile: `/docs/security/SECURITY.md`
Current audit status: `/docs/security/asvs-checklist.yaml`

### Security Rules (Always Apply)

1. **Never** concatenate user input into SQL/NoSQL queries — use parameterized queries
2. **Never** render user-generated content without escaping (quiz text, user names, UGC)
3. **Always** verify resource ownership before returning data (IDOR prevention)
4. **Always** validate and sanitize file uploads (type, size, magic bytes)
5. **Never** expose secrets in code, configs, logs, or error messages
6. **Always** enforce authorization server-side, never trust client-side checks
7. **Always** use HTTPS and secure cookie flags
8. **Never** log sensitive data (passwords, tokens, precise location coordinates)

### Before Merging Any PR

Run `/security-check` to verify no new vulnerabilities were introduced.
```

---

## Step 5: CI/CD Integration Pattern

While Claude Code is interactive, you can structure your workflow to include security gates:

### Pre-commit Hook Pattern

```bash
#!/bin/bash
# .githooks/pre-commit

# Quick automated checks (non-Claude)
echo "Running static security checks..."

# Check for common secrets patterns
grep -rn "API_KEY\s*=\s*['\"][^'\"]*['\"]" --include="*.ts" --include="*.js" src/ && {
  echo "ERROR: Possible hardcoded API key found"
  exit 1
}

# Check for raw SQL string concatenation
grep -rn "query.*+.*req\." --include="*.ts" --include="*.js" src/ && {
  echo "WARNING: Possible SQL injection — string concatenation with request data"
  exit 1
}

# Check for innerHTML usage
grep -rn "innerHTML\s*=" --include="*.ts" --include="*.tsx" --include="*.js" src/ && {
  echo "WARNING: innerHTML usage — potential XSS"
}

echo "Static checks passed. Run 'claude /security-check' for deep analysis."
```

### PR Review Workflow

```
1. Developer creates PR
2. Developer runs: claude /security-check
3. Claude Code reports findings
4. Fix critical/high issues before merge
5. Weekly: claude /security-audit (full audit)
6. Monthly: review asvs-checklist.yaml progress
```

---

## Step 6: App-Specific Security Concerns

Based on your travel tracker's architecture, pay special attention to:

### Quiz System
- **Server-side scoring**: Connection level calculations must happen server-side. A user shouldn't be able to POST arbitrary scores.
- **UGC sanitization**: User-submitted quiz questions (Tier 3) go through curator review, but also need XSS sanitization before storage and rendering.
- **Rate limiting**: Prevent quiz spam that could manipulate connection decay or game the system.

### Location Data
- **Access control**: User A must never see User B's precise travel history or connection levels (unless explicitly shared).
- **API response scoping**: Map endpoints should only return the requesting user's data.
- **Aggregated data**: If you expose any aggregated statistics, ensure they can't be reverse-engineered to identify individuals.

### External API Calls
- **SSRF prevention**: When fetching from Wikidata, Reddit, Wikipedia, etc., validate and restrict target URLs.
- **Secret rotation**: API keys for GBIF, IUCN, Reddit, Numista should be in environment variables with documented rotation policy.

### GeoJSON / Map Rendering
- **Input validation**: GeoJSON from external sources should be validated before rendering (malformed GeoJSON could crash WebGL).
- **CSP headers**: Content Security Policy should restrict script sources, especially with WebGL and external tile servers (OSM).

---

## Quick Start

```bash
# 1. Copy SECURITY.md and asvs-checklist.yaml to your project
mkdir -p docs/security
cp SECURITY.md docs/security/
cp asvs-checklist.yaml docs/security/

# 2. Create Claude Code commands
mkdir -p .claude/commands
cp security-audit.md .claude/commands/
cp security-check.md .claude/commands/
cp security-review.md .claude/commands/

# 3. Update CLAUDE.md with security section

# 4. Run your first audit
claude /security-audit

# 5. Review findings and start fixing
```

---

## Tracking Progress

The `asvs-checklist.yaml` becomes your living security dashboard. After each audit:

| Metric | Target |
|--------|--------|
| L1 requirements passing | 100% |
| L2 requirements passing | 80%+ |
| Critical findings open | 0 |
| High findings open | < 3 |
| Days since last audit | < 30 |

Review the checklist monthly to track improvement and identify areas that need attention.

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

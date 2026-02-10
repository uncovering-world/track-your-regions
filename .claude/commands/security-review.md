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

4. Output: findings with line numbers, severity, and specific fix recommendations

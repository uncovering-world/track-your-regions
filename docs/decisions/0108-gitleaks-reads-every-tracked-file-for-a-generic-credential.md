# ADR-0108: gitleaks reads every tracked file for a generic credential

**Date:** 2026-10-15
**Status:** Accepted

---

## Context

Two layers look for secrets: Semgrep's `p/secrets` (in `security:scan`) and GitHub's own secret scanning. On 2026-10-15 (#596) both were measured on planted lines, and both match provider formats only (AWS, Stripe, GitHub tokens).

`p/secrets` missed four lines in a YAML file:

- `DB_PASSWORD: <16 random characters>`;
- `password: "<…>"`;
- `JWT_SECRET: "<base64>"`;
- `postgres://user:<password>@db:5432/…`.

It also missed `const password = "<…>"` in a `.ts` file. So the gap was never only the file types `.semgrepignore` drops.

GitHub's push protection was off on this repository and has been switched on. Its generic ("non-provider") patterns could not be: the request to enable them left the setting disabled, on the organisation's free plan.

A generic credential has nothing to stop it, and the deployment (#585) is where real passwords first sit next to tracked compose files and env templates.

## Decision

**gitleaks reads every file git tracks, as a check-tier gate (`security:secrets`), and a finding fails it.**

1. **Default rules plus one of our own.** gitleaks' default rules find a generic key or password by keyword and entropy, as well as providers' formats. `.gitleaks.toml` extends them with `password-in-connection-uri`, for `scheme://user:<password>@host`, which no default rule reads. A password written as an interpolation (`${DB_PASSWORD}`) or an angle-bracket placeholder is not matched.
2. **Tracked files only.** `scripts/scan-secrets.sh` streams `git ls-files --cached`, as the working tree holds those files, into the scanner's container. A local `.env` and the `data/` directory never reach it. A file added with `git add -N` does.
3. **Findings are printed redacted**, so a real secret never reaches a log.
4. **A false positive is allowed on its own line** with `gitleaks:allow` and a reason. The first run over the repository needed five such lines, all test fixtures, and one documentation example rewritten to use a shell variable.
5. **Every input class is its input**, since a secret can be pasted anywhere. The gate runs in the `Lint & Type Check` job through `npm run check`, so CI and a developer run the same command.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Lift `.semgrepignore`'s type exclusions for `p/secrets` (#596 as filed) | `p/secrets` matches provider formats: it found none of the generic shapes, in YAML or in TypeScript |
| GitHub's generic-secret detection | Not available to this organisation's plan; and server-side only, so it says nothing before a push |
| TruffleHog | Its strength is verifying provider keys against their APIs, which push protection already answers for; gitleaks' keyword-and-entropy rules were measured here on the generic shapes and catch them, in one small image |
| A rule set of our own in Semgrep | Re-implements what gitleaks ships, and Semgrep's ignore file would have to be split per pass |

## Consequences

**Positive:**
- A password, a signing secret or a password inside a connection URI fails the commit's gates in any file type. Proven on a planted `docker-compose.yml`, both lines reported and the secrets redacted.
- About ten seconds over the whole repository, so it sits in the fast tier.

**Negative / Trade-offs:**
- A new image to pin and bump, like the other scanners.
- Keyword-and-entropy rules have false positives. Each needs its own `gitleaks:allow`, and a test fixture now carries the comment.
- A file that no input class covers is not an input of the gate: the four paths read by no other gate (`docs/tech/gates.md` § Read by no gate) and a tool's own settings file. A change to one of them alone does not run the scan, but the next change that runs it reads them.

## References

- Related ADRs: ADR-0062 (the gate map), ADR-0092 (a tool's settings)
- Related docs: `docs/security/SECURITY.md` § Secret detection, `docs/tech/gates.md`
- Issues: #1504, #596, #585

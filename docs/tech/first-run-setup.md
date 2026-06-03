# First-Run Setup

How to bring up Track Your Regions from a fresh clone, and what the interactive
setup does. For the optional-integration variables themselves, see
[`.env.example`](../../.env.example) and the README "Optional integrations" table.

## TL;DR

```bash
npm run setup        # interactive: writes .env, creates the admin, offers integrations
npm run dev          # start the stack
npm run db:load-gadm # load world boundaries (if you skipped it during setup)
```

## What `npm run setup` does

`scripts/setup.sh` is the interactive first-run entry point. In order:

1. **Writes `.env`** (gitignored) from `.env.example`, if one doesn't already
   exist. It prompts for the admin email + display name, database name, and
   database password, and generates a fresh `JWT_SECRET`. An existing `.env` is
   left untouched.
2. **Starts the database** (`docker compose up -d db`) and waits for it to become
   healthy.
3. **Creates the first admin** (`createAdmin.ts`). The password is read from stdin
   (never passed on the command line); leave it blank to have one generated and
   shown once. See [authentication.md](authentication.md) for the admin-bootstrap
   rules.
4. **Runs the optional-integrations wizard** (`scripts/setup-integrations.sh`).

Re-running `npm run setup` is safe: the `.env` core is left as-is, and the
integrations wizard only prompts for integrations that are still unset — so you
can run it again later to fill in ones you skipped.

## Optional-integrations wizard

For each integration the wizard prints what it unlocks plus a link to get
credentials, asks `Configure …? (y/N)` (default No), and writes your answers to
`.env` via the same quoting-safe `set_kv` used for the core values. Secrets are
read hidden and never echoed. It is TTY-guarded, so CI / non-interactive runs
skip it entirely.

| Prompted | Variables / action | Notes |
|----------|--------------------|-------|
| Google login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | redirect URI `http://localhost:3001/api/auth/google/callback` |
| AI features | `OPENAI_API_KEY` | enables AI grouping / descriptions / geocoding / image matching |
| Map data (GADM) | runs `npm run db:load-gadm` | offered only when `administrative_divisions` is empty; takes tens of minutes |

**Not** prompted (configure manually in `.env`): **SMTP email** and **Apple
Sign-In** — both are documented in `.env.example`. In dev, email-verification
links print to the backend logs when SMTP is unset.

Newly added keys take effect on the next `npm run dev` (restart the stack).

## Runtime mode and network exposure

- `validateEnv` (`backend/src/config/validateEnv.ts`) runs at startup and, in
  production mode, fails fast on insecure or missing config. "Production mode" is
  any `NODE_ENV` other than `development` / `test` (`isProductionMode`).
- The server binds `127.0.0.1` in development and `0.0.0.0` in production by
  default; override with `BIND_ADDR`. See
  [ADR-0017](../decisions/0017-server-bind-address.md).

## Resetting to a clean slate

To exercise setup as if freshly cloned — this **wipes the database**, including
loaded GADM and any imported regions:

```bash
docker compose down -v       # remove the postgres volume so db/init re-runs
rm -f .env .active-db        # optional: re-run the first-run prompts
npm run setup
npm run dev
npm run db:load-gadm
```

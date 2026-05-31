# ADR-0017: Server bind address — loopback by default, all interfaces in production

**Status:** Accepted

## Context

The backend's `app.listen` must choose a bind address. Binding `0.0.0.0` exposes
the API on every network interface; binding `127.0.0.1` keeps it loopback-only.

In local development — and in the default Docker Compose stack, which reaches the
backend over its own internal network — loopback is the safe default: it avoids
unintentionally exposing a dev server (which runs with relaxed config) to the LAN.
A non-compose production or standalone deployment, by contrast, must be reachable
from outside the host.

The startup config validator (`validateEnv`) already classifies the runtime via
`isProductionMode(NODE_ENV)` — true for anything other than `development`/`test`.
If the bind decision used a different predicate, the two could drift: e.g. with
`NODE_ENV` unset, `validateEnv` treats the run as production (enforcing prod
config) while a naive `NODE_ENV === 'production'` bind check would keep the server
on loopback and therefore unreachable.

## Decision

`BIND_ADDR` defaults to `127.0.0.1`, except in production mode where it defaults to
`0.0.0.0`. An explicit `BIND_ADDR` environment variable overrides both. Production
mode is determined by the shared `isProductionMode(NODE_ENV)` predicate — the same
one `validateEnv` uses — so bind behavior and startup validation stay in lockstep.
The decision is referenced inline at the bind site in `backend/src/index.ts`.

## Alternatives Considered

- **Always bind `0.0.0.0`** — simplest, but exposes dev servers with relaxed config
  to the local network by default. Rejected.
- **Always bind `127.0.0.1`, require a reverse proxy** — safe, but makes a
  non-compose/standalone deploy unreachable out of the box. Rejected.
- **Gate on a literal `NODE_ENV === 'production'`** — drifts from `validateEnv`'s
  production predicate (see Context). Rejected in favor of the shared predicate.

## Consequences

- Dev servers are loopback-only by default; no accidental LAN exposure.
- Production / non-compose deploys bind all interfaces and are reachable.
- Operators who need a specific interface set `BIND_ADDR` explicitly.
- Bind exposure and prod-config enforcement share one predicate and cannot diverge.

## References

- `backend/src/index.ts` — bind site
- `backend/src/config/validateEnv.ts` — `isProductionMode`

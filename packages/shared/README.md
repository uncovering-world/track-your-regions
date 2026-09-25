# `@tyr/shared` — the rules both sides apply

The pure rules the backend and the frontend both apply, declared once and imported by both (ADR-0065, #789). Before this package the same rule was written twice — once per side, because no import crossed `backend/` and `frontend/` — and a backend test read the frontend's copy as text to hold the two equal. Each module here replaces one such pair.

## What belongs here

A module belongs here when **both sides apply it and the browser must already know it**: a list a card is drawn from and a run writes by, a fold a form and an endpoint both compare names with, a threshold the map and the database both measure by, a vocabulary the schema constrains and a screen labels. Everything in the bundle is something the frontend already shipped; nothing here is a secret, and nothing here authorises anything — that is decided on the server, per route.

A module does **not** belong here when it needs a runtime: anything that imports Express, React, `pg`, Zod, MapLibre or reads `import.meta.env` stays on its side. The compiler says so — `tsconfig.json` has `"types": []` and `lib: ["ES2022"]`, so neither Node's nor the DOM's globals resolve — and the manifest has no `dependencies`. A rule that is SQL text (`tidyLabelSql`) or a fetch address (`pictureFetchUrl`) stays on the backend beside the shared rule it spells.

Where the schema is a third statement of a rule (a `CHECK` list, an enum), the shared declaration is pinned to it **by a type**, in `backend/src/db/curationLogActions.test.ts`, never by reading a file: `CheckValue<…>` from the generated row types (ADR-0064) and the union here have to be the same type, or the typecheck fails.

## The one generated module

`src/api.generated.ts`, imported as `@tyr/shared/api`, is not written by hand. It holds the web's types for the backend's success bodies. `npm --prefix backend run api:types` renders them from the Zod schemas in `backend/src/api/responses/` (ADR-0066).

The module holds types only and imports nothing. Every import of it is erased, so neither consumer ever loads it at run time. That also means a container whose baked `package.json` predates its export never has to resolve it.

`backend/src/api/apiTypes.test.ts` fails while the file is not what the schemas render to. To change a response shape, change its schema, never this file. The eslint config lifts `max-lines` for `src/*.generated.ts`, because the file's length is the API's.

## How it is consumed

Both packages depend on it as `"@tyr/shared": "file:../packages/shared"`, which npm links into `node_modules` and records in each lockfile. The package ships **TypeScript source**: `exports` point at `src/*.ts`, there is no build, and each consumer's own `tsc`, `tsx`, Vite and vitest read the source directly — so a type error here fails `typecheck:backend` and `typecheck:frontend` as well as `typecheck:shared`.

Two rules follow from shipping source:

- **One module, one concern, no relative import of a sibling.** Node's own type stripping runs the backend's emitted `dist/` against this source, and `./labels.js` would not exist on disk. A spec imports its module with the `.js` extension, which only vitest resolves.
- **Subpath exports only, no barrel.** `import { foldLabel } from '@tyr/shared/labels'`; a consumer bundles only the modules it imports (`"sideEffects": false`).

In Docker, `docker-compose.yml` hands this directory to each image as a named build context and the Dockerfiles copy it to `/packages/shared`, where `../packages/shared` from `/app` finds it exactly as on a checkout; the dev stack bind-mounts `src/` there too. Only `src/` is mounted, so a new module, which adds a subpath to `exports`, reaches a running dev container only once its image is rebuilt (`npm run dev`, or `dev:backend:rebuild` and `dev:frontend:rebuild`). Until then the backend stops at `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Gates

`npm run check` runs `lint:shared`, `typecheck:shared` and `knip:shared` for any change under `app` (`scripts/gates.mjs`); the specs beside each module run in the backend's unit lane, the way `scripts/*.test.mjs` do. A one-time `npm install` here (or `npm ci --prefix packages/shared`) provides the lint and typecheck tooling; the consumers need no install here at all — the link target only has to exist.

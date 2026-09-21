# ADR-0065: A rule both sides apply lives in one package both import

**Date:** 2026-09-21
**Status:** Accepted

---

## Context

The backend and the frontend are two npm packages with no import between
them. That is a build-context constraint — each Docker image is built from
its own directory, each package has its own lockfile — and not a rule of the
product, but it shaped how a rule both sides apply was written: once per
side, and held equal by a backend test reading the frontend's copy as text
(#527 records the arrangement; #789 counts the cost).

Measured at HEAD on 2026-09-21, the twins were:

| rule | backend | frontend | what held them equal |
|---|---|---|---|
| picture hosts and file types | `types/urlSafety.ts` | `utils/imageUrl.ts` (not exported) | `urlSafety.test.ts` parsed the frontend file with a regular expression |
| label fold and store rule | `services/sync/labelFold.ts` | `utils/labelFold.ts`, character-identical | `labelFold.test.ts` compared the two function bodies as text |
| near-global threshold | `near_global_deg()` in the schema; the spec's own `350` | `utils/mapUtils.ts` (not exported) | `regionFocusAntimeridian.test.ts` searched the frontend tree for the literal |
| curation-log action vocabulary | the schema's CHECK, generated into `CheckValue<…>` (ADR-0064) | the keys of `ACTION_LABELS` | `curationLogActionLabels.test.ts` parsed the CHECK and the frontend file |
| changeset equality | `changeSet.ts` `jsonEquals` | `objectDiff.ts` `valuesEqual`, "a second copy" | four cases stated in each side's suite |
| whole-region ceiling | two inline `Math.min(…, 5000)` | `WHOLE_REGION_LIMIT = 5000` | a comment on each side pointing at the other |
| user role and auth provider | hand-written unions beside the generated enums | the same unions | nothing |

PR #748 showed how the next one starts: `PICTURE_EXTENSIONS` was declared on
both sides and only the host list was pinned. Each pin is a parser of one
file's layout, it reads in one direction only — a frontend change that keeps
the pinned string and changes the behaviour around it is not seen — and each
new rule needs a new one. The umbrella #788 counts sixteen such source-reading
guards in the repository, and asks every slice under it to delete one.

## Decision

1. **A rule both sides apply is declared once, in `packages/shared`, and
   imported by both.** The package is a third npm package beside the two,
   linked into each with a `file:../packages/shared` dependency that npm
   records in each lockfile. It has no `dependencies`, no Node or DOM types
   (`"types": []`, `lib: ["ES2022"]`), and no build: its `exports` name
   TypeScript source under `src/`, one module per concern, and each consumer's
   own `tsc`, `tsx`, Vite and vitest read that source directly. A type error in
   the package fails `typecheck:backend` and `typecheck:frontend` as well as the
   package's own gate.

2. **A module of the package imports nothing — not a sibling, not a
   dependency.** Node's native type stripping runs the backend's emitted
   `dist/` against the package source through the link, and a relative
   `./labels.js` would name a file that does not exist. Subpath exports and no
   barrel, so a consumer bundles the modules it imports and nothing else
   (`"sideEffects": false`).

3. **Where the schema is a third statement of a rule, the package is held to
   it by a type, not by reading a file.** The generated row types (ADR-0064)
   carry every CHECK list and enum as a union; a spec that reads no file asks
   `expectTypeOf` whether the package's union is the same, and `tsc` fails
   before the spec runs.

4. **What goes in is what the browser must already know.** A rule belongs in
   the package when both sides apply it: a list a card is drawn from and a run
   writes by, a fold a form and an endpoint compare names with, a threshold the
   map and the database measure by, a vocabulary the schema constrains and a
   screen labels. Everything in the bundle is something the frontend already
   shipped; nothing in the package authorises anything. A rule that needs a
   runtime — Express, React, `pg`, Zod, MapLibre, `import.meta.env` — stays on
   its side, and so does a rule that is SQL text or a fetch address, beside the
   shared rule it spells.

5. **The images get the package as a named build context.** `docker-compose.yml`
   hands `packages/shared` to the backend, frontend and e2e builds as
   `additional_contexts`, each Dockerfile copies it to `/packages/shared`, and
   the `file:` link resolves from `/app` by the same relative path as on a
   checkout. Neither package's build context widens.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the twins and add a pin per rule | The arrangement this replaces. Each pin parses one file's layout, reads one way, and is written after the drift it exists for; #748 added a twin the pin did not cover. |
| npm workspaces at the repository root | One lockfile for three packages, a hoisted `node_modules`, every `npm ci --prefix` and both Docker contexts moved to the root, and the root `.dockerignore` carrying every large directory of the checkout — for a package of a few hundred lines. |
| A built package (`tsc -b`, `dist/` in `exports`) | A build before every lane, `dist` stale after an edit, and a consumer type-checking against declarations rather than the source it runs. The source-shipping form was verified on both consumers' toolchains before this was written. |
| A root `.dockerignore` and root build contexts | Widens every image's context to the checkout (`data/`, `deployment/`, `ds-bundle/`), which is what each package's own `.dockerignore` was written to avoid; a named context is the same three files with nothing else. |
| Sharing through the generated schema types alone | Covers the vocabularies the schema states and nothing else — no fold, no threshold, no equality, no host list — and the frontend does not import the generated file. |

## Consequences

**Positive:**
- Six text-reading pins are gone, replaced by an import on each side and, for the two vocabularies the schema also states, a type-level pin. Drift between the sides is a type error, in both directions.
- The next rule both sides apply has a home before it has a twin; #527's response shapes and #574's metadata model go in the same package.
- The frontend-architecture guards that walked the frontend tree from the backend suite (every `src=` through `toThumbnailUrl`, no `fitBounds` outside `mapUtils.ts`) are untouched: they were never twins.

**Negative / Trade-offs:**
- A third package to install for its own lint, typecheck and knip (`npm ci --prefix packages/shared`); the consumers need no install there, only the directory.
- knip follows the link to the source and reads the package's imports as files rather than as a dependency, so each consumer names it in `ignoreDependencies` — and knip does not report the import as unlisted either when the entry is missing (verified with the entry and the link removed). A missing entry is caught by the consumer's typecheck instead: without the link, every `@tyr/shared/…` import is a module `tsc` cannot find.
- ADR-0062's reasoning said "the frontend imports nothing from the backend"; it now imports the package the backend imports, which is a stronger reason for `app` being one input class, and the decision stands unchanged.
- The rule in decision 2 has to be kept by hand: nothing lints a relative import inside the package.

## References

- Related ADRs: ADR-0043 (the picture rule the host list serves), ADR-0062 (the gate map the package joins), ADR-0064 (the generated types decision 3 pins to)
- Related docs: `packages/shared/README.md`, `docs/tech/development-guide.md` § A rule both sides apply, `docs/tech/gates.md`
- PR / issue: #789, umbrella #788; #527 for the arrangement this replaces

# ADR-0066: An endpoint's answer is a backend schema, and the client's type is generated from it

**Date:** 2026-09-22
**Status:** Accepted

---

## Context

An endpoint's success body was described twice: the handler built it, and the
client function in `frontend/src/api/` declared what it returned. Nothing
connected the two. `authFetchJson<T>` asserts `T` without checking it, so when a
handler's answer grew, the client's declaration kept the old promise and
TypeScript reported nothing.

PR #525 met four such drifts, each found by a reviewer rather than a check
(#527). Exploring the client on 2026-09-22 found more of the same class:

- `GET /api/experiences/:id/locations` sends a top-level `regionId` that its
  client does not declare.
- `DisplayGeometryStatus.withDisplayGeom` is declared as required and read by
  `GeometryMapPanel.tsx`, but the backend never sends it.
- Ten functions of the world-view import client post to paths that the route
  table does not register (#945).

The measured surface is 216 client functions and 3 SSE streams in 20 frontend
modules, against 269 `res.json` calls. 230 of the handlers are typed with a bare
`Response`.

ADR-0065 gave the rules both sides apply a package of their own and named
#527's response shapes among what would go there. Two facts decided against
writing those shapes into the package by hand:

1. **A second kind of client is planned.** `docs/vision/vision.md` § Mobile
   Apps plans native iOS and Android apps on the same API. A native client
   cannot import TypeScript. It is generated from an OpenAPI document, and the
   components of OpenAPI 3.1 are JSON Schema.
2. **The compiler cannot catch every form of the defect.** TypeScript's
   excess-property check reads the keys an object literal writes itself and
   nothing else. Probed against a declared type, `{ a: 1, extra: 1 }` fails with
   TS2353, while `{ a: 1, ...(cond ? { extra: 1 } : {}) }` compiles.
   `publishUnderLock` built `partsNotFound` and the placement pair exactly that
   way. Rows passed through from an untyped query are `any`, and `any`
   satisfies every type.

The backend already validates request bodies with Zod, so only the response
side lacks a schema. Zod 4 converts a schema to JSON Schema itself
(`z.toJSONSchema`, draft 2020-12), and the installed zod 3.25.76 ships the Zod 4
API at `zod/v4`, beside the v3 API that the request schemas use.

## Decision

1. **An endpoint's success body is declared once**, as a Zod 4 schema in
   `backend/src/api/responses/<module>.ts`. The module is named like the
   frontend client module whose function calls the endpoint.
   - Every object is a `z.strictObject`.
   - The schema describes the wire, meaning what `JSON.parse` yields on the
     client. A timestamp is an ISO string that the handler converts.
   - A vocabulary is read from `CHECK_VALUES` (ADR-0064) or from the backend
     constant that states it, and never restated.
   - A field's meaning is its `.describe()`, which reaches the web's types and
     later the OpenAPI document.
   - A schema module imports only `zod/v4`, the generated row types,
     vocabulary constants, the schemas of other response modules, and the
     pure helpers beside `respond()` in `backend/src/api/`, such as a
     refinement two modules share. The generator imports every schema module,
     so nothing a schema imports may open a pool or read the environment.
2. **A handler sends a success body through `respond(res, Schema, body)`**, from
   `backend/src/api/respond.ts`. This works in two ways.
   - The body is typed from the schema. `tsc` fails on an undeclared key in a
     literal, a `Date` where the wire carries a string, a value outside a
     vocabulary, or a missing key.
   - The body is parsed strictly before it is sent whenever
     `!isProductionMode(NODE_ENV)`, and always under vitest. A mismatch throws
     `ResponseShapeError`. It is a 500 that names the route's pattern and each
     issue's path and code, and never a value.

   The body is built so the literal itself writes every key:
   - an optional key is written as `key: cond ? value : undefined`;
   - a fragment spread into the body is typed as a `Pick` of the schema's type;
   - rows are typed from the generated row types and mapped key by key.

   Production sends without parsing.
3. **The web's types are generated.** `npm --prefix backend run api:types` does
   it in three steps:
   - It registers every exported schema under its export name, refusing a
     duplicate or an export that is not a schema.
   - It converts the registry with `z.toJSONSchema` in input mode.
   - It renders the JSON Schema into `packages/shared/src/api.generated.ts`,
     imported as `@tyr/shared/api`. The file holds types only and imports
     nothing.

   The renderer, `apiTypesRender.ts`, reads a closed subset and throws on
   anything else. That includes an object that admits keys it does not declare,
   which is what a plain `z.object` becomes in input mode. Rendering it would
   let its parse strip an undeclared key and pass while the key still goes out.

   A backend spec renders the same way, and fails while the committed file
   differs.
4. **The client names the generated type** and declares none of its own for a
   migrated call. `frontend/src/api/<module>.ts` re-exports the types its
   functions return, so a component imports a call's answer from the call's
   module.
5. **The route registry of #793 emits the OpenAPI document.** Its declarations
   supply the paths and name these schemas as their `response`, so nobody writes
   a second list of routes for it. The registry also absorbs `respond()`: a
   declared response types the body and checks it in the same way.
6. **Error bodies are out of scope.** They are `{ error }`, and they belong to
   #793's route declarations.
7. **This extends ADR-0065.** The package gains one generated module, which
   holds types only and imports nothing. Zod stays on the backend, as ADR-0065's
   decision 4 requires.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Hand-written TypeScript types in `packages/shared`, as ADR-0065 anticipated | Only the web can use them; a native client cannot. They are checked at compile time only, so a key spread in or a row passed through still compiles, and the drift #527 exists for survives in its commonest forms. An OpenAPI document would later have to be generated from them, or written as a third statement. |
| Zod schemas in `packages/shared`, imported by both sides | ADR-0065 decision 4 keeps a module that needs a runtime on its own side. The package would gain a dependency, and the frontend would either bundle Zod or reach it only for types. Generating the types keeps Zod on the backend and the package free of dependencies. |
| A hand-written OpenAPI document with generated clients | This is a third statement beside the handlers and the clients, kept equal by hand or by a contract test. That is the arrangement this ADR replaces, one level up. |
| `zod-to-openapi` or `zod-to-json-schema` on the Zod 3 API | The first needs a runtime dependency to attach metadata, and the second is in maintenance. Zod 4's own `toJSONSchema` does the same conversion without either, and the installed package already ships `zod/v4`. |
| `openapi-typescript` or `json-schema-to-typescript` for the rendering | Each brings a dependency tree for the dozen constructs these schemas use. By default one emits index signatures and the other `components["schemas"][…]` paths, and a version bump that reformats the output would read as drift to the freshness spec. The renderer here is about the size of `schemaTypesRender.ts` (ADR-0064) and refuses whatever it does not render. Worth revisiting once #793 emits the full document. |
| tRPC or ts-rest | #788 declined both: REST addresses are a product requirement, and the API serves SSE. A contract framework would also answer the route-declaration question that #793 answers with a registry of its own. |
| Parsing responses in production too | It would cost every reader's request, for a check that every lane exercising a handler already makes. Measured on the development machine on 2026-09-22, a strict parse of the Europe location feed took 7.4 ms p50 over 30 runs (4,860 rows, 1.3 MB). `docs/tech/performance.md` records 163 ms p50 for that feed. |
| A check-tier gate like `db:types` for freshness | No database is involved: the render is a pure function of the schemas. A spec in the unit lane is the whole check, in the way `scripts/gates.test.mjs` holds `docs/tech/gates.md` to the tables it embeds. |

## Consequences

**Positive:**
- Each success body has one statement. The backend's types, the runtime check,
  the web's types and the future OpenAPI components all come from it.
- The four drifts of PR #525 become type errors or failed parses. The admission
  answer is a schema the client's type is generated from. `ordinal`'s
  nullability belongs to the schema and is read off the generated row type.
- A key that arrives by a spread or a row passed through is something no type
  catches. It now fails in the unit test, the smoke lane or the dev request that
  produced it.
- A native client will be generated from the same contract the web is typed
  against, with nothing else to keep equal.
- Vocabularies reach the web from the schema's CHECK lists without being
  restated.

**Negative / Trade-offs:**
- A handler builds its body as a literal that writes every key, and maps its
  rows key by key. As each module moves, its `result.rows` pass-throughs and
  spread fragments are rewritten.
- After a schema change, `npm --prefix backend run api:types` must run and its
  output be committed. Otherwise the freshness spec fails. That spec runs after
  the typecheck, so a stale file first shows as a frontend type error.
- The backend holds two Zod APIs until the request schemas move to `zod/v4`,
  with #793. The manifest floor rises to the installed 3.25.76.
- The runtime check runs only on paths a lane exercises. It does not catch an
  optional key that is declared and never sent.
- In a dev or test lane, a mismatch answers 500 even when the write has
  committed. The message says so.
- The migration is a series of sub-issues of #527, one per client module. Until
  it ends, each module not yet moved declares its answers on both sides, and the
  review bot keeps its line on that pair.

## References

- Related ADRs: ADR-0065 (which this extends), ADR-0064 (generated row types and `CHECK_VALUES`), ADR-0062 (the `app` input class), ADR-0025 (the gate the curation answers describe)
- Related docs: `docs/tech/development-guide.md` § API Layer, `packages/shared/README.md`, `docs/tech/performance.md`
- PR / issue: #527, #793, #788

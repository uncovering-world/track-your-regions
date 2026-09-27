# ADR-0072: The OpenAPI document is generated from the route declarations, and linted

**Date:** 2026-09-27
**Status:** Accepted
**Issue:** [#793](https://github.com/uncovering-world/track-your-regions/issues/793)

---

## Context

ADR-0066 decision 5 said the route registry would emit the OpenAPI document that a native client is generated from (`docs/vision/vision.md` § Mobile Apps). ADR-0071 made every route a declaration: method, path, access, the `params`, `query` and `body` schemas, and the answer. With the last route declared, three things were still open: what renders the document, where it lives, and what keeps it good.

ADR-0066 rejected two libraries, `@asteasolutions/zod-to-openapi` and `zod-to-json-schema`. Both were assessed on the Zod 3 API: the first patched Zod at run time, and the second was in maintenance. `zod-openapi` was not assessed. It needs no patching: it reads Zod 4's native `.meta()` and builds a document from a plain object. Its current major needs Zod 4 itself, which #1087 installed.

A first builder was written by hand over `z.toJSONSchema`. It rendered every schema in one direction, `input`, and so missed a real difference. Seven request bodies normalise a URL with a `transform`: what a client sends is a string, while what the handler reads is the normalised string. The library renders a schema as a request where it is a request and as a response where it is a response, and it refused those bodies wherever it was asked to render them the other way.

## Decision

1. **The document is code-first.** The declarations are the contract, and no OpenAPI file is written by hand beside them. That is the arrangement ADR-0066 rejected one level down.
   - The document is computed by `backend/src/api/openApi.ts` from `backend/src/routes/mounts.ts`, the one table the router is also built from.
   - It is rendered by `zod-openapi`, a devDependency of the backend. Only the generator and its spec load it, so the running server never does.
   - `npm --prefix backend run api:openapi` writes it to `packages/shared/src/openapi.generated.json`, beside the web's generated types.
   - `backend/src/api/openApi.test.ts` fails while the committed document is not what the declarations render to, the way `apiTypes.test.ts` holds the web's types. The document's diff is part of every pull request that changes the API.
2. **The names are derived, and a made-up one is refused.**
   - **Operation id:** the method and the path, as in `getWorldViewsByWorldViewIdRegions`. The tag is the first path segment.
   - **Components:** a response schema keeps its export name in `api/responses/`. A request body is named after its export in `types/`, with a `Body` suffix. A schema that holds itself is named where it is declared, with `.meta({ id })`, as `ImportTreeNode` is.
   - A component the library would name `__schemaN` fails the build. A component no operation reaches is pruned.
   - Components are sorted, because the library emits them in the order it meets them, and that order is not stable from run to run.
3. **The document is linted by Redocly**, with the `recommended` ruleset, from `packages/shared/redocly.yaml`. It runs as the gate `lint:openapi` in the map (ADR-0062), from the `redocly/cli` image pinned by digest, as the other Docker linters are. A rule the document does not meet is turned off in that file, with the reason beside it:
   - `operation-summary` (#1092);
   - `operation-4xx-response` (failures are the one `default` answer);
   - `no-ambiguous-paths` (`routerOf` refuses a shadowed route);
   - `info-license`;
   - `no-unused-components` (the builder prunes them itself, and the rule cannot see a reference in `x-event-schema`).
4. **What the document is for next is filed, not assumed:**
   - #1090, breaking changes flagged against `main` (oasdiff);
   - #1091, the running API tested against the document (Schemathesis);
   - #1089, the web client generated from it, so the web and the native clients read one contract.

## Alternatives Considered

| Alternative | Why not |
|-------------|---------|
| Design-first: a hand-written OpenAPI file, with the server validated against it | A third statement of the contract beside the declarations and the clients, which ADR-0066 rejected. It suits several teams agreeing on an API before it exists. Here, designing in a pull request serves the same end: a declaration with a stub handler, then its document diff reviewed. |
| The hand-written builder over `z.toJSONSchema` | It reimplemented parameters, `$ref` resolution and cycle handling, and rendered requests and responses in one direction. That is how the URL-normalising bodies went unnoticed. |
| `@asteasolutions/zod-to-openapi` | More widely used. But its model is an `OpenAPIRegistry` filled with `registerPath` calls: a second list of routes beside the declarations. |
| Spectral instead of Redocly | Equivalent for linting. Spectral's strength is custom rulesets, which nothing here needs yet. Redocly checks the specification and the recommended rules in one pass, and can render the document as reference pages. |
| Redocly as an npm devDependency | Its dependency tree would enter a lockfile for one lint. The pinned image keeps the version exact and the lockfiles clean. |

## Consequences

**Positive:**
- A native client, and later the web (#1089), is generated from a document that cannot describe a route the server does not serve.
- A change to the contract is visible in the pull request as a document diff, and it is linted before it merges.

**Negative / Trade-offs:**
- The document is large, about 840 kB, and it changes with every schema change. The review surface counts a `*.generated.json` file as generated output, so it does not weigh on a branch's budget.
- `zod-openapi` has one principal maintainer. It is a devDependency of one module, and its output is plain JSON, so replacing it touches `openApi.ts` alone.
- An operation id follows its path, so renaming a path renames the generated client's method. #1090 is what flags that as a breaking change.

## References

- Related ADRs: ADR-0066 (response schemas, decision 5), ADR-0071 (route declarations), ADR-0062 (gates)
- Related docs: `docs/tech/development-guide.md` § API Layer, `packages/shared/README.md`
- Issues: #793, #1087, #1089, #1090, #1091, #1092

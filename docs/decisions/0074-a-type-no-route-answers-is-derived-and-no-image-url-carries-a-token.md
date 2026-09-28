# ADR-0074: A type no route answers is derived from the generated ones, and no image URL carries a token

**Date:** 2026-09-28
**Status:** Accepted
**Issue:** [#1108](https://github.com/uncovering-world/track-your-regions/issues/1108), the last slice of [#1089](https://github.com/uncovering-world/track-your-regions/issues/1089)

---

## Context

ADR-0073 moved every call the web makes onto the client Orval generates from the OpenAPI document. Two of its decisions met the code differently than they were written when #1108 removed the last hand-built paths.

**Decision 4** says a type the web names that the document inlines, such as `ExperienceLocation`, is made a named component, so no hand-written type stands in for it. `ExperienceLocation` is not the answer of any route. It is the fields two answers share: a region's points (`RegionExperienceLocation`, which adds `region_path`) and an object's own points (`ExperienceLocationWithState`). The backend exports the shared object as a schema (`ExperienceLocation` in `backend/src/api/responses/experiences.ts`), and both answers `.extend()` it. `zod-openapi` renders each extension as a full object, so no operation references the base, and the document builder prunes a component nothing references. Rendering the extensions as an `allOf` over the base would not help: the components are strict objects (`additionalProperties: false`), and a strict base refuses the fields each branch adds. The document has no place for the shared type that a client would read.

**Decision 5** lists, among the URLs a browser fetches by itself, "the token-query image URLs an element loads directly (`wvImportCvMatch.ts`)": the cluster preview and the water crop, built with `?token=` in the query. By #1108 no element loads them directly. `AuthImage` reads both through the mutator with the token in the header, and the cluster highlight is a generated call. The token in the query was therefore only a liability:
- `requireAuth` prefers a query token to the header, so a URL built before a refresh kept presenting the spent token and answered 401 instead of being refreshed;
- the token landed in access logs.

## Decision

1. **A type the web names that no route answers is derived from the generated types, in the module of the call.** `Omit`, `Pick` or an intersection over the generated models, with a comment naming the models it comes from. It is not declared field by field, so a field the backend renames still fails to compile where the type is used. This narrows ADR-0073 decision 4 to the types a route answers with: those are components, and none is written by hand. `ExperienceLocation` is `Omit<RegionExperienceLocation, 'region_path'>` (`frontend/src/api/experiences.ts`).
2. **No URL of an API image carries the session's token.** An image the web draws from the API is read through the mutator, with the token in the `Authorization` header. The only URLs that still carry `?token=` are the server-sent streams, since `EventSource` cannot send a header. This narrows ADR-0073 decision 5: the "token-query image URLs" it lists no longer exist.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Name the shared schema as a component in the document | Only a component an operation references survives the builder, and the one way to reference the base, an `allOf`, makes a strict base refuse the fields each answer adds. |
| Declare `ExperienceLocation` field by field in the web | This is the drift ADR-0066 and ADR-0073 remove. A field renamed on the backend compiles on the web and reads `undefined` there. |
| Keep `?token=` on the preview and water-crop URLs | Nothing reads them without the header any more. The query token outranks the header in `requireAuth`, so it breaks the refresh, and it puts a credential into access logs. |

## Consequences

**Positive:**
- Every type the web names still comes from the backend's schemas: directly, or derived from a generated model.
- A session token appears in a URL only where the transport leaves no other way.

**Negative / Trade-offs:**
- A derived type is a small piece of hand-written TypeScript. Its correctness depends on the models it names, and a reviewer reads it as a derivation rather than a declaration.
- `requireAuth` still reads a query token for the streams. The images no longer use that branch, but the branch itself stays.

## References

- Related ADRs:
  - ADR-0073: the generated client, whose decisions 4 and 5 this narrows;
  - ADR-0066: the answer types come from the backend's schemas;
  - ADR-0072: the OpenAPI document and the components it names.
- Related docs:
  - `docs/tech/development-guide.md` § API Layer;
  - `docs/security/SECURITY.md` § Headers.
- Issues: #1089, the Epic; #1108.

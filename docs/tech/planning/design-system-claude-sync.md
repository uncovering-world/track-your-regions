# Living Design-System Sync to claude.ai/design — Design

**Status:** Design approved 2026-06-20 (brainstorm). Awaiting implementation plan.
**Approach:** A — thin living library, package-shape, grows from POC work.
**Target project:** `Track-Your-Regions UI` (claude.ai/design `74f5b72c-bf36-4a1f-b62c-42c6efaef274`), reused.

## Problem

We want a **living design-system in claude.ai/design**: a continuously re-synced set of
the app's real, compiled UI components + design tokens, so the Claude Design agent (and we)
build new world-view UI (POV axis, L1 views, the level switcher) **on-brand from real
building blocks**, not generic ones, with each design mapping 1:1 onto shippable code.

`track-your-regions` is **not** a packaged design system: no Storybook, `frontend` is an app
(no `main`/`module`/`exports`, no component-library `dist/`), and most components in
`frontend/src/components/shared/` are app-coupled (`CurationDialog`, `AddExperienceDialog`,
`LocationPicker`, `AuthImage` need API / router / auth / MapLibre). So the full `/design-sync`
converter cannot just ingest the repo — the syncable-with-fidelity surface must be scoped, and
the library is seeded thin and grown.

The app **does** have a real theme (`frontend/src/theme/theme.ts`, `createAppTheme()` +
`AppThemeProvider`): light+dark palettes, teal accent `#0d9488`, fonts Syne / Figtree /
JetBrains Mono. That theme is the token source and the provider harness — which is what makes
Approach A feasible without a mock zoo.

## Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Purpose | Living library = source of truth for engineers + design agent | User's goal; not a one-off gallery |
| Approach | **A** — thin, grows from POC | Feasible without data mocks; DS work rides the POC instead of competing with it; defers big refactor |
| Converter shape | **Package shape** (no Storybook) | No Storybook exists; package shape supports authored previews + rubric grading |
| Provider/theme harness | `ThemeProvider` + `createAppTheme()` + `CssBaseline` | Reuse the app's real theme so previews are honestly on-brand |
| Token source | `frontend/src/theme/theme.ts` (`lightPalette`/`darkPalette`, fonts) | Already the app's single source of design tokens |
| Target project | **Reuse** `74f5b72c…`, re-adopt → **atomic path** | Project already exists + user saw it; reconciliation removes the stray exploratory card |
| Membership rule | Presentational only (props-in; no API/router/auth/map) | The only components that render with fidelity without a mock harness |
| Verification | Package-shape absolute rubric + `package-validate.mjs` clean | Fidelity is the whole game — a wrong preview is wrong in every future design |
| Commit footprint | `.design-sync/{config,conventions,NOTES}` + harness; build artifacts gitignored | Keep tooling/config tracked, artifacts out |
| Dark variant, legacy components, `@tyr/ui` package | Out of scope (later) | YAGNI; evolve once the thin library proves out |

## Scope — membership (seed + growth rule)

**Seed (Step 1):**
- **Design tokens** from `theme/theme.ts` — light + dark palettes (teal `#0d9488` accent;
  danger/warning/success), fonts (Syne display / Figtree UI / JetBrains Mono), spacing.
- **Presentational primitives** that already render standalone: `EmptyState`,
  `LoadingSpinner`.

**Growth rule:** a component joins the library **iff it is presentational** — takes its data
via props, with no direct API calls, router, auth context, or MapLibre dependency.
- **Auto-eligible (Step 2+):** the new world-view POC components, built props-in by design —
  `LevelSwitcher` (staged tracker), status chip/glyph, the L1/L2/L3 level views.
- **Excluded for now:** `CurationDialog`, `AddExperienceDialog`, `LocationPicker`, `AuthImage`
  — they need a presentational/container split before they can render with fidelity.

## Architecture

### Converter shape + config
Package shape, driven by `.design-sync/config.json`:
- `componentSrcMap` — the scoped component set (seed first, grown later).
- `tokensGlob` — points at the theme token exports in `theme/theme.ts`.
- root wrapper — a small harness that wraps each preview in
  `<ThemeProvider theme={createAppTheme(...)}><CssBaseline/>…</ThemeProvider>`. The harness
  imports the app's real `createAppTheme`; default to the light palette, dark deferred.
- `readmeHeader` → `.design-sync/conventions.md` (authored at sync time: wrapping/setup, the
  token/style idiom with real names, where the truth lives, one idiomatic snippet).

The converter (`package-build.mjs`) bundles the scoped components via esbuild into
`_ds_bundle.js`, authors previews from each component's real usage examples, validates, and
uploads. `resync.mjs` is the single re-sync driver for the living workflow (build → diff →
validate → scoped capture).

### Target project + upload model
Reuse `Track-Your-Regions UI` (`74f5b72c-bf36-4a1f-b62c-42c6efaef274`). It is non-empty (a
stray exploratory `components/level-switcher/index.html` from this session) → **re-adoption →
atomic path**: build + verify everything locally, then update in one pass at the end;
reconciliation deletes the stray card and any orphan so the project ends up exactly matching
the verified build. Pin `projectId` in `.design-sync/config.json` before any upload.

### Preview authoring + verification
Package shape: previews authored from real usage examples for each scoped component, graded on
the **absolute rubric**; `package-validate.mjs` must exit clean before upload. This gate is
non-negotiable — a component that renders wrong here renders wrong in every design the agent
builds with it, and a wrong `.d.ts`/`.prompt.md` makes it misuse the API everywhere.

## Repo footprint + gates

- **Committed:** `.design-sync/config.json`, `.design-sync/conventions.md`,
  `.design-sync/NOTES.md`, and the provider harness file (kept under `.design-sync/` so it does
  not pollute `frontend/src` or trip knip).
- **Gitignored:** build artifacts (`ds-bundle/`, any staged `.ds-sync/` scripts/output).
- Any code that does land in `frontend/src` must pass `npm run check` (lint + typecheck +
  knip + lint:extra); knip requires new exports to be reachable. The seed needs **no** new
  `frontend/src` code — it reuses existing theme exports and the two existing primitives.

## Sequencing vs the POC (interleave)

- **Step 1 — stand up + seed.** Configure the pipeline; sync tokens + `EmptyState` +
  `LoadingSpinner`. Proves build → verify → upload → re-sync end-to-end on two easy components,
  in the reused project.
- **Step 2 — grow from POC.** As POC slice 1 builds `LevelSwitcher` etc. presentationally, add
  them to `componentSrcMap` and re-sync. The library grows; the POC stays the driver.

The POC (`world-view-levels-and-perspectives-poc-1-shell.md`) and this DS sync share the same
new components — building them props-in satisfies both. The DS effort is a discipline applied
to the POC, not a separate detour.

## ADR + docs

- **ADR** in `docs/decisions/`: adopt claude.ai/design living design-system sync (package
  shape) as the UI source-of-truth surface — a decision about an external service + tooling +
  workflow.
- Document the DS-sync workflow under `docs/tech/` (how to run the first sync and re-syncs).
- No `docs/vision/vision.md` change — not user-facing.

## Out of scope

- Mock harness for data-coupled components (Approach B).
- Extracting a `@tyr/ui` workspace package (Approach C) — a later evolution of A.
- Dark-mode variant cards.
- The legacy dialogs / `LocationPicker` / `AuthImage` until they are split presentational.

## Open questions / risks

- **Token cards format:** how `tokensGlob` surfaces palette/typography as cards vs. as values
  consumed by component previews — resolve against the package-shape sub-skill during planning.
- **Harness import path:** confirm `createAppTheme` can be imported into the harness without
  pulling app-only side effects (it should — `theme.ts` is pure `createTheme`).
- **`.ds-sync` script tracking:** decide during planning whether the staged converter scripts
  are committed (reproducible re-sync) or treated as ephemeral skill-provided tooling.

## References

- Skill: `/design-sync` (package + non-storybook sub-skills), `DesignSync` tool.
- Theme/tokens: `frontend/src/theme/theme.ts`, `frontend/src/theme/AppThemeContext.tsx`.
- Seed components: `frontend/src/components/shared/{EmptyState,LoadingSpinner}.tsx`.
- POC that grows the library: `docs/tech/planning/world-view-levels-and-perspectives-poc-1-shell.md`.
- Umbrella vision: `docs/tech/planning/world-view-levels-and-perspectives.md`.

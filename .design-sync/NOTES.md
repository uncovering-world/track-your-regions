# design-sync notes — track-your-regions

## Repo shape
- `frontend` is an **app**, not a packaged library: no `dist`/`module`/`exports`, no Storybook.
  The converter runs in **synth-entry mode** from `src/` (no `--entry`); components are pinned
  via `cfg.componentSrcMap`.
- `--node-modules` → `frontend/node_modules` (where `react`/`@mui/material` resolve).
- tsconfig path alias: `@/* → src/*` (`cfg.tsconfig: frontend/tsconfig.json`).

## Theming (CSS-in-JS)
- MUI 6 + emotion → **no token stylesheet**. Tokens reach previews via `cfg.provider`
  (`DsPreviewProvider` → MUI `ThemeProvider` + `createAppTheme('light')`).
- `[CSS_RUNTIME]` / `[TOKENS_MISSING]` from validate are **expected and non-blocking** here —
  the bundle is self-styling at runtime. Do NOT set `cssEntry`/`tokensGlob`.
- Real tokens live in `frontend/src/theme/theme.ts` (`createAppTheme`, `lightPalette`,
  `darkPalette`; fonts Syne / Figtree / JetBrains Mono; teal primary `#0d9488`).

## Scope (Step 1 seed)
- Synced: `EmptyState`, `LoadingSpinner` only. Helper: `DsPreviewProvider`.
- Growth rule (later steps): a component joins only if presentational (props-in; no API /
  router / auth / MapLibre). Excluded for now: `CurationDialog`, `AddExperienceDialog`,
  `LocationPicker`, `AuthImage`.

## Build & verify (learned in Step 1)
- **Manual entry, not whole-src synth.** A pure synth entry `export *`s every `frontend/src/*.tsx`
  including `main.tsx` (`ReactDOM.createRoot`) → the bundle crashes at eval. We use a minimal
  hand-written entry `.design-sync/ds-preview-entry.tsx` re-exporting only the seed components +
  `DsPreviewProvider`, passed via `--entry`. Because that entry lives under `.design-sync/`, the
  walk-up sets **PKG_DIR = repo root** — so `cfg.srcDir` and `cfg.componentSrcMap` are
  **repo-root-relative** (`frontend/src/...`), not package-relative.
- **Build command** (from repo root):
  ```
  node .ds-sync/package-build.mjs --config .design-sync/config.json \
    --node-modules frontend/node_modules --entry ./.design-sync/ds-preview-entry.tsx --out ./ds-bundle
  ```
- **`dtsPropsFor` is required.** With PKG_DIR = repo root, ts-morph can't resolve `@types/react`
  (`[DTS_REACT]`) and prop extraction degrades to `[key: string]: unknown`. We hand-write props in
  `cfg.dtsPropsFor`. **Every new component needs a `dtsPropsFor` entry** until we add a real library
  build (Approach C) or make `@types/react` resolvable from the ts-morph root.
- **Render check uses system chrome, no 150 MB download.** `package-validate`/`package-capture`
  honor `DS_CHROMIUM_PATH`. We install only playwright's JS (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  npm i playwright` inside `.ds-sync/`) and run with `DS_CHROMIUM_PATH=/usr/bin/google-chrome-stable`.
  ```
  DS_CHROMIUM_PATH=/usr/bin/google-chrome-stable node .ds-sync/package-validate.mjs ./ds-bundle
  ```
- `[CSS_RUNTIME]` (×2) is expected (CSS-in-JS) and non-blocking. `(.d.ts parse check skipped —
  typescript not in node_modules)` is a minor non-blocking skip (typescript isn't in `.ds-sync/`).

## Known render warns (triaged legitimate)
- `LoadingSpinner` → `[RENDER_THIN]` (thin:true): a spinner has no text by nature and its size
  variants (Default ~40px / Large 56px / Small 20px) differ only in size — visually verified good.
  Not a defect; a re-sync seeing this warn should treat it as known, not new.

## Re-sync risks
- Dark palette not represented (light-only previews). Adding it = a `DsPreviewProvider` variant.
- The provider import is a **relative** path into `frontend/src/theme` — if the theme module
  moves, update `.design-sync/DsPreviewProvider.tsx`.
- Tokens are provider-injected, not a stylesheet: a future "token swatches" card must be an
  authored presentational preview, not a `tokensGlob`.
- Synth-entry `.d.ts` contracts are weaker than a real build would give; if prop tables look
  thin, consider adding a library build later (Approach C in the design doc).

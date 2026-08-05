# Living DS Sync — Step 1 (Seed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is executed by driving the `/design-sync` **package-shape** sub-skill (read it: `non-storybook/SKILL.md`) for the converter/verify/upload tasks, plus normal edits for the repo-side config. Tasks 1–4 are deterministic repo artifacts; Tasks 5–8 are a guided runbook over the sub-skill (its `[TAG]` → fix table is the "how" for the self-heal loop). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the claude.ai/design living-DS pipeline and sync the seed — `EmptyState` + `LoadingSpinner` rendered under the app's MUI theme — into the existing project, proving build → verify → upload → re-sync end-to-end.

**Architecture:** `frontend` is an app, not a packaged library (no `dist`/`exports`), so the converter runs in **synth-entry mode** from `src/` with components pinned via `componentSrcMap`. The DS is **CSS-in-JS (MUI/emotion)**: there is no token stylesheet, so the theme/tokens reach previews through **`cfg.provider`** (a tiny `DsPreviewProvider` wrapping MUI `ThemeProvider` + `createAppTheme('light')`), not via `cssEntry`/`tokensGlob`. Upload uses the **atomic path** (target project already exists and is non-empty).

**Tech Stack:** Node 24, esbuild + ts-morph (converter deps, staged in `.ds-sync/`), React 18.3, MUI 6, `DesignSync` tool, playwright/chromium (render check).

## Global Constraints

- **Target project:** `Track-Your-Regions UI` = claude.ai/design `74f5b72c-bf36-4a1f-b62c-42c6efaef274` — **reuse** (re-adoption → **atomic** upload path). It currently holds one stray exploratory file (`components/level-switcher/index.html`) that this run's reconciliation **deletes**.
- **Shape:** `package`, **synth-entry** (no `dist`); `pkg: "frontend"`, `globalName: "TyrUI"`.
- **Seed scope (only):** `EmptyState`, `LoadingSpinner`. Provider helper: `DsPreviewProvider`. Nothing else.
- **Tokens model:** CSS-in-JS → via `cfg.provider`. No `cssEntry`/`tokensGlob`. `[CSS_RUNTIME]` from validate is expected and non-blocking.
- **Durable set committed** (per sub-skill): `.design-sync/{config.json,NOTES.md,conventions.md,previews/}` + `.design-sync/DsPreviewProvider.tsx`. Artifacts gitignored.
- **Commits:** DCO sign-off (`git commit -s`, author `Nikolay Martyanov <ohmspectator@gmail.com>`) + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. **Commit only on explicit user OK** (project rule — plans/docs are not auto-committed). **Never stage** `.claude/commands/commit.md`, `frontend/package-lock.json`, or `data/`.
- **If any file lands in `frontend/src`:** it must pass `npm run check` (lint + typecheck + knip + lint:extra). The seed adds **no** `frontend/src` files — the provider lives under `.design-sync/` precisely so knip/CI-typecheck never see it.

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `.gitignore` | Ignore converter scratch/artifacts | **Modify** |
| `.design-sync/DsPreviewProvider.tsx` | MUI theme wrapper used as `cfg.provider` | **Create** |
| `.design-sync/config.json` | Converter config (synth-entry, provider, projectId, seed map) | **Create** |
| `.design-sync/NOTES.md` | Repo-specific gotchas + Re-sync risks | **Create** |
| `.design-sync/previews/EmptyState.tsx` | Authored preview stories | **Create** (Task 6) |
| `.design-sync/previews/LoadingSpinner.tsx` | Authored preview stories | **Create** (Task 6) |
| `.design-sync/conventions.md` | README conventions header for the design agent | **Create** (Task 7) |
| `.ds-sync/`, `ds-bundle/`, `.design-sync/.cache/` | Staged scripts / build output / state | gitignored, not committed |

---

### Task 1: Ignore converter scratch + artifacts

**Files:** Modify `.gitignore`

- [ ] **Step 1: Append the design-sync ignore block**

Add to the repo-root `.gitignore`:

```gitignore
# design-sync (claude.ai/design) — staged scripts, build output, machine state
.ds-sync/
ds-bundle/
.design-sync/.cache/
.design-sync/learnings/
.design-sync/node_modules
```

- [ ] **Step 2: Verify ignores resolve and the durable set stays tracked**

Run:
```bash
git check-ignore .ds-sync/x ds-bundle/x .design-sync/.cache/x   # → all three print (ignored)
git check-ignore .design-sync/config.json .design-sync/NOTES.md || echo "tracked-OK"   # → prints "tracked-OK"
```
Expected: the first prints the three paths; the second prints `tracked-OK` (durable set NOT ignored).

- [ ] **Step 3: (commit deferred)** Stage with the rest at Task 8 on user OK. Do not commit now.

---

### Task 2: DsPreviewProvider (MUI theme wrapper)

**Files:** Create `.design-sync/DsPreviewProvider.tsx`

Lives under `.design-sync/` (outside `frontend/src`) so knip and the frontend tsconfig never process it; only esbuild (the converter) compiles it. Uses a **relative** import of the theme (no `@/` alias dependency).

- [ ] **Step 1: Write the provider**

```tsx
import { ThemeProvider, CssBaseline } from '@mui/material';
import type { ReactNode } from 'react';
import { createAppTheme } from '../frontend/src/theme';

// Default to the light palette for previews; dark is a later variant.
const theme = createAppTheme('light');

export function DsPreviewProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Sanity-check the import target exists**

Run:
```bash
node -e "console.log(require('fs').existsSync('frontend/src/theme/index.ts') && 'theme-index-OK')"
grep -n "export { createAppTheme }" frontend/src/theme/index.ts
```
Expected: prints `theme-index-OK` and the `createAppTheme` export line. (No unit test — this file's real gate is the render check in Task 5.)

---

### Task 3: Converter config

**Files:** Create `.design-sync/config.json`

- [ ] **Step 1: Write the config**

```json
{
  "pkg": "frontend",
  "globalName": "TyrUI",
  "shape": "package",
  "projectId": "74f5b72c-bf36-4a1f-b62c-42c6efaef274",
  "srcDir": "src",
  "tsconfig": "frontend/tsconfig.json",
  "componentSrcMap": {
    "EmptyState": "src/components/shared/EmptyState.tsx",
    "LoadingSpinner": "src/components/shared/LoadingSpinner.tsx"
  },
  "extraEntries": ["./.design-sync/DsPreviewProvider.tsx"],
  "provider": { "component": "DsPreviewProvider" },
  "readmeHeader": ".design-sync/conventions.md"
}
```

Notes for the executor (resolve during Task 5, don't pre-guess wrong):
- `componentSrcMap` paths are written **package(frontend)-relative** (`src/...`), matching the sub-skill's own example. If Task 5's build prints `[ZERO_MATCH]` or can't find them, the path base is wrong — try repo-root-relative (`frontend/src/...`); confirm against `grep ASSUMPTION .ds-sync/lib/*.mjs`.
- `extraEntries` path is relative to the config home (repo root). If esbuild can't resolve it, fall back to a repo-root-relative form without `./`.
- `readmeHeader` points at a file created in Task 7; the converter tolerates its absence until then (header is empty) — that's fine for the Task 5 dry runs.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.design-sync/config.json','utf8')); console.log('config-JSON-OK')"`
Expected: `config-JSON-OK`.

---

### Task 4: NOTES.md (gotchas + re-sync risks)

**Files:** Create `.design-sync/NOTES.md`

- [ ] **Step 1: Write the notes**

```markdown
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

## Re-sync risks
- Dark palette not represented (light-only previews). Adding it = a `DsPreviewProvider` variant.
- The provider import is a **relative** path into `frontend/src/theme` — if the theme module
  moves, update `.design-sync/DsPreviewProvider.tsx`.
- Tokens are provider-injected, not a stylesheet: a future "token swatches" card must be an
  authored presentational preview, not a `tokensGlob`.
- Synth-entry `.d.ts` contracts are weaker than a real build would give; if prop tables look
  thin, consider adding a library build later (Approach C in the design doc).
```

- [ ] **Step 2: (commit deferred)** Committed with the durable set at Task 8.

---

### Task 5: Run the converter + self-heal to a clean validate

**Sub-skill:** package-shape §2.7 (stage + run) and §3 (self-heal tag table). Run from repo root.

- [ ] **Step 1: Stage scripts + install converter deps**

```bash
BASE="/tmp/claude-1000/bundled-skills/2.1.183/113207198482aebded5dd8f801ac9971/design-sync"
mkdir -p .ds-sync && cp -r "$BASE"/package-build.mjs "$BASE"/package-validate.mjs "$BASE"/package-capture.mjs "$BASE"/resync.mjs "$BASE"/lib "$BASE"/storybook .ds-sync/
echo '{"name":"ds-sync-deps","private":true}' > .ds-sync/package.json
(cd .ds-sync && npm i esbuild ts-morph @types/react)
```
(If `$BASE` no longer exists in a later session, re-resolve the `/design-sync` skill base dir.)

- [ ] **Step 2: Build (synth-entry — no `--entry`)**

```bash
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules frontend/node_modules --out ./ds-bundle
```
Expected: emits `components/<group>/{EmptyState,LoadingSpinner}/…` + `_ds_bundle.js` + `styles.css`. Check the build log lists **2** components.
- `[ZERO_MATCH]`/missing components → fix `componentSrcMap` path base (Task 3 note), rebuild.
- `[NO_DIST]` insisting on an entry → confirm synth-entry is engaged (no `--entry` passed); if the converter truly needs a built entry, that is a finding — stop and report (would push us toward a small library build).

- [ ] **Step 3: Decide the render-check browser (sub-skill §4.1)**

```bash
ls ~/.cache/ms-playwright/ 2>/dev/null; which chromium chromium-headless-shell google-chrome google-chrome-stable
```
`google-chrome-stable` is present. If playwright's chromium isn't cached, **AskUserQuestion** before installing (~200MB): install playwright+chromium / skip-render (`--no-render-check`, machine-unverified) / user opens previews themselves. Record the choice.

- [ ] **Step 4: Validate + self-heal loop**

```bash
node .ds-sync/package-validate.mjs ./ds-bundle
```
Repeat build→validate, applying the §3 `[TAG]` → fix table, until it **exits 0**. Expected/likely tags for this seed:
- `[CSS_RUNTIME]` / `[TOKENS_MISSING]` → **ignore** (CSS-in-JS; see NOTES).
- `[RENDER] root empty` with a "context/provider" `firstErr` → `cfg.provider` not applied; confirm `DsPreviewProvider` is a bundle export (`[PROVIDER_UNEXPORTED]`/`[PROVIDER_INVALID]` name fixes) and in `extraEntries`.
- `[FONT_MISSING]` for Syne/Figtree/JetBrains Mono → these are app-served brand fonts; set `cfg.runtimeFontPrefixes: ["Syne","Figtree","JetBrains Mono"]` (record in NOTES), don't substitute.

- [ ] **Step 5: Eyeball the contact sheet**

Read `ds-bundle/.render-check.json` (both components should be `fallbackCard: true` at this point — unauthored floor cards, **not** failures) and `ds-bundle/_screenshots/contact-sheet-*.png`. Confirm both render styled (teal MUI theme visibly applied), not browser-default.

---

### Task 6: Author + grade the two seed previews

**Sub-skill:** package-shape §4.2 (author), §4.3 (grade), §4.4 (review). Both components are simple → author both solo (no subagent fan-out for 2 items).

- [ ] **Step 1: Author `.design-sync/previews/EmptyState.tsx`**

Stories as named exports (each = one graded cell), real JSX importing from the package global build; realistic copy, the `padding` axis swept. No generated marker line.

```tsx
import { EmptyState } from 'frontend/src/components/shared/EmptyState';

export const NoRegions = () => <EmptyState message="No regions in this world view yet." />;
export const NoResults = () => <EmptyState message="No experiences match your filters." />;
export const Tight = () => <EmptyState message="Nothing here." padding={1} />;
```
(If importing via the package path fails in the preview build, use the import form the converter's other emitted `<Name>.jsx` stubs use — check `ds-bundle/components/**/EmptyState.jsx` for the exact re-export specifier and mirror it.)

- [ ] **Step 2: Author `.design-sync/previews/LoadingSpinner.tsx`**

```tsx
import { LoadingSpinner } from 'frontend/src/components/shared/LoadingSpinner';

export const Default = () => <LoadingSpinner />;
export const Small = () => <LoadingSpinner size={20} />;
export const Large = () => <LoadingSpinner size={56} />;
```

- [ ] **Step 3: Rebuild + capture**

```bash
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules frontend/node_modules --out ./ds-bundle
node .ds-sync/package-capture.mjs --out ./ds-bundle
```
Expected: capture prints the cell labels (`NoRegions`, `NoResults`, `Tight`, `Default`, `Small`, `Large`) and writes `ds-bundle/_screenshots/review/*.png`.

- [ ] **Step 4: Grade each cell (absolute rubric)**

Read each review sheet; write `.design-sync/.cache/review/EmptyState.grade.json` and `LoadingSpinner.grade.json`:
```json
{"cells": {"NoRegions": {"verdict": "good", "note": "themed muted text, centered"}, "...": {"verdict": "good"}}}
```
Grade **styled / complete / plausible**. Any `needs-work` → fix the `.tsx`, rebuild, recapture, regrade until all `good`.

- [ ] **Step 5: Human review (sub-skill §4.4)**

```bash
node .ds-sync/storybook/http-serve.mjs ./ds-bundle   # background; prints the port
```
Tell the user: open `http://127.0.0.1:<port>/.review.html` — 2 components, 6 cells, graded good — and to flag anything off-brand. Apply feedback → rebuild → recapture → regrade.

---

### Task 7: Conventions header + final driver rebuild

**Sub-skill:** base SKILL.md "Author the conventions header", then the **rebuild rule**.

- [ ] **Step 1: Author `.design-sync/conventions.md`**

Terse (2–4k chars), for the design agent. Cover, with **real names verified against the build**:
- **Wrap & setup:** every design wraps in the MUI theme — `import { ThemeProvider, CssBaseline } from '@mui/material'` + `createAppTheme('light'|'dark')` from `frontend/src/theme`. Without it, components render unthemed.
- **Idiom:** MUI — no CSS classes; style via props/`sx` and theme tokens. Palette: primary teal `#0d9488`, plus `error`/`warning`/`success`; fonts Syne (display) / Figtree (UI) / JetBrains Mono. Use `color="text.secondary"`, `variant="body2"`, etc.
- **Where truth lives:** `frontend/src/theme/theme.ts`; per-component `_ds/<…>/<Name>.d.ts` + `.prompt.md`.
- **One snippet:** a small `<EmptyState message="…" />` inside the provider.

- [ ] **Step 2: Validate every name you wrote**

```bash
grep -RnoE "EmptyState|LoadingSpinner|createAppTheme|ThemeProvider" .design-sync/conventions.md
ls ds-bundle/components/*/ | sort -u    # component dirs = the name index
grep -c "0d9488" ds-bundle/_ds_bundle.js || true
```
Fix or cut any name that doesn't appear in the build.

- [ ] **Step 3: Final rebuild so the README carries the header**

```bash
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules frontend/node_modules --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle    # must exit 0
```

---

### Task 8: Upload (atomic path) + verify + commit offer

**Sub-skill:** base SKILL.md §0/§1 router (pinned → atomic) + package-shape §5. The project is non-empty (the stray card) → **atomic**.

- [ ] **Step 1: Pre-upload gate check**

Confirm: validate exits 0; render-check `bad` empty; all 6 cells graded `good`; user has seen `.review.html` (or declined); `package-capture.mjs` final run shows `carried forward`, no `[LEARNINGS_UNMERGED]`.

- [ ] **Step 2: Review remote files for deletes (no anchor yet)**

```bash
```
Call `DesignSync(list_files, projectId)`. The project has no `_ds_sync.json` anchor, so derive deletes by review: any remote path the new `ds-bundle/` does NOT produce — here the stray `components/level-switcher/index.html` (and its dir). Put those exact paths in the plan's `deletes`.

- [ ] **Step 3: finalize_plan (atomic)**

`DesignSync(finalize_plan, projectId, localDir: "./ds-bundle", writes: [...full list per §5...], deletes: ["components/level-switcher/index.html"])`. Explain the approval to the user in plain language first. If denied → stop; report `ds-bundle/` path; don't retry with different args.

- [ ] **Step 4: Upload sequence (fixed order, §5)**

1. sentinel `_ds_needs_recompile` first;
2. all content writes (chunk ≤256 files);
3. deletes (`components/level-switcher/index.html` + dir);
4. sentinel re-arm, then `_ds_sync.json` **last**.
Any unclearable write/delete failure → STOP (no sentinel re-arm, no `_ds_sync.json`).

- [ ] **Step 5: Verify + record**

```bash
```
`DesignSync(list_files)` — confirm the count matches `ds-bundle/` and the stray card is gone. `projectId` is already in config (recorded at settlement). Output the project URL `https://claude.ai/design/p/74f5b72c-bf36-4a1f-b62c-42c6efaef274`. Ask the user to open the DS pane and confirm `EmptyState`/`LoadingSpinner` cards render.

- [ ] **Step 6: Commit offer (durable set only)**

On user OK, one commit (sync inputs only), DCO + Co-Authored-By:
```bash
git add .gitignore .design-sync/config.json .design-sync/NOTES.md .design-sync/conventions.md \
  .design-sync/DsPreviewProvider.tsx .design-sync/previews/
git commit -s -m "chore: add claude.ai/design living DS sync (Step 1 seed)"
```
Confirm `git status` shows no `.ds-sync/`/`ds-bundle/`/`.cache/` staged (gitignored). Do NOT commit without explicit OK.

---

## Self-Review (by plan author)

- **Spec coverage:** delivers spec §"Sequencing — Step 1" (stand up + seed: tokens-via-provider + `EmptyState` + `LoadingSpinner` into the reused project); §"Converter shape + harness" (package/synth-entry + `DsPreviewProvider`); §"Target project + upload" (reuse `74f5b72c…`, atomic, stray-card reconciliation); §"Verification" (render check + absolute grading); §"Repo footprint + gates" (Task 1 gitignore, durable set committed, no `frontend/src` additions). §"ADR + docs" is **not** in this plan — flagged below as a deliberate follow-up.
- **Deliberate deviation from spec §1:** "design tokens as cards" does not apply to a CSS-in-JS (MUI) DS — tokens flow through `cfg.provider`, documented in NOTES + Task 7. Explicit token-swatch cards, if wanted, are a later authored preview (recorded in Re-sync risks).
- **Placeholder scan:** none. Tasks 5–8 cite exact commands + the sub-skill's tag table for the inherently iterative self-heal loop (delegation to a documented sub-procedure, not vagueness). The "resolve during execution" notes (path base, import specifier) are guarded fallbacks with a concrete primary, not TBDs.
- **Consistency:** `pkg`/`globalName`/`projectId`/`provider.component` (`DsPreviewProvider`) match across config, provider file, and upload tasks; component names (`EmptyState`/`LoadingSpinner`) and cell labels are stable across Tasks 5–8.

## Open follow-ups (NOT this plan)

- **ADR** (spec §"ADR + docs"): write `docs/decisions/` ADR adopting claude.ai/design living DS sync — do as a separate small change once the seed proves out (avoids an ADR for an unproven pipeline).
- **`docs/tech/` workflow doc:** how to run the first sync + re-syncs — fold in with the ADR.
- **Step 2 (separate plan):** add POC world-view presentational components (`LevelSwitcher`, status chip/glyph, level views) to `componentSrcMap` + re-sync via `resync.mjs`.

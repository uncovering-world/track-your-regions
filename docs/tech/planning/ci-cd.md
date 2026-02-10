# CI/CD

> **Implementation Status:** Implemented. This document records the current workflow and optional future refinements.

---

## Goal
Run consistent checks for backend and frontend on every push/PR to `main`.

## Current State
- Single workflow at `.github/workflows/ci.yml`
- Uses `pnpm` + Node `20`
- Runs backend and frontend: `lint`, `typecheck`, `build`

## Current Workflow

`ci.yml` runs:
1. **Lint** - ESLint for both backend and frontend
2. **Type Check** - TypeScript compiler (--noEmit)
3. **Build** - Verify the code compiles

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch: {}

jobs:
  lint-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: |
          pnpm --prefix backend install
          pnpm --prefix frontend install

      - name: Lint
        run: |
          pnpm --prefix backend run lint
          pnpm --prefix frontend run lint

      - name: Type Check
        run: |
          pnpm --prefix backend run typecheck
          pnpm --prefix frontend run typecheck

      - name: Build
        run: |
          pnpm --prefix backend run build
          pnpm --prefix frontend run build
```

No additional workflows are currently tracked in this repo.

## Local Verification

1. **Local verification:**
   ```bash
   npm run check  # runs lint + typecheck
   npm run build  # verify build works
   ```

After pushing, CI should execute automatically for `push`/`pull_request` to `main`.

## Future Improvements (Optional)

- Add caching optimization for monorepo dependency install speed
- Add test jobs if dedicated backend/frontend test suites are introduced
- Add fresh-DB E2E pipelines based on `e2e-fresh-db-strategy.md` (smoke on PR, full nightly/manual)
- Add path-filtered jobs if CI time becomes a bottleneck

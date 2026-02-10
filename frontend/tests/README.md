# Frontend Testing

This folder contains automated tests for the frontend.

## Test Types

- Unit/integration (`Vitest`): `src/**/*.test.ts(x)`
- E2E (`Playwright Test`): `tests/e2e/**/*.spec.ts`

## Prerequisites

1. Install dependencies:
```bash
npm --prefix frontend install
```

2. Ensure Docker is running.

## Commands

From repo root:

```bash
npm run test
npm run test:coverage
npm run test:e2e:smoke
npm run test:e2e:full
```

Every `test*` command now prints an explicit final report including:
- suites/tests passed/failed/skipped
- exact test files executed
- exact test case names executed

## E2E Lanes

- `smoke`: only tests tagged with `@smoke` (fast local/PR safety)
- `full`: complete E2E suite (includes smoke + broader scenarios)

Current smoke scenarios:
- Shell navigation (`Map` <-> `Discover`, sign-in dialog open/close)
- Map explore workflow (select region, open/close explore panel)
- Discover source workflow (click region source tag and load experience view)

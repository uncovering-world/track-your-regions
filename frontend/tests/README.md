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

3. E2E smoke expects the seeded fixture, not your dev data: `npm run
   test:e2e:smoke` stands up the isolated test stack and seeds world view
   9001 (`backend/src/db/seed/e2eFixture.ts`) automatically — the only path
   that seeds it for you (`npm run db:seed:e2e` seeds manually, against
   whatever test DB the backend env names). Pointing Playwright at a dev
   stack or a restored dump fails: `explore-workflows` opens the fixture
   region at `/wv/9001/r/9001` (an address now, #644), and
   `shell-navigation`'s first test relies on it being the only non-default
   world view, since `useNavigation` hides the GADM default from non-admin
   users.

   `TEST_REPORT_LOCAL=1`, the documented way to run the unit lanes without
   Docker, has no meaning here and is refused: on the host the runner would
   skip `scripts/test-stack.sh` and browse the dev stack instead, which is
   the failure the paragraph above describes. Run the lane without the
   variable — it brings the stack up and seeds the fixture itself.

   Invoking Playwright directly is the same trap by another door: its
   `baseURL` defaults to `http://localhost:5173`, the **dev** stack, while
   the test stack's frontend answers on `TEST_FRONTEND_PORT` (5174). A hand
   run — for `--ui`, or a `--grep` while writing a spec — says which stack
   it means, after `npm run test:stack:up` has started and seeded one:

   ```bash
   npm run test:stack:up
   cd frontend && E2E_BASE_URL=http://localhost:5174 npx playwright test --project=smoke
   ```

   `frontend`'s own `test:e2e` script is that bare invocation under a name
   that reads like the lane — it is not one, and it takes the default
   `baseURL`. Nothing calls it; whether it should exist is #699.

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

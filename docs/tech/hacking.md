# Hacking Guide

Quick engineering guide for making safe changes in this repo.

## Local Stack

```bash
npm run db:up
npm run db:status
npm run dev
```

Services:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`
- Postgres/PostGIS: from `.env` (`DB_*`)

## High-Value Commands

```bash
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix backend run lint
```

Database helpers:

```bash
npm run db:list
npm run db:use <db_name>
npm run db:mark-golden
```

## Where Things Live

- API routes: `backend/src/routes/*`
- Core world-view/region logic: `backend/src/controllers/worldView/*`
- Experience browse + visit logic: `backend/src/controllers/experience/experienceController.ts`
- Experience curation logic: `backend/src/controllers/experience/curationController.ts`
- Frontend map/navigation shell: `frontend/src/components/MainDisplay.tsx`
- Discover UI: `frontend/src/components/discover/*`
- World View editor: `frontend/src/components/WorldViewEditor/*`

## Common Change Patterns

### Add or change API fields

1. Update backend query/controller.
2. Update frontend API type in `frontend/src/api/*`.
3. Update consuming component hooks/UI.
4. Run `typecheck` for both packages.

### Add a new experience source

1. Seed source in `experience_sources`.
2. Implement sync service under `backend/src/services/sync/`.
3. Wire sync controller/admin route behavior.
4. Confirm source appears via `/api/experiences/sources`.

### Map/UI behavior regressions

1. Check request payloads in browser network tab.
2. Verify backend response shape first.
3. Check frontend feature flags/role gates (`useAuth`, curator checks).

## Guardrails

- Do not hand-edit generated/simplified geometry columns in SQL; rely on triggers.
- Preserve manual curation invariants:
  - `manual` assignments must survive re-sync/re-assignment.
  - `curated_fields` must prevent overwrite from sync upserts.
- Use `memberRowId` where region members may be duplicated via custom geometry splits.

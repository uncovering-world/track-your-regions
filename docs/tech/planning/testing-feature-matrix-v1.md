# Testing Feature Matrix v1

> **Status:** Draft v1. This is the first complete inventory of implemented use cases/workflows/scenarios for test planning.
>
> Related docs:
> - `testing-strategy.md`
> - `e2e-fresh-db-strategy.md`

## Scope

- Focuses on currently implemented behavior in `frontend/` and `backend/`.
- Covers visitor, authenticated user, curator, and admin actions.
- Includes both UI workflows and critical API/permission workflows.

## Workflow Map (User Journeys)

| Workflow ID | Workflow | Primary Roles |
|---|---|---|
| `WF-01` | Browse map/discover without login | Visitor |
| `WF-02` | Register/login/logout/token refresh | Visitor, User |
| `WF-03` | Navigate world views/regions/divisions/search | Visitor, User, Admin |
| `WF-04` | Map Mode explore panel + markers + detail | Visitor, User, Curator |
| `WF-05` | Discover Mode tree -> source -> map/list -> detail | Visitor, User, Curator |
| `WF-06` | Mark/unmark visited regions | User, Curator, Admin |
| `WF-07` | Mark/unmark visited experiences and locations; mark seen contents | User, Curator, Admin |
| `WF-08` | Curate experiences (edit/reject/unreject/assign/create) | Curator, Admin |
| `WF-09` | World view management (create/edit/delete world view) | Admin |
| `WF-10` | Region hierarchy editing (tree + members + DnD + flatten/expand) | Admin |
| `WF-11` | Custom subdivision map tools (`assign/split/cut`) | Admin |
| `WF-12` | Geometry operations (compute/reset/hull/display geom regen) | Admin |
| `WF-13` | Admin sync, assignment, logs, source reorder | Admin |
| `WF-14` | Curator management and scoped access | Admin |
| `WF-15` | Fresh DB lifecycle + GADM bootstrap for E2E | Test system |

## Capability Inventory

| Capability ID | Workflow | Capability | Entry Points |
|---|---|---|---|
| `AUTH-01` | `WF-02` | Register with email/password | `/api/auth/register`, `RegisterDialog` |
| `AUTH-02` | `WF-02` | Login with email/password | `/api/auth/login`, `LoginDialog` |
| `AUTH-03` | `WF-02` | Refresh token rotation + silent refresh on load | `/api/auth/refresh`, `useAuth` |
| `AUTH-04` | `WF-02` | Logout invalidates local/server token state | `/api/auth/logout`, `UserMenu` |
| `AUTH-05` | `WF-02` | OAuth callback (Google; Apple path exists) | `/api/auth/google*`, `AuthCallbackHandler` |
| `AUTH-06` | `WF-02` | Role-aware UI gates (admin panel, curator actions) | `useAuth`, role-based rendering |
| `NAV-01` | `WF-03` | World view selection and URL persistence (`?wv`) | `HierarchySwitcher`, `useNavigation` |
| `NAV-02` | `WF-03` | Region/division list drill-down and back navigation | `RegionList`, `RegionMapVT` |
| `NAV-03` | `WF-03` | Search regions/divisions | `Search`, `/api/world-views/*/regions/search`, `/api/divisions/search` |
| `NAV-04` | `WF-03` | Breadcrumb navigation (map and discover) | `BreadcrumbNavigation`, `DiscoverPage` |
| `MAP-01` | `WF-04` | Open/close Region Explore panel | `MainDisplay`, `RegionDescriptionSection` |
| `MAP-02` | `WF-04` | Experience grouping by source + source expansion state | `ExperienceList`, `useExperienceContext` |
| `MAP-03` | `WF-04` | Marker clustering, hover ring, selected highlight layer | `ExperienceMarkers` |
| `MAP-04` | `WF-04` | Multi-location badge and selected-location expansion | `ExperienceMarkers`, `ExperienceListItem` |
| `MAP-05` | `WF-04` | Marker/list hover synchronization and auto-scroll | `ExperienceMarkers`, `ExperienceList` |
| `MAP-06` | `WF-04` | Marker click selection with fit/fly behavior | `ExperienceMarkers`, `useExperienceContext` |
| `MAP-07` | `WF-04` | Hover preview card with dynamic placement | `RegionMapVT` |
| `DISC-01` | `WF-05` | Region source-count tree navigation | `DiscoverRegionList`, `useDiscoverExperiences` |
| `DISC-02` | `WF-05` | Discover map markers and clustering | `DiscoverExperienceView` |
| `DISC-03` | `WF-05` | Discover list/map hover sync + detail panel sync | `DiscoverExperienceView`, `ExperienceDetailPanel` |
| `DISC-04` | `WF-05` | Selected experience location highlight/fly-to | `DiscoverExperienceView` |
| `VIS-01` | `WF-06` | Toggle visited regions per world view | `useVisitedRegions`, `/api/users/me/visited-regions*` |
| `VIS-02` | `WF-07` | Toggle visited experiences | `useVisitedExperiences`, `/api/users/me/visited-experiences*` |
| `VIS-03` | `WF-07` | Toggle visited locations + mark/unmark all | `useVisitedLocations`, `/api/users/me/visited-locations*` |
| `VIS-04` | `WF-07` | Viewed contents tracking | `useViewedContents`, `/api/users/me/viewed-contents*` |
| `VIS-05` | `WF-07` | Experience visited status aggregation | `useExperienceVisitedStatus`, `/api/users/me/experiences/:id/visited-status` |
| `CUR-01` | `WF-08` | Curator edit experience fields | `CurationDialog`, `/api/experiences/:id/edit` |
| `CUR-02` | `WF-08` | Reject/unreject in region scope | `CurationDialog`, `/api/experiences/:id/reject|unreject` |
| `CUR-03` | `WF-08` | Assign/unassign existing experience to region | `AddExperienceDialog`, `/api/experiences/:id/assign*` |
| `CUR-04` | `WF-08` | Create manual experience with location picker | `AddExperienceDialog`, `/api/experiences` |
| `CUR-05` | `WF-08` | Curation log visibility | `CurationDialog`, `/api/experiences/:id/curation-log` |
| `CUR-06` | `WF-08` | Rejected visibility: hidden to public, visible to curator scope | `/api/experiences/by-region/:regionId` |
| `WV-01` | `WF-09` | Create/edit/delete custom world view | `HierarchySwitcher`, `/api/world-views` |
| `WV-02` | `WF-10` | Create/edit/delete regions in tree | `WorldViewEditor`, `/api/world-views/:id/regions*` |
| `WV-03` | `WF-10` | Add/remove/move members | `WorldViewEditor`, `/api/world-views/regions/:id/members*` |
| `WV-04` | `WF-10` | Flatten/expand subregion operations | `ActionStrip`, `/flatten/*`, `/expand` |
| `WV-05` | `WF-10` | Region color inheritance/propagation | `RegionTreePanel`, `ActionStrip` |
| `WV-06` | `WF-11` | Split division into children (paged fetch) | `MapViewTab`, `/api/divisions/:id/subdivisions` |
| `WV-07` | `WF-11` | Cut division into custom parts | `MapViewTab`, `CutDivisionDialog` |
| `WV-08` | `WF-11` | Assign members into custom subdivision groups | `CustomSubdivisionDialog` |
| `WV-09` | `WF-12` | Compute geometries (single/all), status, cancel | `/compute-geometries*`, geometry UI |
| `WV-10` | `WF-12` | Hull preview/save and params load | `/hull/preview`, `/hull/save`, `/hull/params` |
| `WV-11` | `WF-12` | Display geometry status + regenerate | `/display-geometry-status`, `/regenerate-display-geometries` |
| `ADM-01` | `WF-13` | Sync source start/status/cancel/fix-images | `SyncPanel`, `/api/admin/sync/*` |
| `ADM-02` | `WF-13` | Reorder sync source priorities | `SyncPanel`, `/api/admin/sync/sources/reorder` |
| `ADM-03` | `WF-13` | Sync logs and log details | `SyncHistoryPanel`, `/api/admin/sync/logs*` |
| `ADM-04` | `WF-13` | Experience region assignment start/status/cancel | `AssignmentPanel`, `/api/admin/experiences/assign-regions*` |
| `ADM-05` | `WF-13` | Counts-by-region overview | `AssignmentPanel`, `/api/admin/experiences/counts-by-region` |
| `ADM-06` | `WF-14` | Curator assignment CRUD and activity | `CuratorPanel`, `/api/admin/curators*` |
| `SYS-01` | `WF-15` | Fresh DB create/use/drop lifecycle | `scripts/db-cli.sh`, `npm run db:*` |
| `SYS-02` | `WF-15` | GADM import and readiness checks | `npm run db:load-gadm`, `db/init-db.py` |
| `SYS-03` | `WF-15` | Full-stack startup against selected test DB | `docker compose`, `npm run dev` |

## Scenario Families (Apply to Every Capability)

| Scenario Type | Description | Typical Test Level |
|---|---|---|
| `HAPPY` | Primary intended flow works end-to-end | Integration + E2E |
| `EDGE` | Boundary/variant input behavior | Unit + Integration |
| `PERM` | Role/permission restrictions | Integration + E2E |
| `FAIL` | Error path and user-visible feedback | Integration + E2E |
| `RECOVERY` | Retry/reload/re-open keeps consistent state | Integration + E2E |

## Initial Priority for Coverage Expansion

| Priority | Capability IDs |
|---|---|
| `P0` | `AUTH-02`, `AUTH-03`, `NAV-01`, `MAP-03`, `MAP-04`, `MAP-06`, `DISC-02`, `VIS-01`, `VIS-02`, `VIS-03`, `CUR-02`, `CUR-04`, `WV-06`, `WV-07`, `ADM-01`, `ADM-04`, `SYS-01`, `SYS-02` |
| `P1` | `AUTH-01`, `AUTH-04`, `NAV-02`, `NAV-03`, `MAP-02`, `MAP-05`, `DISC-01`, `DISC-03`, `VIS-04`, `VIS-05`, `CUR-01`, `CUR-03`, `WV-02`, `WV-03`, `WV-04`, `WV-09`, `ADM-03`, `ADM-06` |
| `P2` | `AUTH-05`, `MAP-07`, `DISC-04`, `CUR-05`, `CUR-06`, `WV-05`, `WV-08`, `WV-10`, `WV-11`, `ADM-02`, `ADM-05`, `SYS-03` |

## E2E Lane Allocation (First Draft)

| Lane | Goal | Included Capability IDs |
|---|---|---|
| `E2E-SMOKE` (PR) | Core user product safety in short runtime | `AUTH-02`, `AUTH-03`, `NAV-01`, `NAV-02`, `MAP-03`, `MAP-04`, `MAP-06`, `DISC-02`, `DISC-03`, `VIS-01`, `VIS-02`, `VIS-03` |
| `E2E-FULL` (nightly/manual) | Broad behavior confidence | all `P0` + all `P1` + selected `P2` paths |

## Local Development Usage Policy

- During local feature work, run targeted tests for touched capabilities continuously.
- Before commit, run the fast lane locally plus impacted `E2E-SMOKE` journeys.
- For changes touching `P0` capabilities, local smoke execution is mandatory before PR.

Calibration from interview round 1:
- Admin workflows are nightly-only (`Q2`).
- Curator workflows are nightly-only (`Q3`).
- Map/Discover marker behavior parity is mandatory in smoke (`Q15`).
- Runtime budgets: PR <= 1h, nightly <= 5h (`Q8`, `Q9`).
- Seed accounts: PR smoke uses `user`; nightly full uses `user+curator+admin` (`Q16`).
- Setup method: create accounts via API and apply roles with a minimal helper (`Q17`).

## Known Gaps to Resolve in Interview

1. Confirm whether `OAuth Apple` should be in automated scope now or deferred.
2. Confirm map visual-regression strategy (strict screenshots vs behavior assertions).
3. Confirm final policy for preserving DB dumps on failure.

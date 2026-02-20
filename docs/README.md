# Documentation

## Structure

```
docs/
├── README.md              ← this file
├── decisions/             ← Architecture Decision Records (immutable)
├── inbox/                 ← unsorted docs awaiting categorization
├── security/              ← OWASP ASVS security profile, checklist, audit reports
├── tech/                  ← technical implementation details
│   ├── planning/          ← plans for features to build
│   └── ...                ← docs for implemented features
└── vision/                ← non-technical vision and user stories
    ├── vision.md          ← root vision document (start here)
    └── ...                ← feature-specific vision docs
```

## Tech — Implemented Features

| Document | Topic |
|----------|-------|
| [authentication.md](tech/authentication.md) | JWT, OAuth 2.0, access levels, token lifecycle, email verification |
| [email-setup.md](tech/email-setup.md) | Email infrastructure setup (dev console, production SMTP) |
| [domain-model.md](tech/domain-model.md) | Core entities, aggregates, relationships |
| [ddd-overview.md](tech/ddd-overview.md) | Domain-Driven Design concepts used in the project |
| [experiences.md](tech/experiences.md) | Experience sources, sync, region assignment, API |
| [experience-map-ui.md](tech/experience-map-ui.md) | Map Mode + Discover Mode marker layers, hover/selection sync, multi-location behavior |
| [world-views.md](tech/world-views.md) | Custom regional hierarchies, geometry computation |
| [custom-subdivision-map-tools.md](tech/custom-subdivision-map-tools.md) | Create Subregions map tab internals (`assign/split/cut`), geometry loading, pagination |
| [geometry-columns.md](tech/geometry-columns.md) | Geometry system reference — pipeline rules, columns, triggers, functions, tile cache |
| [hull-geometry.md](tech/hull-geometry.md) | Hull visualization for scattered regions, concave hull generation |
| [gadm-mapping.md](tech/gadm-mapping.md) | GADM database structure and integration |
| [STATE-MANAGEMENT.md](tech/STATE-MANAGEMENT.md) | Frontend state: React Query, localStorage, Zustand considerations |
| [rate-limiting.md](tech/rate-limiting.md) | Rate limiting tiers, per-endpoint strategy, adding limiters to new routes |
| [hacking.md](tech/hacking.md) | Practical engineering guide for local debugging and safe changes |
| [development-guide.md](tech/development-guide.md) | Code organization conventions, splitting patterns, commit hygiene |
| [shared-frontend-patterns.md](tech/shared-frontend-patterns.md) | Shared UI components and utilities — full inventory with "use this, not that" reference |
| [maplibre-patterns.md](tech/maplibre-patterns.md) | MapLibre + react-map-gl patterns and pitfalls — overlapping layers, MVT properties, feature IDs, fonts, paint priority |

## Tech — Planning

| Document | Topic | Status |
|----------|-------|--------|
| [curator-system.md](tech/planning/curator-system.md) | Curator roles, scope-based auth, curation workflows | Core implemented; remaining improvements listed |
| [ci-cd.md](tech/planning/ci-cd.md) | GitHub Actions CI workflow | Implemented |
| [testing-strategy.md](tech/planning/testing-strategy.md) | High-level testing model (fast lane + E2E lanes, coverage philosophy, CI tiers) | In progress (baseline implemented; command defaults aligned) |
| [testing-feature-matrix-v1.md](tech/planning/testing-feature-matrix-v1.md) | First-pass use-case/workflow/scenario inventory mapped to test lanes | Draft v1 (active) |
| [testing-interview-notes.md](tech/planning/testing-interview-notes.md) | Structured interview questionnaire to finalize scope/priorities | In progress |
| [e2e-fresh-db-strategy.md](tech/planning/e2e-fresh-db-strategy.md) | Full-fidelity E2E approach with fresh DB + GADM + UI-driven flows | In progress (default isolated test environment; full fresh-GADM workflow pending) |
| [deployment.md](tech/planning/deployment.md) | Production deployment (PaaS options, DigitalOcean setup) | Planned |
| [mobile-planning.md](tech/planning/mobile-planning.md) | Mobile app strategy (React Native vs native) | Planned |
| [region-metadata-layers.md](tech/planning/region-metadata-layers.md) | Groupings, disputed territories, changes since visit, historical countries — overview | Planned |
| [groupings.md](tech/planning/groupings.md) | Groupings/Tags detailed plan — data model, API, UI, seed data, phases | Planned |
| [ENV-PLAN.md](tech/planning/ENV-PLAN.md) | Database bootstrap and current command workflow | Implemented |

## Vision

| Document | Topic |
|----------|-------|
| [vision.md](vision/vision.md) | **Root vision** — project idea, user roles, design principles |
| [EXPERIENCES-OVERVIEW.md](vision/EXPERIENCES-OVERVIEW.md) | **Experiences master overview** — categories, venues & treasures, type & significance, tracking, gamification, phases (start here for experiences) |
| [QUIZ-SYSTEM.md](vision/QUIZ-SYSTEM.md) | Quiz design: card types, rounds, adaptiveness, data import |
| [CONNECTION-LEVEL-CHECKLIST.md](vision/CONNECTION-LEVEL-CHECKLIST.md) | Depth-of-connection criteria and mechanics |
| [PROPOSED-EXPERIENCE-CATEGORIES.md](vision/PROPOSED-EXPERIENCE-CATEGORIES.md) | Detailed proposals for 25+ experience categories with data sources |
| [EXPERIENCE-TYPE-AND-SIGNIFICANCE.md](vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md) | Per-category type enums and binary significance (Iconic or default) |
| [REGIONAL-PROFILE.md](vision/REGIONAL-PROFILE.md) | Region snapshot cards, "changes since your visit" |
| [LOCALS-PERSPECTIVE.md](vision/LOCALS-PERSPECTIVE.md) | User-generated local knowledge content |
| [user-stories-general.md](vision/user-stories-general.md) | Core user stories (registration, tracking, social) |
| [user-stories-regions-listing.md](vision/user-stories-regions-listing.md) | Browse and search regions |
| [user-stories-journey-planning.md](vision/user-stories-journey-planning.md) | Trip planning and journey creation |
| [user-stories-ai-interview.md](vision/user-stories-ai-interview.md) | AI-assisted travel reflection |

## Security

| Document | Topic |
|----------|-------|
| [SECURITY.md](security/SECURITY.md) | Application security profile, OWASP ASVS target level, known gaps |
| [asvs-checklist.yaml](security/asvs-checklist.yaml) | OWASP ASVS 5.0 verification checklist (machine-readable) |

Security audits are run via Claude Code slash commands (`/security-audit`, `/security-check`, `/security-review`).
Audit reports are saved to `docs/security/audit-YYYY-MM-DD.md`.

Local security scanning:
- `npm run security:scan` — Semgrep SAST (OWASP Top 10, Node.js, React, secrets detection)
- `npm run security:deps` — npm audit for backend + frontend dependencies
- `npm run security:all` — run both scans

## Conventions

- **New feature plan?** → Create in `docs/tech/planning/`
- **Feature implemented?** → Update `docs/tech/` (add or revise), update `docs/vision/vision.md` if it changes user-facing behavior
- **Pure idea/concept?** → Add to `docs/vision/`
- **Unsorted?** → Drop in `docs/inbox/`, categorize later
- **Plan completed?** → Remove implemented sections, keep only remaining ideas/improvements

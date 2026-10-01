# Documentation

## Structure

```
docs/
├── README.md              ← this file
├── decisions/             ← Architecture Decision Records (immutable once Accepted)
├── research/              ← dated research reports an issue or ADR cites (immutable)
├── security/              ← OWASP ASVS security profile, checklist, audit reports
├── sources/               ← the register of sources looked at for filling a kind (one record each)
├── tech/                  ← technical docs of what exists
├── vision/                ← non-technical vision and user stories
│   ├── vision.md          ← root vision document (start here)
│   └── ...                ← feature-specific vision docs
└── local/                 ← gitignored: plans, drafts, session state, inbox, archive
```

Everything above `local/` is published: English, final, and describing what exists or what was
decided. § Where things live says what goes where.

## Tech — Implemented Features

| Document | Topic |
|----------|-------|
| [authentication.md](tech/authentication.md) | JWT, OAuth 2.0, access levels, token lifecycle, email verification |
| [first-run-setup.md](tech/first-run-setup.md) | First-run setup wizard, `.env` generation, admin bootstrap, optional integrations, clean-slate reset |
| [email-setup.md](tech/email-setup.md) | Email infrastructure setup (dev console, production SMTP) |
| [domain-model.md](tech/domain-model.md) | Core entities, aggregates, relationships |
| [ddd-overview.md](tech/ddd-overview.md) | Domain-Driven Design concepts used in the project |
| [experiences.md](tech/experiences.md) | Experience sources, sync, region assignment, API |
| [filling-a-kind.md](tech/filling-a-kind.md) | How a kind is filled in two tiers — what a source of each tier must provide, how a candidate is found, judged (the scorecard, the terms) and kept, the source families' verdicts, the rules tried on the canon (ADR-0048), and Wikipedia readership measured as a second world-tier door and a regional fallback's cut (ADR-0055 to ADR-0057, in draft) |
| [experience-map-ui.md](tech/experience-map-ui.md) | Map Mode + Discover Mode marker layers, hover/selection sync, multi-location behavior |
| [addresses.md](tech/addresses.md) | The URL grammar — what a link carries, ids vs slugs, push vs replace, silent degradation, where it is implemented |
| [world-views.md](tech/world-views.md) | Custom regional hierarchies, geometry computation |
| [custom-subdivision-map-tools.md](tech/custom-subdivision-map-tools.md) | Create Subregions map tab internals (`assign/split/cut`), geometry loading, pagination |
| [geometry-columns.md](tech/geometry-columns.md) | Geometry system reference — pipeline rules, columns, triggers, functions, tile cache |
| [hull-geometry.md](tech/hull-geometry.md) | Hull visualization for scattered regions, concave hull generation |
| [gadm-mapping.md](tech/gadm-mapping.md) | GADM database structure and integration |
| [STATE-MANAGEMENT.md](tech/STATE-MANAGEMENT.md) | Frontend state: React Query, localStorage, Zustand considerations |
| [rate-limiting.md](tech/rate-limiting.md) | Rate limiting tiers, per-endpoint strategy, adding limiters to new routes |
| [hacking.md](tech/hacking.md) | Practical engineering guide for local debugging and safe changes |
| [development-guide.md](tech/development-guide.md) | Code organization conventions, splitting patterns, commit hygiene |
| [gates.md](tech/gates.md) | Which gates a change asks for — the map from each gate to its inputs, how to read a run of it, how CI applies it, and what it does not reach |
| [data-assertions.md](tech/data-assertions.md) | Catalogue Checks — invariants over the live catalogue's rows, and the debt it carries |
| [performance.md](tech/performance.md) | Performance lane — what is measured, the baseline, the budgets and their ratchet rule, known breaches |
| [review-surface.md](tech/review-surface.md) | How much review a branch asks for — the baseline over merged PRs, the budget it sets and the rule for moving it |
| [shared-frontend-patterns.md](tech/shared-frontend-patterns.md) | Shared UI components and utilities — full inventory with "use this, not that" reference |
| [maplibre-patterns.md](tech/maplibre-patterns.md) | MapLibre + react-map-gl patterns and pitfalls — overlapping layers, MVT properties, feature IDs, fonts, paint priority |
| [world-view-import.md](tech/world-view-import.md) | WorldView Import — matching algorithm, API endpoints, admin UI |
| [world-view-import-format.md](tech/world-view-import-format.md) | WorldView Import JSON format specification for source-agnostic imports |

## Sources — the register

| Document | Topic |
|----------|-------|
| [sources/README.md](sources/README.md) | The source register: one record per source looked at for filling a kind — its schema, the status vocabulary, what reads it |
| [sources/museums/](sources/museums/) | Registers and lists that enumerate museums, one record each (Muséofile, Poland's state register, Italy's Luoghi della cultura, Peru's ministry directory, Museumsportal Berlin) |
| [sources/global/](sources/global/) | Sources that enumerate any kind, read per unit (Wikidata, Wikivoyage, OpenStreetMap) and the commercial ones refused on terms (Google Places, Tripadvisor) |

## Vision

| Document | Topic |
|----------|-------|
| [vision.md](vision/vision.md) | **Root vision** — project idea, user roles, design principles |
| [EXPERIENCES-OVERVIEW.md](vision/EXPERIENCES-OVERVIEW.md) | **Experiences master overview** — kinds and sources, venues & treasures, type & significance, tracking, gamification, phases (start here for experiences) |
| [QUIZ-SYSTEM.md](vision/QUIZ-SYSTEM.md) | Quiz design: card types, rounds, adaptiveness, data import |
| [CONNECTION-LEVEL-CHECKLIST.md](vision/CONNECTION-LEVEL-CHECKLIST.md) | Depth-of-connection criteria and mechanics |
| [PROPOSED-EXPERIENCE-CATEGORIES.md](vision/PROPOSED-EXPERIENCE-CATEGORIES.md) | Detailed proposals for 25+ kinds of experience with their data sources (the file keeps its older name) |
| [EXPERIENCE-TYPE-AND-SIGNIFICANCE.md](vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md) | Kinds and the closed type vocabulary a kind may have inside it (ADR-0045), and binary significance (Iconic or default) |
| [REGIONAL-PROFILE.md](vision/REGIONAL-PROFILE.md) | Region snapshot cards, "changes since your visit" |
| [LOCALS-PERSPECTIVE.md](vision/LOCALS-PERSPECTIVE.md) | User-generated local knowledge content |
| [user-stories-general.md](vision/user-stories-general.md) | Core user stories (registration, tracking, social) |
| [user-stories-regions-listing.md](vision/user-stories-regions-listing.md) | Browse and search regions |
| [user-stories-journey-planning.md](vision/user-stories-journey-planning.md) | Trip planning and journey creation |
| [user-stories-ai-interview.md](vision/user-stories-ai-interview.md) | AI-assisted travel reflection |

## Decisions

| Document | Topic |
|----------|-------|
| [README.md](decisions/README.md) | ADR index, process guide, and template |

## Research

| Document | Topic |
|----------|-------|
| [README.md](research/README.md) | What a research report is, when one is published, and how a draft becomes one |

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
- `npm run security:all` — the fast gates plus the slow scans, each one run only
  if the change touched what it reads (`docs/tech/gates.md`)

## Where things live

Each kind of information has one home
([ADR-0079](decisions/0079-each-kind-of-project-information-has-one-home.md)). This section is
the one statement of the rule; `CLAUDE.md`, the development guide and the commands point here.

| What | Home | Lifetime |
|------|------|----------|
| **Intent**: what to do, why, its priority and order | GitHub issues. The roadmap is the open milestones (each with an exit criterion), a theme is an Epic, a far-off idea is a Low Epic with no milestone | until done |
| **What exists** | `docs/tech/`, `docs/security/`, `docs/sources/` | updated with the code that changes it |
| **The product, as it is and where it is heading** | `docs/vision/` (the direction in words; each step of it is an issue) | updated with every user-facing change |
| **Decisions** | `docs/decisions/` (an ADR is a Draft inside its pull request, then Accepted) | immutable once Accepted |
| **Research a decision rests on** | `docs/research/YYYY-MM-DD-slug.md`, only when an issue or ADR cites it ([README](research/README.md)) | immutable |
| **The working plan of issue N** | `docs/local/plans/<N>-slug.md` | from the start of the work to its merge: then what was not built is filed as issues, and the plan is deleted or archived |
| **A research draft** | `docs/local/research/<topic>/` | until it is published or dropped |
| **One session's state** | `docs/local/sessions/YYYY-MM-DD.md` | the session |
| **An unsorted note** | `docs/local/inbox/` | until `/issue-upload` turns it into issues or a document |
| **Finished or stale local files** | `docs/local/archive/` | until `/docs-sweep` deletes them |
| **How an agent should work** (feedback, gotchas, references) | the agent's own memory | living; never project status |

The rules that follow from it:

- **Published means English and final.** Nothing under `docs/` outside `docs/local/` is a draft.
  A draft in any language stays in `docs/local/` until it is finished.
- **A plan has an issue number.** A plan without one does not exist: file the issue first, or it
  is session scratch.
- **No roadmap, strategy or "next session" document** sits beside the issues. Their content is a
  milestone description, an Epic, or an issue.
- **A change to what exists updates its doc in the same pull request.** A user-facing change also
  updates `docs/vision/vision.md`. A planned change touches no published doc.
- **`/docs-sweep`** lists what has drifted:
  - local plans whose issue is closed;
  - local files with no issue number;
  - stale drafts and session files;
  - memory that holds project status.

`docs/tech/planning` and `docs/inbox` are symlinks into `docs/local/` while sessions still use the
old paths.

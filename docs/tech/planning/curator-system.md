# Curator System — Remaining Plan

> **Status**: Core curation is implemented. This document tracks only unimplemented improvements and future ideas.

## What's Implemented

- **Roles & auth**: `curator` role in user_role enum, `requireCurator` middleware, `isCurator` in `useAuth()` hook
- **Curator assignments**: `curator_assignments` table with region/source/global scopes, admin CRUD endpoints, admin CuratorPanel UI
- **Rejections**: `experience_rejections` table, reject/unreject API endpoints, rejection filtering in `getExperiencesByRegion` (including `includeChildren` descendant-aware filtering), rejection exclusion from `getExperienceRegionCounts`
- **Editing**: `editExperience` API endpoint for name, short_description, category, image_url
- **Manual creation**: `createManualExperience` API, manual region assignment via `assignExperienceToRegion`
- **Curated field protection**: `curated_fields` JSONB column on `experiences` — edit endpoint adds edited field names, all 3 sync services use `CASE WHEN curated_fields ? 'field'` to skip overwriting
- **Curation log**: `experience_curation_log` table populated on all actions (reject, unreject, edit, create, add_to_region, remove_from_region) with old/new values in `details` JSONB. `GET /:id/curation-log` endpoint. Collapsible history viewer in CurationDialog with color-coded action chips, curator names, region context, relative timestamps, and formatted change details
- **Sync safety**: manual region assignments (`assignment_type = 'manual'`) preserved during re-sync and re-assignment; only `auto` assignments are cleared
- **Shared UI**: `CurationDialog` (edit + reject/unreject), `AddExperienceDialog` (search+assign / create new), and `LocationPicker` (map/search/paste/AI coordinate input) shared between Map and Discover modes
- **Map mode**: Curate button on each experience, rejected section toggle, add experience button
- **Discover mode**: Curate button on ExperienceCard and ExperienceDetailPanel, rejected items shown with dimmed styling/strikethrough, rejected count in header, rejected items excluded from map markers

---

## Remaining Improvements

### Admin Curation Activity View

The curation log is viewable per-experience in the CurationDialog. Still needed:

1. Admin view of curation activity per curator (across all experiences)
2. Filterable activity feed for admins

### "Curator Picks" Source

Implemented:

1. Dedicated `Curator Picks` source exists with display priority.
2. Manual creations are stored as source-backed records (`is_manual = true`).
3. UI can group/filter this source independently.

### "New" Badge for Recently Synced Experiences

Help curators spot newly synced items that may need review:

1. Track `synced_at` timestamp or use `created_at` comparison
2. Show a "new" badge on experiences added since the curator's last visit
3. Later reuse for regular users: prompt them to check new items in their visited regions

### Scope-Aware UI

Partially implemented:

1. Backend enforces scope in all curator mutations.
2. `GET /api/users/me` returns `curatorScopes` for curator/admin users.
3. Frontend still relies mostly on response-level signals (`is_rejected` availability) rather than fully precomputing scope per screen.

Remaining UX improvement:

1. Move all curation button visibility checks to explicit scope evaluation.

### Curator Dashboard

Personal dashboard at `/curator` or within the admin area:

- Assigned scopes overview
- Recent curation activity (from log)
- Statistics: experiences curated, rejected, added
- Pending items needing review (new items in their scopes)

### Governance Layer (Future)

For when multiple curators have overlapping scopes:

- Voting/democracy for contentious curation decisions
- Admin veto power as backstop
- Conflict resolution workflow

### Curator Application Flow (Future)

Allow users to request curator status:

- Application form with motivation and area of expertise
- Admin approval/denial workflow
- Auto-suggest users with high engagement in specific regions

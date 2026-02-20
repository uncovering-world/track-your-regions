# Region Metadata Layers — Planning Overview

> **Status**: All layers are planned. Groupings/Tags (Layer 1) is the first to implement. See `groupings.md` for the detailed plan.

This document covers four additive metadata layers on top of the existing region hierarchy. None of them change the GADM polygons, the Wikivoyage tree structure, or the core navigation model. Each layer is independent and can be built in any order.

**Source**: Distilled from `docs/inbox/REGION-HIERARCHY-AND-TEMPORAL-MODEL.md` with architectural adaptations for the existing codebase.

---

## Prerequisite: Geometry Cleanup

**Detailed plan**: [`geometry-cleanup.md`](geometry-cleanup.md)

Before building any metadata layer, the geometry system needs cleanup:
- Drop dead `display_geom` columns (unused on divisions, legacy data on regions)
- Fix `custom_geom` bug in `geometryRead.ts` (split divisions ignored in on-the-fly rendering)
- Create `region_member_effective_geom` and `region_render_geom` database views to centralize geometry resolution
- Simplify the render cascade from `hull_geom → display_geom → geom` to `hull_geom → geom`

This reduces the geometry concept count from 5 to 4 and prevents the same class of bugs from recurring when groupings adds another `custom_geom` usage.

## Priority Order

| # | Layer | Value | Complexity | Dependency |
|---|-------|-------|------------|------------|
| 0 | Geometry Cleanup | Foundation — prevents bugs | Low | None |
| 1 | Groupings/Tags | High — universal, gamification, fun | Low | Geometry Cleanup |
| 2 | Disputed Territories | Medium — values alignment, niche audience | Medium | None |
| 3 | Changes Since Your Visit | High — emotionally resonant | Medium | Connection model (partial) |
| 4 | Historical Countries | Low — charm, quiz content | Low | Quiz system (for full value) |

---

## Layer 1: Groupings / Tags

**Detailed plan**: [`groupings.md`](groupings.md)

Cross-cutting, non-hierarchical labels on regions. Balkans, Slobozhanshchina, Former Yugoslavia, the Silk Road. A region can belong to many groupings. Groupings never appear in the navigation tree — they're for reflection, search, and gamification.

Every grouping must pass one test: **"Would a traveler find it meaningful?"** Political organizations (NATO, G20, OPEC) don't belong. Travel-meaningful concepts (Balkans, Scandinavia, Galicia, Silk Road) do.

**Key decisions made**:
- No geometry on groupings — they highlight their member regions
- Dynamic contextual display — chips on the map, visibility computed from member footprint (no manual tier/zoom mapping)
- Three categories by why a traveler cares: geographic (mental map), cultural (cross-border identity), historical (past connections and routes)
- No "practical" category (Schengen, Eurozone) — those are reference facts for region profiles, not groupings to track
- Profile badges on regions, search integration, progress stats
- Curator-contributed for cultural regions, admin-maintained for geographic/historical

---

## Layer 2: Disputed Territories

**Core principle**: The platform never chooses. The user decides.

~15 territories worldwide where sovereignty is contested. The app marks them visually as disputed and lets the user decide how they count in their personal stats.

### Data Model

```sql
-- Flag on existing regions table
ALTER TABLE regions ADD COLUMN is_disputed BOOLEAN DEFAULT false;

-- User's personal choice per disputed region
CREATE TABLE user_disputed_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  parent_choice INTEGER REFERENCES regions(id), -- which parent it counts toward, NULL = no parent
  UNIQUE(user_id, region_id)
);
```

### Map Display

- Disputed regions render with hatched pattern and dashed border — always, for all users
- No "belongs to X" language anywhere in the UI
- User can mark disputed regions as visited regardless of parent assignment

### User Interaction

- When a user first visits a disputed region's profile, a non-intrusive prompt: "This territory's status is disputed. How would you like it counted in your stats?" Options: Country A / Country B / Independent / Don't count toward any country
- Choice is saved per user, changeable anytime in settings
- Default: no assignment (counts as visited but not toward any parent)

### Scope

Initial set: Crimea, Kosovo, Taiwan, Palestine, Western Sahara, Abkhazia, South Ossetia, Transnistria, Northern Cyprus, Golan Heights, Kashmir. ~11 regions, ~50 rows of data.

### What We Don't Build

- No per-country recognition matrix (too complex, too political)
- No "according to your country's laws" auto-detection (paternalistic)
- No alt_parents in the tree structure (keeps hierarchy simple)
- No Wikidata SPARQL cron for monitoring changes (manual is fine for ~2 changes/year)

---

## Layer 3: Changes Since Your Visit

**Core concept**: When a place undergoes radical transformation (war, regime change, new laws), the app acknowledges that the user's prior experience may no longer reflect current reality.

This is the *spirit* of the "Epoch Events" concept from the original doc, but grounded in observable facts rather than editorial judgment.

### Data Model

```sql
CREATE TABLE region_change_events (
  id SERIAL PRIMARY KEY,
  region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  label VARCHAR(200) NOT NULL,           -- "Start of war in Ukraine"
  description TEXT,                       -- longer explanation
  impact_level VARCHAR(20) NOT NULL,      -- 'minor', 'moderate', 'major'
  affected_aspects TEXT[],                -- {'accessibility', 'daily_life', 'cost_context', ...}
  source_url VARCHAR(500),                -- reference link
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Display Logic

Only for `major` impact events where the user's last visit predates the event:

```
Russia: visited 2017
  Note: Significant changes have occurred since 2022.
  Your experience of daily life and accessibility may differ from current reality.
```

### Editorial Policy

Only events meeting ALL criteria:
- Verifiable, documented event with a specific date
- Broadly agreed to have transformed daily life in the region
- Not politically partisan (wars and regime changes, not elections)
- Added by admin only, not curators (to prevent editorial disputes)

### Dependency

Partially depends on the Connection States model (planned). The basic "note on your visit" display works without it. The decay multipliers and "stale categories" require Connection States to be built first.

---

## Layer 4: Historical Countries

**Core concept**: A static lookup mapping regions to the countries they belonged to at different points in history. Used for badges, trivia, and quiz content.

### Data Source

CShapes 2.0 — maps international borders from 1886 to 2019. CC BY-NC-SA 4.0 license. Every region in our system has an `anchor_point` (centroid), so we can do a spatial join: for each region's centroid, find which CShapes country polygon contains it at key historical dates.

### Data Model

```sql
CREATE TABLE region_historical_countries (
  id SERIAL PRIMARY KEY,
  region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  country_name VARCHAR(200) NOT NULL,      -- "Soviet Union", "Ottoman Empire"
  country_code VARCHAR(10),                -- CShapes identifier
  valid_from INTEGER,                      -- year, NULL = ancient
  valid_to INTEGER,                        -- year, NULL = still valid
  UNIQUE(region_id, country_name, valid_from)
);
```

### Build Process

One-time Python script:
1. Load CShapes GeoJSON
2. For each region, spatial lookup at key years (1900, 1920, 1945, 1950, 1970, 1985, 1991, 2000, 2010, 2019)
3. Record only entries where the historical country differs from the current one
4. Most regions produce zero rows (country unchanged)

### Usage

- **Badge**: "Time Traveler — visited a country that no longer exists"
- **Visit context**: "You visited Tallinn in 1988. At that time it was part of the Soviet Union."
- **Quiz content**: Historical questions about regions the user has visited
- **Profile stat**: "42 existing countries + 3 historical (USSR, Yugoslavia, Czechoslovakia)"

### Dependency

Full value requires the quiz system. The badge and visit context features work standalone.

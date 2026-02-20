# Groupings / Tags — Detailed Plan

> **Status**: Planned. First layer to implement from the [Region Metadata Layers](region-metadata-layers.md) roadmap.
>
> **Prerequisite**: [Geometry Cleanup](geometry-cleanup.md) should be completed first — drops dead `display_geom` columns, creates `region_member_effective_geom` and `region_render_geom` views, and fixes the `custom_geom` bug in `geometryRead.ts`. Groupings use the same patterns and benefit from the cleaner foundation.

## What It Is

Cross-cutting, non-hierarchical labels on regions. A region can belong to many groupings simultaneously (Slovenia is both "Central Europe" and "Balkans"). Groupings are completely independent of the Wikivoyage navigation tree.

**The tree answers**: "Where is Czech Republic?" (Europe > Central Europe > Czech Republic)
**Groupings answer**: "What is Czech Republic part of?" (Central Europe, Visegrad, former Habsburg lands)

Different questions, different data structure, no conflict.

---

## Design Principle: Travel Meaning

Every grouping must pass one test: **"Would a traveler find it meaningful to know this about a place, or to track their progress through it?"**

This is a travel memory and discovery platform, not a political geography reference. NATO membership, G20 status, OPEC — these tell you nothing about what it's like to visit a place. They don't belong here.

What belongs: the names travelers actually use when thinking about trips, the cultural identities that give places depth, and the historical connections that make the world more interesting.

---

## Grouping Categories

Three categories, distinguished by **why a traveler cares** — not by political formality or zoom level.

### Geographic — How Travelers Chunk the World

The mental map travelers use when planning trips and describing where they've been. "I'm doing a Balkans trip." "I've covered most of Southeast Asia." "Next year: Central America."

These are the names people use at dinner when talking about travel. They're broadly agreed upon, though some edge cases exist (is Romania "Balkans"? is Turkey "Middle East"?).

**Data source**: Wikivoyage already uses many of these as tree nodes. Wikipedia for others.

**Maintenance**: Admin-maintained. Membership is stable.

**Note on Wikivoyage overlap**: Wikivoyage may have "Balkans" as a navigation node in the tree AND we have "Balkans" as a grouping. The tree node is for drill-down navigation (has geometry, has children). The grouping is for cross-cutting membership (a tag, no geometry, non-exclusive). They reference the same concept but serve different purposes.

### Cultural — Deeper Identity That Crosses Borders

Sub-national or cross-border cultural regions that reveal connections invisible on a political map. Understanding that Kharkiv and Belgorod share a cultural identity (Slobozhanshchina), or that western Ukraine and southeastern Poland were once Galicia — this is the kind of depth that makes travel richer.

These groupings are niche but deeply meaningful to people from those areas, and genuinely interesting to curious travelers.

**Members**: Can be countries or sub-national regions (oblasts, states, provinces). Often span country borders.

**Data source**: Wikipedia, academic sources, local knowledge.

**Maintenance**: Curators propose, admins approve. Editorially sensitive — need clear, well-documented cultural/historical basis.

**Key design choice**: No geometry on the grouping itself. Slobozhanshchina doesn't need a polygon — it highlights its member regions, which already have geometry. This avoids "where exactly does it end?" debates.

### Historical — Past Connections, Routes, Narratives

Former political entities, historical trade routes, and empire footprints that give context to how the world got to where it is. People plan trips around the Silk Road. Knowing that Tallinn, Riga, and Vilnius were all part of the USSR adds context to your Baltic trip.

These aren't active organizations — they're travel narratives and historical context.

**Data source**: Wikipedia, CShapes (for former country boundaries).

**Maintenance**: Admin-maintained. Historical facts are stable.

---

## Data Model

```sql
CREATE TYPE grouping_category AS ENUM (
  'geographic',   -- Balkans, Scandinavia, Southeast Asia
  'cultural',     -- Slobozhanshchina, Galicia, Basque Country
  'historical'    -- Silk Road, Former Yugoslavia, Hanseatic League
);

CREATE TABLE groupings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  name_local VARCHAR(200),             -- native name (e.g. "Слобожанщина")
  description TEXT,
  category grouping_category NOT NULL,
  wikipedia_url VARCHAR(500),
  created_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,             -- NULL = pending approval (cultural groupings)
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE grouping_members (
  id SERIAL PRIMARY KEY,
  grouping_id INTEGER REFERENCES groupings(id) ON DELETE CASCADE,
  division_id INTEGER REFERENCES administrative_divisions(id) ON DELETE CASCADE,
  custom_geom GEOMETRY(MultiPolygon, 4326),  -- partial coverage (e.g. Florida Keys within Monroe County)
  custom_name VARCHAR(200),                   -- display name for partial member (e.g. "Florida Keys")
  joined_date DATE,                    -- when membership began (e.g. Croatia joined EU 2013)
  left_date DATE,                      -- when membership ended (e.g. UK left EU 2020)
  notes VARCHAR(500),                  -- "sometimes included", "partial overlap"
  UNIQUE(grouping_id, division_id)
);

CREATE INDEX idx_grouping_members_division ON grouping_members(division_id);
CREATE INDEX idx_grouping_members_grouping ON grouping_members(grouping_id);
CREATE INDEX idx_groupings_category ON groupings(category);
```

The [Geometry Cleanup](geometry-cleanup.md) also creates a matching view for groupings:

```sql
CREATE VIEW grouping_member_effective_geom AS
SELECT gm.id, gm.grouping_id, gm.division_id,
       COALESCE(gm.custom_geom, ad.geom) AS geom,
       gm.custom_geom IS NOT NULL AS is_partial,
       COALESCE(gm.custom_name, ad.name) AS name,
       ad.name AS division_name
FROM grouping_members gm
JOIN administrative_divisions ad ON gm.division_id = ad.id;
```

This ensures the "which geometry to use for this member" logic lives in one place, not scattered across queries.

### Why Divisions, Not Regions

Groupings are global — they exist independently of any world view. Regions belong to world views, so referencing `region_id` would tie groupings to a specific hierarchy. Administrative divisions (GADM) are the world-view-independent foundation that everything else builds on.

This mirrors the existing `region_members` pattern: regions reference divisions (with optional `custom_geom` for partial coverage). Groupings do the same.

### Partial Membership

Most members are full divisions — "Jamaica" in the Caribbean is Jamaica's GADM country division. But some cases need partial coverage:

- **Florida Keys** in "Caribbean" — not all of Monroe County, just the Keys. Set `division_id` to Monroe County's GADM division + `custom_geom` covering the Keys + `custom_name = "Florida Keys"`.
- **Roussillon** in "Catalonia" — part of the French department of Pyrenees-Orientales. Set `division_id` + `custom_geom` for the Catalan-speaking area.

On the map, highlighting works differently for each case — see [Map Highlight Rendering](#map-highlight-rendering) below.

### Progress Tracking Via Divisions

To check if a user has "visited" a grouping member:

```sql
-- For each grouping member, check if the user has visited a region
-- that contains the same division
SELECT gm.division_id, gm.custom_name,
       EXISTS (
         SELECT 1 FROM user_visited_regions uvr
         JOIN region_members rm ON rm.region_id = uvr.region_id
         WHERE rm.division_id = gm.division_id
           AND uvr.user_id = $1
       ) AS visited
FROM grouping_members gm
WHERE gm.grouping_id = $2
  AND gm.left_date IS NULL;  -- current members only
```

For partial members (custom_geom), we keep it simple: if the user visited any region containing that division, count it as visited. A user who visited a region including Monroe County has been to the Florida Keys area — precise enough for progress bars.

### Temporal Membership

`joined_date` and `left_date` track membership changes over time. Current members have `left_date = NULL`. By default, only current members are shown. Historical membership is available as a note or toggle ("UK was a member 1973-2020").

### No Tier Field — Visibility From Geography

There's no tier or zoom-level field. Map visibility is computed dynamically from the grouping's member footprint:

1. Compute the bounding box of all member divisions
2. If the grouping's footprint is mostly visible in the viewport AND at least 2 members are showing → show the chip
3. Large groupings (spanning a continent) naturally appear at low zoom. Small groupings (2 oblasts) naturally appear at high zoom

The data does the work. No manual classification needed.

### Map Highlight Rendering

When a user activates a grouping (taps a chip or badge), we highlight its members on the map. The highlight geometry source depends on the member type:

**Full division members** (no `custom_geom`, ~95% of cases):
Look up which region in the current world view contains this division, then use that region's **render geometry** — which includes the hull for archipelagos. This ensures scattered island nations (Polynesia, Maldives) are visible, not invisible specks.

Uses the `region_render_geom` view (from [Geometry Cleanup](geometry-cleanup.md)):

```sql
SELECT rrg.render_geom
FROM region_members rm
JOIN region_render_geom rrg ON rm.region_id = rrg.id
WHERE rm.division_id = gm.division_id
  AND rrg.world_view_id = $current_world_view
LIMIT 1
```

**Partial members** (has `custom_geom`, ~5% of cases):
Use the `custom_geom` directly. These are always small, manually-drawn shapes (a piece of a county, part of an oblast) — they don't need hulls.

**Combined query**:

```sql
SELECT gm.id,
  CASE
    WHEN gm.custom_geom IS NOT NULL
      THEN gm.custom_geom
    ELSE (
      SELECT rrg.render_geom
      FROM region_members rm
      JOIN region_render_geom rrg ON rm.region_id = rrg.id
      WHERE rm.division_id = gm.division_id
        AND rrg.world_view_id = $2
      LIMIT 1
    )
  END AS highlight_geom
FROM grouping_members gm
WHERE gm.grouping_id = $1
  AND gm.left_date IS NULL;
```

**Why not just tint existing regions?** Because partial members (Florida Keys within Monroe County) would tint the entire parent region, highlighting far more than what's in the grouping. The overlay approach handles both cases correctly.

---

## API Endpoints

### Public (no auth)

```
GET /api/groupings
  ?category=geographic|cultural|historical
  ?bbox=west,south,east,north    -- only groupings with members in this viewport
  → [{ id, name, name_local, category, member_count, description }]

GET /api/groupings/:id
  → { id, name, name_local, category, description, wikipedia_url,
      members: [{ region_id, region_name, joined_date, left_date }] }

GET /api/regions/:id/groupings
  → [{ id, name, category }]  -- groupings this region belongs to
```

### Authenticated

```
GET /api/groupings/:id/progress
  → { total_members, visited_members, percentage,
      members: [{ region_id, name, visited }] }

GET /api/users/me/grouping-stats
  → [{ grouping_id, name, total, visited, percentage }]
```

### Admin / Curator

```
POST /api/groupings                          -- create (admin for geographic/historical, curator for cultural)
PUT /api/groupings/:id                       -- edit
DELETE /api/groupings/:id                    -- remove
POST /api/groupings/:id/members              -- add member region
DELETE /api/groupings/:id/members/:regionId  -- remove member
PUT /api/groupings/:id/approve               -- admin approves a cultural grouping
```

---

## Frontend: UI Components

### 1. Map Contextual Chips (Dynamic Overlays)

A compact row of chips floating on the map, showing groupings relevant to the current viewport.

```
┌─────────────────────────────────────────────┐
│  [Balkans]  [Central Europe]                │
│                                             │
│              MAP                            │
│                                             │
└─────────────────────────────────────────────┘
```

**Behavior**:
- Chips appear/disappear as the user pans and zooms
- Tap a chip → member regions highlight on the map (temporary tint/outline)
- Tap again → unhighlight
- At most ~5 chips shown; if more are relevant, "+N more" overflow

**Visibility logic**:
1. Collect all groupings that have members in the current viewport
2. Require at least 2 members visible (don't show "Balkans" because a sliver of Croatia is in frame)
3. Rank by coverage: groupings where a higher % of members are visible rank first
4. Diversity: prefer showing one from each category over three geographic ones

### 2. Region Profile Badges

On a region's detail view, show grouping memberships as tappable badges.

```
Czech Republic
┌──────────────────────────────────────────┐
│ Central Europe · Visegrad · former       │
│ Habsburg                                 │
└──────────────────────────────────────────┘
```

**Behavior**:
- Tap a badge → navigate to the grouping's progress view
- Color-coded by category (geographic = one color, cultural = another, historical = another)

### 3. Search Integration

Typing a grouping name in global search returns the grouping as a result.

```
Search: "balkan"
  ┌─────────────────────────────────────┐
  │ The Balkans (11 countries)          │
  │ Geographic · You've visited 4/11    │
  └─────────────────────────────────────┘
```

Selecting it highlights members on the map and shows a progress card.

### 4. Progress / Stats Section

A section in the user's profile showing grouping completion.

```
Your Progress
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Balkans          4/11  ████░░░░░░░░ 36%
Central Europe   6/8   █████████░░░ 75%
Southeast Asia   6/11  ██████░░░░░░ 55%
Nordic Countries 3/5   ███████░░░░░ 60%
```

**Behavior**:
- Only show groupings where the user has visited at least 1 member
- Sorted by completion % (highest first) or alphabetically (toggle)
- Tap a row → expand to show member list with visited/unvisited
- Filter by category

---

## Implementation Plan

### Phase 0 — Geometry Cleanup (prerequisite)

See [`geometry-cleanup.md`](geometry-cleanup.md). Must be completed first:
1. Generate hulls for 7 archipelagos that lack them
2. Drop `display_geom` from both tables
3. Fix `custom_geom` bug in `geometryRead.ts`
4. Create `region_member_effective_geom` and `region_render_geom` views
5. Simplify all render cascades to `hull_geom → geom`

### Phase 1 — Core Data + API

1. Schema migration: `groupings` + `grouping_members` tables + `grouping_member_effective_geom` view
2. Seed data: geographic + historical groupings (~30 total)
3. API endpoints: list, detail, region's groupings, highlight geometry
4. Admin UI: CRUD for groupings + member management (reuse existing partial-division tools for `custom_geom`)

### Phase 2 — Frontend Display

1. Region profile badges
2. Search integration
3. Progress stats section (user profile)

### Phase 3 — Map Integration

1. Contextual chips component
2. Viewport-based visibility logic (computed from member footprint)
3. Highlight overlay rendering (region render geometry for full members, custom_geom for partial members)

### Phase 4 — Cultural Groupings + Curation

1. Curator proposal workflow for cultural groupings
2. Admin approval flow
3. Seed ~10 well-known cultural regions
4. Local/native name display

---

## Seed Data

### Geographic (initial set)

| Grouping | Approx Members | Notes |
|----------|---------------|-------|
| Balkans | 11 countries | Edge case: Romania, Slovenia sometimes included |
| Scandinavia | 3 countries | Denmark, Norway, Sweden (strict definition) |
| Nordic Countries | 5 countries | Scandinavia + Finland + Iceland |
| Central Europe | 7-8 countries | |
| Baltic States | 3 countries | Estonia, Latvia, Lithuania |
| Caucasus | 3 countries | Georgia, Armenia, Azerbaijan |
| Central Asia | 5 countries | The five -stans |
| Southeast Asia | 11 countries | |
| Middle East | 15-17 countries | Edge case: Turkey, Egypt |
| Caribbean | ~15 countries | |
| Central America | 7 countries | |
| Horn of Africa | 4-5 countries | |
| Maghreb | 5 countries | |
| Levant | 4-5 countries | |
| Polynesia | ~6 countries/territories | |
| Melanesia | ~5 countries | |
| Micronesia | ~5 countries/territories | |
| Southern Cone | 4-5 countries | Argentina, Chile, Uruguay, Paraguay, (S. Brazil) |
| East Africa | ~10 countries | |
| West Africa | ~15 countries | |
| Southern Africa | ~10 countries | |
| Indochina | 5 countries | Mainland Southeast Asia |
| Greater Antilles | 4 countries | Cuba, Jamaica, Hispaniola, Puerto Rico |

### Historical (initial set)

| Grouping | Members | Notes |
|----------|---------|-------|
| Former Yugoslavia | 7 countries | Serbia, Croatia, Bosnia, Slovenia, Montenegro, North Macedonia, Kosovo |
| Former USSR | 15 countries | |
| Former Czechoslovakia | 2 countries | Czech Republic, Slovakia |
| The Silk Road | ~10 countries | Historical trade route corridor |
| Hanseatic League | ~15 cities/regions | Historical trading network, mostly N. Europe |
| Al-Andalus | Parts of Spain + Portugal | Moorish Iberia |
| Former Ottoman Empire | ~20 countries | Balkans + Middle East + N. Africa |
| Former British Empire | ~50+ countries | Large but travel-meaningful (shared English, institutions) |
| Former Habsburg Empire | ~13 countries | Central European cultural thread |
| Mesopotamia | Iraq + parts of Syria, Turkey | Cradle of civilization |

### Cultural (initial proposals, require curation)

| Grouping | Members | Notes |
|----------|---------|-------|
| Slobozhanshchina | Kharkiv + Belgorod oblasts | Ukrainian-Russian cultural region |
| Galicia | W. Ukraine + SE Poland | Historical region |
| Bukovina | N. Romania + W. Ukraine | Historical region |
| Transylvania | Central Romania | Historical/cultural |
| Kurdistan | Parts of Turkey, Iraq, Iran, Syria | Ethnocultural region |
| Patagonia | S. Argentina + S. Chile | Geographic/cultural |
| Basque Country | N. Spain + SW France | Ethnocultural |
| Tyrol | Austria + N. Italy | Historical |
| Karelia | Finland + Russia | Historical |
| Lapland / Sapmi | Norway + Sweden + Finland | Indigenous cultural region |
| Catalonia | NE Spain + S. France (Roussillon) | Cultural region beyond the autonomous community |
| Kashmir | India + Pakistan | Cultural/geographic |

---

## Completionist Groupings — Open Question

Some groupings exist primarily for progress tracking rather than cultural/geographic meaning:

- **EU** — "I've visited every EU country" is a thing travelers say. But EU is a political institution, not a travel concept. Include it?
- **UN member states** — the ultimate country-counting list (193). Meaningful for the hardcore completionist niche.

**Current decision**: Defer. If user demand emerges, these can be added later as a "completionist" category. They don't fit the travel-meaning principle but serve a real (if niche) user need.

---

## Open Questions

1. **Membership disputes**: Is Romania in the Balkans? Is Turkey in the Middle East? Decision: include contentious members with a `notes` field ("sometimes included"). Reflect real-world ambiguity rather than forcing a binary.

2. **Overseas territories**: French Guiana is geographically in South America but politically part of France/EU. Decision: include — this is exactly the kind of interesting fact the app should surface.

3. **Historical membership display**: When showing "Former Yugoslavia" progress, do we include Kosovo (disputed statehood)? Decision: yes, with notes. The grouping reflects historical fact, not current political stance.

4. **Grouping creation permissions**: Can regular users propose cultural groupings? Decision: not in Phase 1. Curators propose, admins approve. User proposals as a social feature later.

5. **World view scoping**: Are groupings global or per-world-view? Decision: global. Groupings exist independently of which world view the user is navigating.

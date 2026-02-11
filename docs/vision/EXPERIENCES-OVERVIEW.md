# EXPERIENCES OVERVIEW

Everything users can discover, learn, track, and do within regions — from UNESCO sites to local food to quiz-based memory games. This is the master reference for the experience system.

---

## What Is an Experience?

An **experience** is anything a user can engage with in connection with a region. It's the atomic unit of engagement — the thing that turns a colored shape on a map into a place with meaning.

The defining property: an experience is **trackable**. You can mark it as done, visited, read, watched, tried, learned — some form of "I engaged with this." If something is purely informational and can't be checked off, it belongs in context layers (see [`REGIONAL-PROFILE.md`](REGIONAL-PROFILE.md), [`LOCALS-PERSPECTIVE.md`](LOCALS-PERSPECTIVE.md)), not experiences.

---

## Core Concepts

### Categories

Experiences are organized into **categories** — the user-facing grouping. Each category has its own natural tracking verb, data sources, and UI needs. Categories are the real structure of the system — all other concepts (type, significance, treasures) exist within them.

Examples of categories: UNESCO Sites (visited), Museums (visited), Books (read), Films (watched), Regional Food (tried), Languages (learned), Festivals (attended), Hiking Trails (walked), Wildlife (observed).

Some categories are **location-bound** (museums — you go there), some are **not** (books — read anywhere), some are **mixed** (food — authentic in the region, but you can cook at home). Some are **time-dependent** (festivals, seasonal wildlife). Seasonality is an availability property of the experience, not a separate kind of experience.

Data sources are an implementation detail — a single category can be populated from multiple sources (a Books category might combine Wikidata, OpenLibrary, and curator input). What users see is the category.

### Locations

An experience's relationship with physical locations varies:

| Relationship | What it means | Examples |
|-------------|--------------|---------|
| **No location** | Region-associated but not place-bound | Books, films, languages, music |
| **Single location** | One physical point on the map | A museum, a monument, a viewpoint |
| **Multiple locations** | Several distinct sites, each independently trackable | UNESCO serial nominations (e.g., "Forts of Rajasthan" with 6 forts) |

### Type & Significance

Every experience is classified along two orthogonal axes, following the pattern UNESCO already uses (Cultural/Natural/Mixed + significance assessment).

**Type** — a closed enum describing *what kind of thing* something is. Type applies at two independent levels:

- **Experience (venue) type** — per category. Museums have museum types (art, history, science, nature...), festivals have festival types (music, religious, seasonal...). Used for UI filtering: tap "Art" in the Museums category to get art museums
- **Treasure type** — what kind of treasure is inside a venue (artworks, species, etc.). Independent of the venue type — a cathedral and an art museum can both hold artworks

These are separate enums. A venue's type describes the venue; a treasure's type describes the treasure. See [`EXPERIENCE-TYPE-AND-SIGNIFICANCE.md`](EXPERIENCE-TYPE-AND-SIGNIFICANCE.md) for the full model.

**Significance** — a binary flag: an experience is either **Iconic** (world-class, a global reference point in its category) or it isn't. Iconic drives must-see lists, badge display, and the highlights system. Everything without an Iconic badge is still valuable — it's just not globally famous.

Iconic is computed from automated signals (Wikipedia language count, visitor numbers, UNESCO connection, iconic collection treasures) with curator override. The threshold is deliberately high: only experiences that are unambiguously world-class. More granularity (national, regional tiers) can be added later if the data supports meaningful distinctions.

### Venues, Treasures, and Highlights

Some experiences act as **venues** — they hold independently trackable **treasures** inside them. A museum contains artworks. A zoo contains species. A cathedral contains notable features.

Treasures exist independently of their venues. The relationship is **many-to-many**: the Mona Lisa is in the Louvre (one venue), but a Giant Panda can be found in 20 zoos, and Rodin's The Thinker has casts in Paris, Tokyo, and Philadelphia. "Where can I see a panda?" is a valid query across venues.

Treasure types and venue types are **independent enums** — they are not 1:1. A single treasure type can appear in many venue types, and a venue type can hold multiple treasure types:

| Treasure type | Examples | Found in venue types |
|---------------|---------|----------------------|
| Artworks | Paintings, sculptures, artifacts, architectural features | Museums, galleries, cathedrals, palaces, public spaces |
| Species | Animals, plants | National parks, zoos, aquariums, wild reserves |

More treasure types will be defined as new categories are built. These are orthogonal to venue types — the same Rodin sculpture is an artwork whether it's in a museum, a park, or a cathedral. Most venues hold one treasure type in practice, but the model doesn't enforce this — a venue with both artworks and species is structurally valid.

Both experiences and treasures can have **tags** — cross-cutting properties that enable curated browsable lists across categories, venues, and regions:

| Tag | Level | What it enables |
|-----|-------|-----------------|
| Endemic | Experience | "What can I only experience here?" — food, traditions, languages found exclusively in this region |
| Lazarus | Treasure (species) | "Lazarus species and where to find them" — animals rediscovered after presumed extinction, browsable across venues worldwide |
| Endemic | Treasure (species) | "Species you can only see here" — animals and plants found exclusively in this region |

Tags are not types — a Lazarus species is still a species, an endemic dish is still a food experience. Tags enable cross-cutting queries that work across categories and regions. More tags will emerge as new categories are built.

**Highlights** are a globally curated top tier of treasures per type — e.g., "Top 100 Artworks." This is a single global list, not per-region. Treasures appear in two browsing contexts:

- **Inside a venue** — viewing a museum shows all its treasures; treasures on the global highlights list get a badge
- **By region** — "Top artworks you can see in Paris" shows only the highlights located in that region's venues. Not "top artworks in Paris" — "which of the world's top artworks are in Paris"

The system collects broader treasure data than what qualifies as highlights (e.g., ~1000 artworks across 100 museums). This serves two purposes: computing venue significance (a museum with famous artworks ranks higher) and providing the pool from which the global highlights list is curated.

### Terminology

| Term | Meaning |
|------|---------|
| **Experience** | Anything a user can engage with in connection with a region — must be trackable |
| **Category** | The user-facing grouping: museums, books, films, food, languages, etc. |
| **Treasure** | An independently trackable thing inside a venue (artwork, species, artifact). Many-to-many with venues |
| **Venue** | An experience that holds treasures (museum, zoo, national park) |
| **Highlight** | A treasure on a globally curated top list (e.g., Top 100 Artworks). Badged inside venues, browsable by region |
| **Type** | Classification enum at two levels: venue type (art museum, science museum...) and treasure type (artworks, species...). Independent enums |
| **Tag** | Cross-cutting property on experiences or treasures enabling curated lists (endemic, Lazarus). Not a type — orthogonal |
| **Significance** | Binary: Iconic (world-class) or default. For treasures, Iconic = highlight |
| **Connection state** | User's relationship depth with a region. Visit-based states first; Aware state added with quiz system |

---

## What's Live Today

Three experience categories are implemented, each populated from external data sources and assigned to regions automatically:

| Category | Count | Types | Significance | Current data sources |
|----------|-------|-------|--------------|---------------------|
| UNESCO World Heritage Sites | ~1,250 | cultural, natural, mixed | — | UNESCO API, Wikidata (enrichment) |
| Museums | ~100 | art | iconic | Wikidata SPARQL |
| Public Art & Monuments | ~200 | sculpture, monument | — | Wikidata SPARQL |

Category-level typing is already live (cultural/natural/mixed for UNESCO, monument/sculpture for landmarks). Museums are the first category to implement the Type & Significance model: the current sync fetches only art museums marked as iconic.

**Numbers**: 466 multi-location experiences with 6,519 individual locations (mostly UNESCO serial nominations). ~1000 treasures (artworks) across 100 museums, currently used for significance computation — the global highlights list and region-scoped highlight browsing are planned.

**Browsing**: two complementary views:
- **Map mode** — select a region, see experiences grouped by category below. Hover a marker for a preview card
- **Discover mode** — tree-based navigation with breadcrumbs, map + card list side by side, slide-in detail panel

**Curation**: curators reject bad assignments, edit metadata, add missing treasures, and create new experiences with AI-assisted lookup. See [`experiences.md`](../tech/experiences.md) for implementation details.

---

## Future Categories

Beyond the current three, the platform can grow to cover many more dimensions of a region:

**Culture & Arts** — Books, Films, Music, Intangible Heritage, Architecture, Specific Artworks, Street Art & Murals

**Food & Drink** — Regional Food, Regional Drinks, Food Experiences (cooking classes, tastings, market tours)

**Nature & Outdoors** — Wildlife (with seasonality), Hiking Trails & Walks, Beaches & Swimming Spots, Viewpoints & Panoramas, Seasonal Phenomena

**People & History** — Famous Locals' Places (birthplaces, studios, graves — visitable), Cemeteries. Note: Notable People and Historical Events as pure knowledge are context layer material; they become experiences when they manifest as trackable places

**Daily Life** — Markets, Neighborhoods & Districts, Iconic Transport, Languages. Note: Cost Context is informational — belongs in Regional Profile (context layer)

**Niche** — Coins, Lazarus Species, Observatories & Planetariums, Regional Sports & Games

**Entertainment** — Entertainment Venues, Festivals & Events

**Hospitality** — Historic Hotels & Restaurants, Universities & Libraries

See [`PROPOSED-EXPERIENCE-CATEGORIES.md`](PROPOSED-EXPERIENCE-CATEGORIES.md) for detailed proposals with data sources and gamification ideas per category.

---

## How Users Interact

### Tracking

Users mark experiences, their individual locations, and treasures as engaged — each level tracked independently. The system shows per-region completion counts ("12 of 47 experiences visited in Italy"), per-category progress, and a personal travel map colored by visited regions.

Currently binary (engaged / not engaged). The connection state system (below) will add nuance.

### Connection States (Long-Term)

Experience engagement is one signal feeding into **connection states** — the user's depth of relationship with a region. Connection state is a region-level concept broader than experiences alone: it also considers checklist input (physical presence, language, interaction with locals, daily life) and eventually quiz performance.

The first implementation will derive connection state from visit-based signals — experience tracking, checklist items that require physical presence, and visit history. This supports the visit-based states: Stranger, Passed Through, Explored, Deep Connection.

The **Aware** state (knowledgeable but never visited) requires the quiz system to detect — you can't distinguish "knows about Florence" from "never heard of Florence" through experience tracking alone. Aware will be added when the quiz system is built.

See [`CONNECTION-LEVEL-CHECKLIST.md`](CONNECTION-LEVEL-CHECKLIST.md) for the full criteria framework, and [`QUIZ-SYSTEM.md`](QUIZ-SYSTEM.md) for how the quiz will eventually enable the Aware state.

---

## Onboarding & Data Input (Long-Term)

Instead of tedious data entry, a quiz system will let users reconstruct their travel history through play — inferring which regions they've visited and which experiences they've engaged with. The quiz is one of several input methods for experience tracking; it also serves broader purposes (connection state evaluation, entertainment) covered in [`QUIZ-SYSTEM.md`](QUIZ-SYSTEM.md).

Supplementary import methods: smart manual input (tap regions on a map), Google Takeout (Location History JSON), and photo GPS extraction. What we explicitly avoid: browser extensions, email parsing, always-on location tracking.

---

## Curation

Curators are the quality layer — local experts or subject-matter specialists who keep content accurate and relevant. They can reject bad assignments, edit metadata, add missing treasures, create new experiences, and remove permanently wrong entries.

The system trusts curators: no approval queue, no drafts. Actions are logged for accountability, and curator edits are protected from being overwritten by automated syncs. Curation is scoped — a curator might be responsible for a specific region, a specific category, or have global access.

See [`curator-system.md`](../tech/planning/curator-system.md) for what's implemented and remaining improvements.

---

## Gamification

Engagement mechanics unified by a single philosophy: **progress over competition, depth over breadth**.

- **Per-region progress** — "23 of 47 experiences confirmed in Italy." Progress bars per region, per category. Motivates exploration within a place, not just checking off countries
- **Cross-category achievements** — "Visited a region with population under 100K", "Collected all Eurozone coins", "Saw a Lazarus species in the wild"
- **Connection map** — a personal world map colored by connection state. Vivid where memories are fresh, muted where they're fading
- **Curator recognition** — most active per region, quality metrics, path from contributor to curator
- **"Changes since visit" loop** — the Regional Profile's delta tracking is itself gamification — a reason to come back and check on "your" regions
- **Refresh streaks** — maintaining connection levels through periodic "Refresh Your Memory" mini-rounds. Not guilt — honest, gentle

---

## Beyond Tracking (Long-Term)

- **Journey planning** — curated lists of places to visit, shareable with friends. "Read more" links instead of "want to visit" buttons: curiosity without obligation
- **AI-assisted reflection** — guided conversation to articulate what made a trip meaningful. See [`user-stories-ai-interview.md`](user-stories-ai-interview.md)
- **Social features** — follow users, privacy controls, notifications, monthly digest emails

---

## Implementation Phases

A rough ordering based on dependencies and user value.

| Phase | What | Status |
|-------|------|--------|
| **1. Core Experiences** | Three categories (UNESCO, museums, public art), sync, region assignment, browsing, tracking, treasure data collection, curation | Done |
| **2. Classification** | Type & significance model, museum type expansion, automated significance computation, enhanced curation | Partially done |
| **3. New Categories** | Books, films, food, festivals, notable people, wildlife, tags (endemic, Lazarus) | Planned |
| **4. Connection States** | Visit-based states (Stranger → Deep Connection), checklists, decay mechanics, visual map representation | Planned |
| **5. Quiz System** | Card types, rounds, adaptiveness, content pipeline. Enables the Aware connection state | Planned |
| **6. Social & Gamification** | Follow users, journey planning, achievements, connection map, refresh streaks | Planned |

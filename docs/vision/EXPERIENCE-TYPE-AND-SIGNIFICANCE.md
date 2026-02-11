# EXPERIENCE TYPE & SIGNIFICANCE MODEL

How experiences and treasures are classified by **what kind of thing they are** and **how significant they are**. Two orthogonal axes applied consistently across the experience system.

---

## Why This Exists

The experience system has 30+ categories (Museums, Food, Wildlife, Films, etc.). Within many of these categories, experiences vary not only by topic but by **kind of experience** and by **significance level**. A natural history museum and a contemporary art gallery are both "museums" but offer fundamentally different experiences. The Louvre and a small town gallery are both art museums but carry different weight.

We need a lightweight, consistent way to express both dimensions without creating an unmanageable tag soup.

Parallel: UNESCO World Heritage already uses this pattern — every site is typed as Cultural, Natural, or Mixed, and separately assessed for significance. We adopt the same principle.

---

## Axis 1: Type

A **single required field** on every experience. Type describes *what kind of experience this is* within its category. Type also applies independently to treasures inside venues — see [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md) for the two-level type model.

### Key rules

- Type is a **closed enum per category**. Museums have museum types, festivals have festival types. No shared mega-enum.
- Every experience gets **exactly one primary type**. If it genuinely spans two, a secondary type field is allowed (max one).
- Types are designed for **UI filtering** — a user should be able to tap "History" in the Museums category and get a meaningful subset.

### Museum types (reference enum)

| Code | Label | What the visitor gets |
|---|---|---|
| `art` | Art | Paintings, sculpture, photography, design, decorative arts |
| `history` | History & Society | National/city/regional history, social change, everyday life, migration |
| `archaeology` | Archaeology | Ancient civilizations, excavations, material evidence of the past |
| `science` | Science & Technology | Engineering, transport, space, medicine, computing, industrial heritage |
| `ethnography` | Ethnography & Anthropology | Cultures, traditions, crafts, costume, religious practices in cultural context |
| `memorial` | Memorial & Personal | House-museums, memorials, museums of specific people or events |
| `religion` | Religion & Sacred Heritage | Religious art, monastic collections, sacred material culture |
| `nature` | Natural History | Geology, paleontology, biodiversity, ecology, museum centers at national parks |
| `niche` | Specialized & Niche | Single-topic: food, music, cinema, sport, fashion, money, toys, espionage, etc. |

Notes:
- Sensitive context: `ethnography` experiences should carry metadata about collection provenance and exhibition framing where available.
- `niche` is a catch-all to keep the top level clean. In the future, if a niche grows large enough (e.g. 50+ music museums globally), it can be promoted to its own type.

### Other category type enums (to be defined per category)

Each experience category will define its own type enum as it is implemented. Examples of what these might look like:

- **Festivals**: `music`, `film`, `religious`, `seasonal`, `food_drink`, `arts`, `carnival`, `sporting`
- **Wildlife**: `mammal`, `bird`, `marine`, `reptile`, `insect`, `plant`
- **Food**: `dish`, `drink`, `ingredient`, `protected_product` (GI)

These are illustrative — final enums are defined when each category is built.

---

## Axis 2: Significance

A **boolean flag** on every experience: either **Iconic** (world-class) or not. Used for badge display, must-see lists, and the highlights system.

### The two tiers

| Code | Label | Meaning |
|---|---|---|
| `iconic` | Iconic | World-class. A global reference point in its category. |
| *(default)* | — | Everything else. Still valuable, just not globally iconic. |

The threshold for Iconic is deliberately high — only experiences that are unambiguously world-class qualify. This keeps the badge meaningful and the must-see lists focused.

More granularity (national, regional tiers) can be added later if the data supports meaningful distinctions. For now, the binary split avoids the problem of fuzzy boundaries between "national" and "regional" significance.

### When Iconic is clear

- **Art museums**: Louvre, Met, Hermitage, British Museum — obvious global icons
- **Monuments**: Statue of Liberty, Christ the Redeemer, Taj Mahal
- **Hiking trails**: Camino de Santiago, Appalachian Trail, Inca Trail
- **Food**: Pizza, sushi, croissant as globally recognized culinary icons

### When Iconic is less relevant

- **Memorial / personal museums**: significance is driven by the person or event, not scale
- **Niche museums**: "key for the topic" may matter more than global fame
- **Local food**: regional specialties are valuable precisely because they're not global

---

## Computing Significance: Automated Signals

Significance should not be purely manual. The system can derive a suggested significance from available signals, with curator override.

### Signal sources

| Signal | Source | What it indicates |
|---|---|---|
| Wikipedia language count | Wikidata `sitelinks` | International recognition (Louvre: 90+ languages, local museum: 3–5) |
| Annual visitors | Published statistics, Wikidata | Scale and draw |
| UNESCO connection | Wikidata `heritage designation` | Site is or is on a World Heritage property |
| Flagship treasures | Wikidata entities with own articles linking to museum | Collection contains globally known works |
| Presence in "must-see" lists | Web sources, travel guides | Editorial consensus on importance |

### Suggested thresholds for Iconic

3+ strong signals. Typically: 50+ Wikipedia languages, 1M+ annual visitors, UNESCO connection or iconic collection treasures.

Everything else is default. Curators can manually promote experiences to Iconic or demote them.

These thresholds are starting points — they will be calibrated as data is populated.

---

## UI Implications

### Type → Filter

Type is the primary filter mechanism in category views. When a user opens "Museums" for a region, they can filter by type:

```
[All] [Art] [History] [Science] [Nature] ...
```

### Significance → Badge

Iconic experiences get a prominent badge on their card. Default experiences get no badge.

Significance drives "Must-see" curated lists:

> "Iconic museums in Italy" → filter by `significance = iconic` + `region = Italy`

### Combined

Type and significance work together:

> "You're visiting Florence. Here are the iconic art museums and some other art museums worth your time."

---

## Data Model

### Minimum fields for any experience

```
name: string
category: string              # "museums", "food", "festivals", etc.
type_primary: enum             # from the category-specific type enum
type_secondary: enum | null    # same enum, max one, optional
significance: enum | null      # iconic | null (default)
region_id: string              # link to region in geographic model
short_reason: string           # 1–2 sentences: why visit / why it matters
```

### Extended fields (optional, category-dependent)

```
format: enum                   # museum, gallery, house_museum, memorial, open_air, science_center
experience_style: enum         # encyclopedic, specialized, hands_on, kids_friendly
visit_context: enum            # on_site, industrial_site, heritage_site
access: enum                   # free_entry, ticket_required, reservation_recommended
time_to_visit_minutes: int
highlights: string[]           # 3–7 key things to see/do
audience: string[]             # who will appreciate this most
```

Note: `format`, `experience_style`, `visit_context`, and `access` are all **closed enums** — no free-form tags. This keeps the system predictable and filterable.

---

## Relationship to Other Systems

- **Connection Level Checklist**: "Visited museums" is a checklist item. Visiting an Iconic museum is a stronger signal than a default one for connection scoring.
- **Quiz System**: Museum type informs question generation — art museums get visual/sensory questions, history museums get factual/contextual ones.
- **Experience Categories**: Type and significance are fields *within* an experience category, not a parallel system. Museums is a category; `art` is a type within it.
- **Locals' Perspective**: Local insights about museums ("skip the main hall, start from room 12") are linked to specific treasures, not to types.

---

## Cold Start & Population Strategy

| Type | Automated sourcing | Manual curation needed |
|---|---|---|
| `art`, `history`, `science`, `nature` | Good coverage via Wikidata (museum type properties, collection data) | Minimal — mainly significance validation |
| `archaeology` | Moderate — Wikidata has major sites, gaps in smaller ones | Some curation for regional experiences |
| `ethnography`, `religion` | Moderate — Wikidata coverage varies by region | Sensitivity review recommended |
| `memorial` | Good for major memorials, patchy for personal museums | House-museums often need manual entry |
| `niche` | Low — highly heterogeneous | Highest manual effort, but also lowest volume |

Priority: identify and badge Iconic experiences first (highest user value, most automatable). Default experiences are populated alongside — they just don't get the badge.

---

## Summary

Two axes, both simple:

- **Type** = closed enum per category, always assigned, used for filtering
- **Significance** = binary flag (Iconic or default), used for badges and must-see lists. Extensible to more tiers later if needed

No free-form tags. No unbounded taxonomies. The system stays predictable as it scales from 100 to 100,000 experiences.

---

## Future Idea: Tags

Both experiences and treasures can carry **tags** — cross-cutting properties orthogonal to type and significance. Tags enable curated browsable lists that cut across categories, venues, and regions. See the Tags section in [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md) for examples (endemic, Lazarus).

The **endemic** tag is the first candidate: some experiences can only be authentically had in a specific region — a valley cheese made nowhere else, lemurs in Madagascar, La Tomatina in Buñol. A dish can be Iconic + endemic (Neapolitan pizza) or default + endemic (obscure local cheese). Most useful for food, wildlife, traditions, festivals, languages — less useful for inherently location-bound categories (museums, monuments) where everything is trivially "only here."

More tags will emerge as new categories are built. Worth exploring when food, wildlife, and tradition categories arrive.

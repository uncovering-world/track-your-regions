# EXPERIENCE TYPE & STATUS MODEL

How experience items are classified by **what kind of thing they are** and **how significant they are**. Two orthogonal axes applied consistently across the experience system.

---

## Why This Exists

The experience system has 30+ categories (Museums, Food, Wildlife, Films, etc.). Within many of these categories, items vary not only by topic but by **kind of experience** and by **significance level**. A natural history museum and a contemporary art gallery are both "museums" but offer fundamentally different experiences. The Louvre and a small town gallery are both art museums but carry different weight.

We need a lightweight, consistent way to express both dimensions without creating an unmanageable tag soup.

Parallel: UNESCO World Heritage already uses this pattern — every site is typed as Cultural, Natural, or Mixed, and separately assessed for significance. We adopt the same principle.

---

## Axis 1: Type

A **single required field** on every experience item. Type describes *what kind of experience this is* within its category.

### Key rules

- Type is a **closed enum per category**. Museums have museum types, festivals have festival types. No shared mega-enum.
- Every item gets **exactly one primary type**. If it genuinely spans two, a secondary type field is allowed (max one).
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
- Sensitive context: `ethnography` items should carry metadata about collection provenance and exhibition framing where available.
- `niche` is a catch-all to keep the top level clean. In the future, if a niche grows large enough (e.g. 50+ music museums globally), it can be promoted to its own type.

### Other category type enums (to be defined per category)

Each experience category will define its own type enum as it is implemented. Examples of what these might look like:

- **Festivals**: `music`, `film`, `religious`, `seasonal`, `food_drink`, `arts`, `carnival`, `sporting`
- **Wildlife**: `mammal`, `bird`, `marine`, `reptile`, `insect`, `plant`
- **Food**: `dish`, `drink`, `ingredient`, `protected_product` (GI)

These are illustrative — final enums are defined when each category is built.

---

## Axis 2: Status

A **separate optional field** indicating how significant an item is. Used for ranking, badge display, and "must-see" curation.

### Status levels

| Code | Label | Meaning |
|---|---|---|
| `top` | TOP | World-class. A global reference point in its type. |
| `national` | National | Important at the national level. A pillar for the country. |
| `regional` | Regional | Important for a specific region or city. |
| `local` | Local | Locally meaningful. No claim to broader significance, but valuable in context. |

Default: items without an explicit status are treated as `local`.

Can be simplified to three levels (`top`, `regional`, `local`) if less granularity is needed.

### When status is especially useful

- **Art museums**: clear global hierarchy (Louvre, Met, Hermitage) plus strong regional schools.
- **History museums**: helps separate "canonical national overview" from "local context."
- **Science museums**: regional museums are often important because of a specific industry or institution.
- **Ethnography**: helps users understand where to go for "broad survey" vs. "deep local immersion."

### When status may be omitted

- **Memorial / personal museums**: significance is driven by the person or event, not scale.
- **Niche museums**: "key for the topic" may matter more than geographic tier.

---

## Computing Status: Automated Signals

Status should not be purely manual. The system can derive a suggested status from available signals, with curator override.

### Signal sources

| Signal | Source | What it indicates |
|---|---|---|
| Wikipedia language count | Wikidata `sitelinks` | International recognition (Louvre: 90+ languages, local museum: 3–5) |
| Annual visitors | Published statistics, Wikidata | Scale and draw |
| UNESCO connection | Wikidata `heritage designation` | Site is or is on a World Heritage property |
| Flagship items | Wikidata items with own articles linking to museum | Collection contains globally known works |
| Presence in "must-see" lists | Web sources, travel guides | Editorial consensus on importance |

### Suggested thresholds

- **TOP**: 3+ strong signals. Typically: 50+ Wikipedia languages, 1M+ annual visitors, UNESCO connection or iconic collection items.
- **National**: 1–2 strong signals, or the museum is clearly the primary institution for its type in the country.
- **Regional**: Known beyond immediate locality but not nationally dominant. Often the main museum in a major city.
- **Local**: Default. Can be manually promoted by curators.

These thresholds are starting points — they will be calibrated as data is populated.

---

## UI Implications

### Type → Filter

Type is the primary filter mechanism in category views. When a user opens "Museums" for a region, they can filter by type:

```
[All] [Art] [History] [Science] [Nature] ...
```

### Status → Badge

Status is displayed as a visual badge on the item card:

- `top` → prominent badge (e.g. ⭐ or "World-class")
- `national` → subtle badge (e.g. flag icon or "National")
- `regional` / `local` → no badge, or minimal indicator

Status also drives "Must-see" curated lists:

> "Top museums in Italy" → filter by `status = top` + `region = Italy`

### Combined

Type and status work together for smart recommendations:

> "You're visiting Florence. Here are the essential art museums [status: top/national] and some hidden gems [status: local] worth your time."

---

## Data Model

### Minimum fields for any experience item

```
name: string
category: string              # "museums", "food", "festivals", etc.
type_primary: enum             # from the category-specific type enum
type_secondary: enum | null    # same enum, max one, optional
status: enum | null            # top / national / regional / local
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

- **Connection Level Checklist**: "Visited museums" is a checklist item. Museum status can weight how much a visit contributes to connection score (visiting a TOP museum = stronger signal than a local one).
- **Quiz System**: Museum type informs question generation — art museums get visual/sensory questions, history museums get factual/contextual ones.
- **Experience Categories**: Type and status are fields *within* an experience category, not a parallel system. Museums is a category; `art` is a type within it.
- **Locals' Perspective**: Local insights about museums ("skip the main hall, start from room 12") are linked to specific items, not to types.

---

## Cold Start & Population Strategy

| Type | Automated sourcing | Manual curation needed |
|---|---|---|
| `art`, `history`, `science`, `nature` | Good coverage via Wikidata (museum type properties, collection data) | Minimal — mainly status validation |
| `archaeology` | Moderate — Wikidata has major sites, gaps in smaller ones | Some curation for regional items |
| `ethnography`, `religion` | Moderate — Wikidata coverage varies by region | Sensitivity review recommended |
| `memorial` | Good for major memorials, patchy for personal museums | House-museums often need manual entry |
| `niche` | Low — highly heterogeneous | Highest manual effort, but also lowest volume |

Priority: populate TOP and National status items first (highest user value, most automatable), then expand to Regional and Local through community contributions.

---

## Summary

Two axes, both simple:

- **Type** = closed enum per category, always assigned, used for filtering
- **Status** = optional 4-level badge, used for ranking and curation

No free-form tags. No unbounded taxonomies. The system stays predictable as it scales from 100 to 100,000 items.

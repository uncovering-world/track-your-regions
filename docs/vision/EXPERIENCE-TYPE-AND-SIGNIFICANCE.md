# EXPERIENCE TYPE & SIGNIFICANCE MODEL

How experiences and treasures are classified by **what kind of thing they are** and **how significant they are**. Two orthogonal axes applied consistently across the experience system.

The words this document uses are the ones [ADR-0045](../decisions/0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) decided and the glossary in [`experiences.md`](../tech/experiences.md#glossary) maps onto the code:

| Word | Meaning |
|---|---|
| **Kind** | What a traveller browses by — what they would call the thing in front of them: a World Heritage site, an art museum, an archaeology museum, a monument. Each kind is its own list, pin colour and count |
| **Source** | A list we read to fill a kind — the UNESCO API, a Wikidata query. Not something a visitor sees |
| **Type** | A distinction *inside* a kind whose members a traveller still browses together — cultural, natural or mixed for a World Heritage site; monument or sculpture for public art. A kind whose members a traveller would want as separate lists has no types: they are kinds |
| **Treasure type** | What kind of thing a treasure inside a venue is — an artwork, a species. Independent of the venue's kind and type |

---

## Why This Exists

The experience system will hold dozens of kinds (art museums, archaeology museums, food, wildlife, films, etc.). Within some kinds, experiences vary by **type** — a cultural World Heritage site and a natural one — and within every kind by **significance level**: the Louvre and a small-town gallery are both art museums but carry different weight.

We need a lightweight, consistent way to express both dimensions without creating an unmanageable tag soup — and without turning distinctions a traveller browses separately into filters inside one list. A natural history museum and a contemporary art gallery are both "museums" to a dictionary; to a person who wants one and not the other they are two kinds, which is why they are two lists rather than two types of one.

Parallel: UNESCO World Heritage already uses this pattern — every site is typed as Cultural, Natural, or Mixed, and separately assessed for significance. We adopt the same principle, for the kinds where it applies.

---

## Axis 1: Type

A type is a distinction *inside* a kind whose members a traveller still browses together. It is a **closed vocabulary per kind** — no shared mega-enum — and where a kind has one, every object of that kind carries one value from it. Type also applies independently to treasures inside venues — see [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md) for the two-level type model.

### Key rules

- **A kind decides whether it has types at all.** The test is the traveller's: would a person who wants one of these still want to see the others in the same list? A cultural and a natural World Heritage site, yes — one list, a chip and a filter. An art museum and an archaeology museum, no — two lists, so two kinds and no type ([ADR-0045](../decisions/0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) decision 1). "Museums" is not one kind with a type chip.
- Where a kind has types, the vocabulary is **closed and its own**. Types are designed for **filtering inside the kind** — tap "Natural" in World Heritage and get the natural sites — and for the chip on the card.
- One value per object. A kind without types stores none.

### The vocabularies that exist today

| Kind | Types | Notes |
|---|---|---|
| World Heritage sites | `cultural`, `natural`, `mixed` | UNESCO's own classification, carried through from the source |
| Public art & monuments | `monument`, `sculpture` | Which of the source's two lists the object came from |
| Art museums | *none* | An art museum is a kind, not a type within "Museums" — the literal `art` every museum row once carried said nothing the kind does not (#814) |

### Kinds of museum

What an earlier version of this document listed as museum *types* are museum **kinds**: each is a list of its own to a traveller who collects one of them, with its own sync, its own rule of completeness, its own pin colour and count. The labels are kept because they are the right names for the lists:

| Kind | What the visitor gets | Status |
|---|---|---|
| Art museums | Paintings, sculpture, photography, design, decorative arts | Live — filled by the works-first source (ADR-0023); a second source that asks nothing about famous works is #628 |
| Archaeology museums | Ancient civilizations, excavations, material evidence of the past | Planned — #581 imports archaeology and history museums as kinds of their own, starting from the rows the art test expelled (the British Museum, egyptology, natural-history and military museums) |
| History museums | National/city/regional history, social change, everyday life, migration | Planned (#581, with archaeology) |
| Science & technology museums | Engineering, transport, space, medicine, computing, industrial heritage | Proposed |
| Ethnography museums | Cultures, traditions, crafts, costume, religious practices in cultural context | Proposed — should carry metadata about collection provenance and exhibition framing where available |
| Memorial & personal museums | House-museums, memorials, museums of specific people or events | Proposed |
| Religion & sacred heritage | Religious art, monastic collections, sacred material culture | Proposed |
| Natural history museums | Geology, paleontology, biodiversity, ecology, museum centres at national parks | Proposed — the natural-history museums the art test expelled sit in #581's seed rows; whether they become a kind of their own is decided there |
| Specialized & niche museums | Single-topic: food, music, cinema, sport, fashion, money, toys, espionage, etc. | Proposed — a catch-all to keep the list of kinds short; a niche that grows large enough (50+ music museums worldwide) becomes a kind of its own |

A kind appears to readers only once it has a sync of its own and a rule that says what complete means for it (ADR-0045 decision 2): a list of thirty-seven churches worldwide with none in Prague is a claim about the world, and a false one.

### Vocabularies for kinds not yet built

Each kind decides, when it is built, whether a distinction is a type inside it or a kind beside it — by the traveller's test above. Illustrative vocabularies for distinctions that would probably stay types:

- **Festivals**: `music`, `film`, `religious`, `seasonal`, `food_drink`, `arts`, `carnival`, `sporting`
- **Wildlife**: `mammal`, `bird`, `marine`, `reptile`, `insect`, `plant`
- **Food**: `dish`, `drink`, `ingredient`, `protected_product` (GI)

These are illustrative — final vocabularies are defined when each kind is built, and any of them may turn out to be kinds instead.

---

## Axis 2: Significance

A **boolean flag** on every experience: either **Iconic** (world-class) or not. Used for badge display, must-see lists, and the highlights system.

### The two tiers

| Code | Label | Meaning |
|---|---|---|
| `iconic` | Iconic | World-class. A global reference point in its kind. |
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

### Kind → List; Type → Filter

Kinds are siblings: art museums, archaeology museums and World Heritage sites are three lists, three pin colours and three counts, and a traveller chooses between them the way they choose between a museum and a cathedral. A type filters *inside* one of those lists, where the kind has types:

```text
World Heritage sites   [All] [Cultural] [Natural] [Mixed]
Public art & monuments [All] [Monument] [Sculpture]
Art museums            (no type filter — an art museum is the whole list)
```

### Significance → Badge

Iconic experiences get a prominent badge on their card. Default experiences get no badge.

Significance drives "Must-see" curated lists:

> "Iconic museums in Italy" → filter by `significance = iconic` + `region = Italy`

### Combined

Kind and significance work together:

> "You're visiting Florence. Here are the iconic art museums and some other art museums worth your time."

---

## Data Model

### Minimum fields for any experience

```text
name: string
kind: reference                # what a traveller browses by; today the source row (category_id)
type: enum | null              # from the kind's own vocabulary; null for a kind without types
significance: enum | null      # iconic | null (default)
region_id: string              # link to region in geographic model
short_reason: string           # 1–2 sentences: why visit / why it matters
```

One type per object. A secondary type is not part of the model: a distinction worth a second value is a sign the kind's list is two kinds.

### Extended fields (optional, kind-dependent)

```text
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
- **Quiz System**: The kind informs question generation — art museums get visual/sensory questions, history museums get factual/contextual ones.
- **Kinds and sources**: Type and significance are fields *within* a kind, not a parallel system. Art museums is a kind; cultural is a type within the World Heritage kind; a source (the works-first selection, the UNESCO list) is how a kind is filled and is never what a reader browses by.
- **Locals' Perspective**: Local insights about museums ("skip the main hall, start from room 12") are linked to specific treasures, not to kinds.

---

## Cold Start & Population Strategy

| Kind | Automated sourcing | Manual curation needed |
|---|---|---|
| Art, history, science, natural-history museums | Good coverage via Wikidata (museum type properties, collection data) | Minimal — mainly significance validation |
| Archaeology museums | Moderate — Wikidata has major sites, gaps in smaller ones | Some curation for regional experiences |
| Ethnography, religion | Moderate — Wikidata coverage varies by region | Sensitivity review recommended |
| Memorial & personal | Good for major memorials, patchy for personal museums | House-museums often need manual entry |
| Niche | Low — highly heterogeneous | Highest manual effort, but also lowest volume |

Priority: identify and badge Iconic experiences first (highest user value, most automatable). Default experiences are populated alongside — they just don't get the badge.

---

## Summary

Two axes, both simple:

- **Type** = a closed vocabulary per kind, for the kinds whose members a traveller still browses together; null for a kind without one. Used for filtering inside the kind
- **Significance** = binary flag (Iconic or default), used for badges and must-see lists. Extensible to more tiers later if needed

And one rule above both: a distinction a traveller wants as a separate list is a **kind**, never a type.

No free-form tags. No unbounded taxonomies. The system stays predictable as it scales from 100 to 100,000 experiences.

---

## Future Idea: Tags

Both experiences and treasures can carry **tags** — cross-cutting properties orthogonal to kind, type and significance. Tags enable curated browsable lists that cut across kinds, venues, and regions. See the Tags section in [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md) for examples (endemic, Lazarus).

The **endemic** tag is the first candidate: some experiences can only be authentically had in a specific region — a valley cheese made nowhere else, lemurs in Madagascar, La Tomatina in Buñol. A dish can be Iconic + endemic (Neapolitan pizza) or default + endemic (obscure local cheese). Most useful for food, wildlife, traditions, festivals, languages — less useful for inherently location-bound kinds (museums, monuments) where everything is trivially "only here."

More tags will emerge as new kinds are built. Worth exploring when food, wildlife, and tradition kinds arrive.

# World View Levels & Perspectives — Design

**Status**: Approved design (umbrella vision), not yet implemented.
**Decided**: 2026-06-14, brainstorming session.
**Scope**: A rethink of how the app models and edits geographic hierarchies
("world views"). Introduces three explicit working levels, an orthogonal
political-perspective axis, reusable sub-national templates, a layered
import pipeline, and a level-aware editing shell.
**Relationship to in-flight work**: This is the umbrella target the
[import-review workflow redesign](import-review-workflow-redesign.md)
evolves toward. Import-review ships **as-is** (it is phase 0); nothing
here reverses it. See *Relationship to import-review* below.

---

## Problem

Today there is one undifferentiated recursive `regions` tree per world
view, and one monolithic Wikivoyage import that pulls an entire
hierarchy at once. Three needs are not served by that shape:

1. **Three working levels are real but implicit.** Work on a hierarchy
   naturally splits into a *supra-national* level (Eastern Europe,
   continents — itself hierarchical), a *country* level (the pivot), and
   a *sub-national* level (how a country divides internally — itself
   hierarchical). Each level wants a *different editing approach*. The
   import-review redesign already stumbled into this (its
   skeleton / work-unit / country-subtree zones), but only as an internal
   artifact of one workflow, not as a first-class concept.

2. **"What is a country" is political and variable.** The set of
   countries and the borders between them depend on a point of view
   (Crimea, Kosovo, Taiwan, Western Sahara, Abkhazia, Kashmir…). The
   current model can only express this by duplicating whole hierarchies.

3. **The monolithic import is out of step with a pivot-centric model.**
   Pulling the entire tree at once couples levels and sources that should
   be independent, and makes matching the whole tree to GADM the hardest
   possible step.

## Core model — three entities, two axes

```
        AXIS 2 · POLITICAL PERSPECTIVE (POV)        ── orthogonal overlay ──►
        de facto (default) · UN · UA · RU · RS · CN · IN · …
        describes ONLY disputed units: appear / disappear / re-attach + alt-geometry
                              ▲ applies to disputed units at any level ▲
   ┌──────────────────────────────────────────────────────────────────┐
   │  AXIS 1 · WORLD VIEW = thematic hierarchy  (the three levels live here)
   │    L1 supra-national   Eastern Europe, continents, cultural macro-regions
   │    L2 country          ← pivot / anchor; the set varies by perspective
   │    L3 sub-national      federal districts, provinces (GADM L1/L2…)
   └──────────────────────────────────────────────────────────────────┘
                              ▲ references stable atomic units ▲
        BASE · GADM administrative_divisions  (shared foundation)
```

- **GADM** — stable atomic units; the shared foundation everything
  references. GADM ships its **own** political stance; we treat the base
  as the **de-facto** default (Natural Earth's convention: show who
  controls the ground, treat alternatives as overlays), reconcile GADM's
  specific choices to it, and express perspectives as deltas from this
  base.
- **World view** (axis 1) — a thematic hierarchy: how we carve and group
  the world for a purpose (Wikivoyage travel regions, "my trip",
  geographic regions). The **three levels are altitude within one world
  view**, not a separate axis.
- **Perspective / POV** (axis 2) — a political stance. Orthogonal,
  app-global, touches only disputed units.

Composition: **(world view) × (perspective) → a resolved tree of regions
over GADM.**

> **Terminology note.** This project already uses "world view" for a
> thematic hierarchy. The map industry uses "worldview" for the political
> stance. To avoid the clash, this design calls the political axis a
> **perspective** (a.k.a. POV); "world view" keeps its existing meaning.

## Decisions (from brainstorming Q&A)

| Question | Decision | Why |
|----------|----------|-----|
| Where does political stance live? | **Orthogonal perspective axis**, not a property of each world view. | Baking a stance into each world view duplicates whole hierarchies per stance and does not scale to dozens of POVs. Matches Mapbox `worldview` / Natural Earth POV. |
| Scope of perspectives? | **Global**, app-wide, tied to GADM disputed units, **de-facto default**. | One source of truth for "Crimea/Kosovo/Taiwan"; reuses the [groupings](groupings.md) philosophy (global, division-tied). |
| Hierarchy structure? | **Hybrid**: one spanning typed tree (navigation + geometry) **+** cross-cutting groupings at L1 **+** the country as a first-class pivot. | Evolves what already exists or is planned (the `regions` tree + groupings + import-review work units) rather than a greenfield rebuild. A tree alone cannot express overlap (Slovenia ∈ Central Europe *and* Balkans). |
| Sub-national reuse? | **Per-world-view by default + reusable subdivision templates** (instantiate = copy; edits local). | DRY where wanted without shared-mutable coupling. Templates also express *alternate subdivision schemes* (Russia as 85 subjects vs 8 federal districts). |
| Editing interface? | **Shared shell + level switcher**; "level" (altitude) ≠ "stage" (phase). | Each level feels like a distinct approach without losing drill-down and a shared map/tree. Generalizes import-review's `StageSwitcher` from *stage* to *altitude*. |
| Relationship to import-review? | **Import-review = phase 0**, finish and merge as-is; this doc is the umbrella target it evolves toward. | No throwaway. The per-country work-unit + sign-off machinery already built *is* the future L3 ingestion loop — forward-compatible. |
| Import architecture? | **Layered ingestion around the country pivot** (seed L2 → build L1 schemes → import L3 per country); a later phase. | The importer catches up to the pivot-centric model. An authoritative country canon de-risks the whole POV axis; per-level matching is smaller and more reliable than matching a monolith. |

## The three levels

The country pivot is a first-class node role; it partitions the spanning
tree into three zones, each with its own editing approach.

### L1 — supra-national
Continents, sub-regional groupings ("Balkans"), cultural macro-regions.
May itself be hierarchical. **Membership can overlap** (Slovenia is in
Central Europe *and* the Balkans), which a strict tree cannot express —
so L1 is served by **both** the spanning tree (for the primary
navigation backbone) **and** cross-cutting [groupings](groupings.md) (for
overlapping, non-exclusive membership). Editing approach: arrange
countries into groups, manage groupings, restructure containers.

### L2 — country (the pivot)
The anchor. Everything above groups countries; everything below
subdivides them. **The set of countries is perspective-dependent.** This
is the new geopolitical control surface: which entities count as
countries under a given perspective, and how disputed territories are
adjudicated. Formalizes import-review's `is_work_unit` into a proper node
role. Editing approach: pick a perspective, curate the country canon,
adjudicate disputed features.

### L3 — sub-national
How a country divides internally (GADM L1/L2…, federal districts,
provinces). May itself be hierarchical, and supports **alternate
subdivision schemes** via templates. Editing approach: the per-country
workspace already built for import-review (assign GADM divisions,
build/instantiate templates, verify coverage, sign off).

## Perspective (POV) axis — the mechanic

The "politics-politics" requirement. Pattern drawn from Mapbox
`worldview`, Natural Earth POV variants, and Who's On First alt-geometries.

**One base, tagged disputes, selectable variant:**

- A global **perspectives** registry: `de_facto` (default), `un`, `ua`,
  `ru`, `rs`, `cn`, `in`, … Each is a named POV.
- A global **disputed-features** registry, tied to GADM divisions: each
  feature names a contested unit/territory ("Crimea", "Kosovo",
  "Taiwan", "Western Sahara", "Abkhazia") as a set of GADM divisions.
- A **ruling** per (disputed feature × perspective):
  - *attachment* — which country it belongs to (Crimea → UA under most
    POVs; → RU under `ru`);
  - *existence* — whether it counts as a country at L2 (Kosovo is a
    country under most POVs; folds into Serbia under `rs`/`ru`);
  - *alt-geometry* — the border variant for the disputed area (Kashmir
    extents differ by POV). **Advanced; deferred** — see phasing.

**Authoring and resolution.** Authors edit **one** tree, against the
de-facto base. Disputed nodes are *marked* (they reference a disputed
feature). When a non-default perspective is selected, a **resolver**
re-parents / hides / swaps **only the marked nodes** per the rulings; the
non-disputed structure is shared across all perspectives. There are no
hand-maintained parallel trees.

**Defaulting.** De facto is the default. A user-facing perspective may be
defaulted by locale (as Mapbox/Google do) and overridden by the user.
Curation of the registry and rulings is admin-only and editorially
documented (like the `cultural` category in groupings).

**Why not per-stance datasets.** Forking the dataset per politics
duplicates everything and goes stale independently. Tagging + resolving
keeps a single base and localizes the politics — the industry consensus.

## Structure — hybrid tree + groupings + pivot

- **Spanning tree** (`regions` via `parent_region_id`, today's model)
  carries navigation and geometry. Each node gains a **role/level**:
  `supra` | `country` | `sub`. This formalizes import-review's
  `is_work_unit`.
- **Groupings** (from [groupings.md](groupings.md), global, division-tied)
  carry the overlapping, non-exclusive L1 memberships the tree cannot.
- **Country pivot** is the boundary that makes the three editing
  approaches possible: above it → grouping/arrangement tools; on it →
  perspective / country-set tools; below it → subdivision tools.

## Sub-national reuse — subdivision templates

A **subdivision template** is a named, reusable L3 subtree over GADM
("Russia: federal districts"). Templates are **instantiated (copied)**
into a country node in any world view; the instance's geometry is its own
(as today), and edits to it are local. This delivers DRY where it is
wanted without the coupling and propagation cost of shared-mutable
subtrees, and it is the mechanism for *alternate subdivision schemes*
(several templates for the same country, chosen per world view). Reuse is
on the world-view axis (granularity/purpose), **not** the POV axis.

## Editing interface — shared shell + level switcher

One shell: persistent map + tree + breadcrumbs. The header carries a
**level switcher** (L1 / L2 / L3) that recomposes the side panel and map
styling; drilling into a country raises the level automatically.

- **L1 supra-national** — world map + grouping chips; drag countries into
  groups; manage overlapping groupings; restructure containers.
- **L2 country / POV** — perspective switch; which entities are countries
  under it; adjudicate disputed features. (New surface.)
- **L3 sub-national** — the import-review country workspace: assign GADM,
  build/instantiate templates, verify, sign off.

**Level ≠ stage.** "Level" is altitude (L1/L2/L3). "Stage" is the work
phase *within* a country (Hierarchy / Assign / Verify — already built in
import-review). Stages nest inside the L3 level. The existing
`StageSwitcher` generalizes: an outer level switcher, an inner stage
switcher.

## Import — layered ingestion around the country pivot

Replaces the monolithic whole-tree import with a layered pipeline that
mirrors the model. **Later phase** (see phasing); does not change phase 0.

```
NOW (monolith):
  Wikivoyage → whole tree (continents→countries→regions) at once → match all to GADM

LAYERED (around the pivot):
  1) L2 country canon  ← authoritative source (GADM-0 / ISO 3166 / UN M49)   [ANCHOR]
  2) L1 groupings      ← independent, swappable: UN M49 geoscheme / Wikivoyage continents / cultural
  3) L3 per country    ← incremental, source-pluggable: GADM children / Wikivoyage regions / custom
  (everything stitches on the country pivot = references to GADM divisions)
```

- **Seed L2 from an authoritative source, not Wikivoyage.** The country
  list is the politically sensitive layer the entire POV axis hangs off;
  derive it from GADM-0 / ISO 3166 / UN M49 and let perspectives adjust
  it via rulings. Wikivoyage is a travel source, not a sovereignty
  authority.
- **L1 is independent, swappable grouping imports** referencing the
  seeded canon (a world view can adopt UN M49, Wikivoyage's continents,
  or cultural schemes).
- **L3 is per-country and incremental.** This *is* the per-country
  work-unit loop already built for import-review — the same machinery,
  reused as the L3 ingestion step.
- **Matching gets simpler, not harder.** L2 seeds from GADM directly
  (trivial); L1 matches country names against a ready canon; L3 matches
  children within one country. Each step is smaller and more reliable
  than matching the whole monolith.
- **Extraction vs ingestion.** The change is mostly in *ingestion /
  matching strategy* (layered, against the canon), not in source
  *extraction* (Wikivoyage can still produce its tree as an artifact that
  is then ingested level-by-level).

This evolves **[ADR-0005](../../decisions/0005-source-agnostic-world-view-import.md)**
(import as "one JSON tree from a source") → a new ADR for layered
ingestion around the pivot.

## Relationship to import-review (A + C)

Import-review is **phase 0** and ships unchanged. This design is the
umbrella it evolves toward. Reuse / generalize / replace map:

| Import-review today | In this model |
|---------------------|----------------|
| Country workspace | **L3 editor** — reused almost as-is |
| Skeleton view | seed of **L1 / L2** — generalized |
| `StageSwitcher` (stages) | generalized into a **level switcher** (stages nest inside L3) |
| `is_work_unit` | **country pivot** (node role) |
| Whole-tree Wikivoyage import | **layered ingestion** (later phase) |
| — | new: perspectives + disputed-features + rulings + resolver; L1 groupings; level-aware shell; subdivision templates; authoritative L2 seed |

No work is thrown away: the per-country work-unit + sign-off machinery is
forward-compatible as the L3 ingestion loop.

## Data model (design sketch)

Illustrative — exact DDL belongs in the per-phase implementation plans.

- **`regions`** — add a node **role/level** (`supra` | `country` | `sub`),
  formalizing `is_work_unit`. Optional pointer marking a node as
  *governed by* a disputed feature (POV-sensitive).
- **`groupings` / `grouping_members`** — as designed in
  [groupings.md](groupings.md) (global, division-tied). Reused unchanged.
- **`perspectives`** — registry of POVs (`code`, `name`, `is_default`).
- **`disputed_features`** — contested units, each as a set of GADM
  divisions (+ description, recognition notes à la Wikidata).
- **`perspective_rulings`** — (disputed feature × perspective) →
  attachment / existence / optional alt-geometry.
- **`subdivision_templates`** — named reusable L3 subtrees over GADM,
  instantiated (copied) into a world view's country node.

Resolution (world view × perspective → tree) is a read-time transform
over the marked nodes; the de-facto base is the stored tree.

## Phasing (YAGNI)

- **Phase 0** — finish and merge import-review as-is (= L3 editor +
  backend foundation). No pivot.
- **Phase 1** — level-aware shell + level switcher; L1 groupings
  ([groupings.md](groupings.md)); formalize the `country` node role.
- **Phase 2** — perspective axis: `perspectives` + `disputed_features` +
  `perspective_rulings` + resolver + L2 editor. Attachment/existence
  rulings (no alt-geometry yet).
- **Phase 3** — subdivision templates; layered import (authoritative L2
  seed → L1 schemes → L3 per country); alt-geometry border variants;
  user-facing perspective selection + perspective-aware "countries
  visited" counting.

### Out of scope (for now)
- Alt-geometry disputed borders as a first step (attachment/existence
  first; geometry variants later).
- Shared-mutable subdivision modules (templates copy instead).
- Multi-operator collaboration; re-import with preservation of edits.
- Changing GADM, the CV pipeline internals, or Wikivoyage extraction.

## ADRs implied
To be written at implementation time (this doc is the umbrella, not the ADR):
- **Perspective/POV as an orthogonal, global overlay** (de-facto default;
  tagged disputes + rulings + resolver). References ADR-0002 (GADM).
- **Layered import around the country pivot**, superseding/extending
  [ADR-0005](../../decisions/0005-source-agnostic-world-view-import.md).
- **Three-level node roles** formalizing the country pivot
  (`is_work_unit`).

## User-facing impact
Per the docs workflow, [vision.md](../../vision/vision.md) must reflect:
- Users can choose a **perspective** (or get a locale default) that
  changes the country set, disputed placements, and disputed borders.
- "Countries visited" / completion counts become perspective-aware
  (whether Kosovo / Taiwan count depends on the chosen POV).
- Admins gain three distinct level-aware editing surfaces.

## Prior art (research)
- **Mapbox Boundaries `worldview`** — features tagged `all` or a stance
  code (`US`/`CN`/`IN`/`JP`); disputed polygons flagged `dispute=true`.
- **Natural Earth** — de-facto by default; de-jure claims as overlays;
  POV variants → "246–258 countries depending who's counting".
- **Who's On First** — multiple divergent hierarchies per place;
  alt-geometries (a ground-truth + variants); supersedes/superseded_by.
- **UN M49 geoscheme** — canonical supra-national hierarchy (World →
  macro-region → sub-region → country); codes "resistant to geopolitical
  conflicts". Seed/spine for L1.
- **Wikidata** — recognition qualifiers (recognized-by / not-recognized-by)
  instead of a forced binary.

## References
- [docs/tech/world-views.md](../world-views.md) — current model
- [docs/tech/planning/groupings.md](groupings.md) — cross-cutting tags
- [docs/tech/planning/import-review-workflow-redesign.md](import-review-workflow-redesign.md) — phase 0
- [docs/tech/world-view-import-format.md](../world-view-import-format.md) — current import format
- [ADR-0002](../../decisions/0002-use-gadm-for-administrative-boundaries.md), [ADR-0005](../../decisions/0005-source-agnostic-world-view-import.md)

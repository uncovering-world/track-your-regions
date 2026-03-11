# Country-Aware Depth Control During Wikivoyage Extraction

**Date**: 2026-03-01
**Status**: Implemented

## Problem

The Wikivoyage extraction pipeline recurses up to `maxDepth=10` purely based on whether a page has a "Regions" section. This treats Liechtenstein the same as Russia — if the page has sub-regions, it dives in. The result is ~41 single-child nodes and unnecessarily deep hierarchies for small countries.

The depth decision should be informed by country size:
- Countries must always be extracted (minimum depth)
- Sub-regions within a country should be limited based on the country's area
- Only large countries warrant deep subdivision (sub-regions of sub-regions)

## Design

### AI-First Entity Classification

For each non-leaf node during tree building, before recursing into children, classify the entity via a lightweight AI call:

- **Country** (e.g., France, Palau) → apply area-based depth limit
- **Grouping** (e.g., Eastern Europe, Polynesia) → recurse freely to find countries
- **Sub-country region** (e.g., Bavaria) → within parent country's depth budget

This approach was chosen over GADM name lookup because GADM level-1 entries mix countries with sub-continental groupings (Melanesia, Micronesia, Polynesia appear alongside actual countries). AI classification handles this cleanly.

### Depth Tiers

| Country area | Max depth below country | Examples |
|---|---|---|
| ≤ 5K km² | 0 (leaf) | Monaco, Malta, Singapore, Andorra |
| 5K – 300K km² | 1 (regions) | Belgium, Portugal, Japan, UK, Italy |
| 300K – 1M km² | 2 (regions + sub-regions) | Germany, France, Turkey, Spain |
| ≥ 1M km² | 3 levels | USA, Russia, China, Brazil, India, Australia |

### AI Classification Prompt

Model: configurable via `getModelForFeature('extraction')` (GPT-4o-mini by default).

```
Classify this geographic entity: "{title}"
Context: it appears in a travel guide hierarchy under "{parentName}".

Respond with JSON:
{
  "type": "country" | "grouping" | "sub_country",
  "area_km2": <number or null>,
  "confidence": "high" | "medium" | "low"
}

- "country": sovereign country or self-governing territory (e.g., France, Puerto Rico, Hong Kong)
- "grouping": geographic/cultural grouping of multiple countries (e.g., Eastern Europe, Polynesia, Southeast Asia)
- "sub_country": administrative region within a country (e.g., Bavaria, California, Provence)

For countries/territories, provide approximate area in km².
```

Parent context helps disambiguation: "Georgia" under "Asia" → country. "Georgia" under "United States" → sub_country.

Cost: ~350 calls × ~200 tokens × $0.15/1M (GPT-4o-mini) ≈ $0.01 total.

### Integration into buildTree

New parameter: `countryContext?: { name: string; area: number; maxSubDepth: number; currentSubDepth: number }`

Flow when a page has sub-regions (before recursing into children):

1. If `countryContext` exists → we're inside a country already.
   - If `currentSubDepth >= maxSubDepth` → make leaf, stop recursing.
   - Otherwise, pass `countryContext` with `currentSubDepth + 1` to children.

2. If no `countryContext` → AI classify this page title.
   - If "country" with area X → compute `maxSubDepth` from tiers. If 0, make leaf. Otherwise set context, recurse children with `currentSubDepth=0`.
   - If "grouping" → recurse children with no `countryContext`.
   - If "sub_country" (missed parent) → treat as grouping, recurse freely.

This check runs AFTER parsing the Regions section but BEFORE the AI interviewer for ambiguous regions. Depth limits are enforced before we ask AI about splitting.

### Classification Cache

Cached in the Wikivoyage API cache file (same `FileCache`). Key: `{"action":"classify","title":"France","parent":"Europe"}`. Re-extractions reuse classifications with zero AI calls. No new DB tables needed.

### Error Handling

- **AI unavailable** (no OpenAI key): fall back to current behavior (recurse with `maxDepth=10`). Log warning.
- **AI call fails** (timeout/error): treat as "grouping" (recurse freely). Log error. Safe default.
- **Low confidence**: apply classification anyway, log to decision summary for admin visibility.

### Decision Logging

Each classification logged to `progress.decisions` with `decidedBy: 'country_depth'`. Admin sees in the extraction decision summary why a node was made a leaf or had its depth limited.

### JSON Import Path

Unchanged. Pre-built hierarchies from other sources are imported as-is. Depth control only applies during Wikivoyage extraction (`buildTree`).

## Implementation

| File | What |
|---|---|
| `aiClassifier.ts` | `classifyEntity()` + `computeMaxSubDepth()` + `ClassificationCache` type |
| `treeBuilder.ts` | `countryContext` + `classificationCache` params, depth enforcement before page fetch, classification before child loop |
| `types.ts` | `CountryContext` interface, `'country_depth'` decision maker |
| `decisionSummary.ts` | Label + display for `country_depth` decisions |
| `index.ts` | Shared `ClassificationCache` across continent extractions |

## Future Extensions

The AI classification prompt is designed as an extension point. Future versions can feed additional context into the decision:

- **Experience density**: if a territory has many experiences (UNESCO sites, museums), AI can suggest deeper splitting
- **Tourism data**: popular destinations might warrant finer granularity regardless of area
- **GADM match quality**: once extraction+matching are interleaved (separate future project), match confidence can inform depth decisions
- **Population density**: densely populated areas may need more subdivision than sparsely populated ones of the same size

The structured prompt approach makes adding these signals straightforward — just append more context to the classification request.

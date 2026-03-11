# Extraction Decision Logging

**Date**: 2026-02-28
**Status**: Approved

## Problem

The Wikivoyage extraction pipeline has 5 layers of auto-resolution that suppress questions before they reach the admin. After rules refactoring, almost nothing gets through — the admin has no visibility into what decisions are being made automatically.

## Design

### Data Model

Add `DecisionEntry` type and `decisions` array to `ExtractionProgress`:

```typescript
type DecisionMaker =
  | 'city_districts'    // hardcoded Parent/District shortcut
  | 'dead_end_filter'   // dropped dead-ends, resolved ambiguity
  | 'plain_text_linked' // all plain-text had real pages
  | 'ai_empty'          // AI returned empty regions
  | 'ai_confident'      // AI extracted regions, no questions
  | 'coverage_gate'     // <50% coverage hard gate
  | 'interview_auto'    // interview auto-resolved by learned rule
  | 'admin_answer'      // admin answered the question
  | 'no_ai'             // no AI available, parser output used as-is

interface DecisionEntry {
  page: string;
  decision: 'leaf' | 'split' | 'drop_children';
  decidedBy: DecisionMaker;
  detail: string;
}
```

### Instrumentation Points

| Layer | File:Line | Trigger |
|-------|-----------|---------|
| City districts | treeBuilder.ts ~197 | `hasDistrictSubpages` true |
| Dead-end filter | treeBuilder.ts ~226-234 | Dead-end removal sets `needsAI = false` |
| Plain-text linked | treeBuilder.ts ~245-253 | All plain-text entries have pages |
| AI empty | treeBuilder.ts ~263-271 | AI returns empty regions |
| AI confident | treeBuilder.ts ~263-271 | AI returns regions with no questions |
| Coverage gate | treeBuilder.ts ~290-294 | Coverage <50% clears regions |
| Interview auto | treeBuilder.ts ~385-392 | `formulateQuestion` returns `auto_resolved` |
| Admin answer | controller answer handler | Admin resolves a question |

### Console Summary

Printed at end of Phase 1 (after `buildTree` loop, before Phase 1.5 wait). Grouped by `decidedBy` with counts and page names (truncated at 10).

Coverage gate entries include actual stats (e.g., "2/8 = 25%") so the admin can judge threshold appropriateness.

### Scope

- `types.ts` — add types, add `decisions` to `ExtractionProgress`
- `treeBuilder.ts` — push entries at each decision point
- `index.ts` — print summary after Phase 1, log interview auto-resolutions
- No new files, no frontend changes, no API changes

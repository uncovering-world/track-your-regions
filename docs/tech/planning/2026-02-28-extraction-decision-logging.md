# Extraction Decision Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a decision accumulator to the Wikivoyage extraction pipeline that tracks which layer made each split/leaf decision, and print a grouped summary to the console at the end of Phase 1.

**Architecture:** A `DecisionEntry[]` array on `ExtractionProgress` accumulates structured entries as pages are processed. Each of the 5 decision layers pushes an entry when it makes a decision. After Phase 1 completes, a summary function groups entries by `decidedBy` and prints them.

**Tech Stack:** TypeScript, Vitest for tests

---

### Task 1: Add DecisionEntry type and decisions array to ExtractionProgress

**Files:**
- Modify: `backend/src/services/wikivoyageExtract/types.ts`

**Step 1: Write the failing test**

Add a test in `backend/src/services/wikivoyageExtract/__tests__/treeBuilder.test.ts` that checks `createInitialExtractionProgress()` returns a `decisions` array:

```typescript
describe('decision logging', () => {
  it('createInitialExtractionProgress includes empty decisions array', () => {
    const progress = createInitialExtractionProgress();
    expect(progress.decisions).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/wikivoyageExtract/__tests__/treeBuilder.test.ts --reporter=verbose`
Expected: FAIL — `progress.decisions` is undefined

**Step 3: Add the types and initialize decisions**

In `backend/src/services/wikivoyageExtract/types.ts`:

1. Add the `DecisionMaker` type and `DecisionEntry` interface before `ExtractionProgress`:

```typescript
/** Who made an extraction decision (for decision logging summary) */
export type DecisionMaker =
  | 'city_districts'    // hardcoded Parent/District shortcut
  | 'dead_end_filter'   // dropped dead-ends resolved ambiguity
  | 'plain_text_linked' // all plain-text entries had real pages
  | 'ai_empty'          // AI returned empty regions
  | 'ai_confident'      // AI extracted regions with no questions
  | 'coverage_gate'     // <50% coverage hard gate cleared regions
  | 'interview_auto'    // interview auto-resolved by learned rule
  | 'admin_answer'      // admin answered the question
  | 'no_ai';            // AI unavailable, used parser output as-is

/** A logged extraction decision for the Phase 1 summary */
export interface DecisionEntry {
  page: string;
  decision: 'leaf' | 'split' | 'drop_children';
  decidedBy: DecisionMaker;
  detail: string;
}
```

2. Add `decisions: DecisionEntry[]` to the `ExtractionProgress` interface (after the `nextQuestionId` field):

```typescript
  /** Decision log for Phase 1 summary */
  decisions: DecisionEntry[];
```

3. Add `decisions: []` to `createInitialExtractionProgress()` return value.

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/wikivoyageExtract/__tests__/treeBuilder.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```
feat: add DecisionEntry type and decisions array to ExtractionProgress
```

---

### Task 2: Instrument treeBuilder decision points

**Files:**
- Modify: `backend/src/services/wikivoyageExtract/treeBuilder.ts`

**Step 1: Write the failing test**

Add to `backend/src/services/wikivoyageExtract/__tests__/treeBuilder.test.ts`:

```typescript
describe('decision logging', () => {
  // ... existing test from Task 1 ...

  it('logs city_districts decision when page has district subpages', async () => {
    // Page "CityX" has regions with "CityX/District" subpage format
    const responses: Record<string, Record<string, unknown>> = {
      [key({ action: 'parse', page: 'CityX', prop: 'sections', redirects: '1' })]:
        sectionsResponse('CityX', [{ index: '1', line: 'Regions' }]),
      [key({ action: 'parse', page: 'CityX', prop: 'wikitext', section: '1' })]:
        wikitextResponse('CityX', `{{Regionlist
| region1name=[[CityX/Central]]
| region1items=
| region2name=[[CityX/North]]
| region2items=
}}`),
      [key({ action: 'parse', page: 'CityX', prop: 'wikitext' })]:
        wikitextResponse('CityX', ''),
    };

    const fetcher = createMockFetcher(responses);
    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'CityX', 3, progress,
    );

    expect(result).not.toBe('missing');
    const tree = result as TreeNode;
    expect(tree.children).toHaveLength(0); // treated as leaf

    // Check decision was logged
    expect(progress.decisions).toContainEqual(
      expect.objectContaining({
        page: 'CityX',
        decision: 'leaf',
        decidedBy: 'city_districts',
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/wikivoyageExtract/__tests__/treeBuilder.test.ts --reporter=verbose`
Expected: FAIL — `progress.decisions` is empty (no push yet)

**Step 3: Add decision logging to all treeBuilder decision points**

In `backend/src/services/wikivoyageExtract/treeBuilder.ts`, add pushes at each decision point. The `progress` object is already available at every location.

**3a. City districts shortcut** (after line 198, inside `if (hasDistrictSubpages)`):

```typescript
    progress.decisions.push({
      page: resolved,
      decision: 'leaf',
      decidedBy: 'city_districts',
      detail: `Has district subpages (${page.regions.filter(r => r.name.startsWith(resolved + '/')).map(r => r.name).join(', ')})`,
    });
```

**3b. Dead-end filter resolving ambiguity** (after line 232, inside `if (!stillAmbiguous)`):

```typescript
          progress.decisions.push({
            page: resolved,
            decision: 'split',
            decidedBy: 'dead_end_filter',
            detail: `Dropped dead-ends: ${[...deadEndNames].join(', ')}; remaining regions linked`,
          });
```

**3c. Plain-text linked shortcut** (after line 246, inside `if (allHavePages && !hasLinkedContent)`):

```typescript
          progress.decisions.push({
            page: resolved,
            decision: 'split',
            decidedBy: 'plain_text_linked',
            detail: `All ${remainingAmbiguous.length} plain-text entries have real pages`,
          });
```

**3d. AI returned empty regions** (after AI call, when `aiResult.regions.length === 0` and `aiQuestions.length === 0`). Add an `else` block after the `if (aiResult.regions.length > 0)` at line 263:

After the existing block at lines 263-271, add:

```typescript
      if (aiResult.regions.length === 0) {
        progress.decisions.push({
          page: resolved,
          decision: 'leaf',
          decidedBy: 'ai_empty',
          detail: 'AI returned no regions',
        });
      } else if (aiQuestions.length === 0) {
        progress.decisions.push({
          page: resolved,
          decision: 'split',
          decidedBy: 'ai_confident',
          detail: `AI extracted ${aiResult.regions.length} regions with no questions`,
        });
      }
```

Note: this goes BEFORE the coverage gate check. If coverage gate later overrides, it will push its own entry. We want to see both — "AI said X, then coverage gate overrode it."

**3e. Coverage gate** (after line 291, inside `if (totalSubs > 0 && withPages / totalSubs < 0.5)`):

```typescript
          progress.decisions.push({
            page: resolved,
            decision: 'leaf',
            decidedBy: 'coverage_gate',
            detail: `${withPages}/${totalSubs} subregions have pages (${Math.round(withPages / totalSubs * 100)}%)`,
          });
```

**3f. Interview auto-resolved** (inside the `.then` callback at line 385, inside `if (result.type === 'auto_resolved')`):

```typescript
              prog.decisions.push({
                page: resolved,
                decision: result.action === 'clear_regions' ? 'leaf' : 'split',
                decidedBy: 'interview_auto',
                detail: `Rule #${result.ruleId}: ${result.appliedRule}`,
              });
```

**3g. AI unavailable** (at line 418-420, in the `else if (page.needsAI)` block):

```typescript
    progress.decisions.push({
      page: resolved,
      decision: 'split',
      decidedBy: 'no_ai',
      detail: 'AI needed but unavailable — using parser output as-is',
    });
```

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/wikivoyageExtract/__tests__/treeBuilder.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```
feat: instrument treeBuilder with decision logging at all 7 decision points
```

---

### Task 3: Add summary printer and call it after Phase 1

**Files:**
- Modify: `backend/src/services/wikivoyageExtract/index.ts`

**Step 1: Write the failing test**

Create `backend/src/services/wikivoyageExtract/__tests__/decisionSummary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatDecisionSummary } from '../decisionSummary.js';
import type { DecisionEntry } from '../types.js';

describe('formatDecisionSummary', () => {
  it('groups decisions by decidedBy and formats summary', () => {
    const decisions: DecisionEntry[] = [
      { page: 'Hong Kong', decision: 'leaf', decidedBy: 'city_districts', detail: 'Has district subpages' },
      { page: 'Taipei', decision: 'leaf', decidedBy: 'city_districts', detail: 'Has district subpages' },
      { page: 'Laos', decision: 'leaf', decidedBy: 'coverage_gate', detail: '2/8 subregions have pages (25%)' },
      { page: 'France', decision: 'split', decidedBy: 'ai_confident', detail: 'AI extracted 13 regions' },
    ];

    const summary = formatDecisionSummary(decisions, 247);
    expect(summary).toContain('EXTRACTION DECISION SUMMARY');
    expect(summary).toContain('city_districts');
    expect(summary).toContain('Hong Kong');
    expect(summary).toContain('Taipei');
    expect(summary).toContain('coverage_gate');
    expect(summary).toContain('Laos');
    expect(summary).toContain('2/8 subregions have pages (25%)');
    expect(summary).toContain('ai_confident');
    expect(summary).toContain('France');
  });

  it('truncates page lists longer than 10', () => {
    const decisions: DecisionEntry[] = Array.from({ length: 15 }, (_, i) => ({
      page: `Page${i}`,
      decision: 'leaf' as const,
      decidedBy: 'city_districts' as const,
      detail: 'test',
    }));

    const summary = formatDecisionSummary(decisions, 100);
    expect(summary).toContain('...and 5 more');
  });

  it('returns minimal message when no decisions logged', () => {
    const summary = formatDecisionSummary([], 50);
    expect(summary).toContain('No AI/shortcut decisions');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/wikivoyageExtract/__tests__/decisionSummary.test.ts --reporter=verbose`
Expected: FAIL — module not found

**Step 3: Create decisionSummary.ts**

Create `backend/src/services/wikivoyageExtract/decisionSummary.ts`:

```typescript
/**
 * Decision summary formatter for extraction Phase 1.
 * Groups decisions by maker and prints a structured console summary.
 */

import type { DecisionEntry, DecisionMaker } from './types.js';

const MAKER_LABELS: Record<DecisionMaker, string> = {
  city_districts: 'City districts shortcut (Parent/District format)',
  dead_end_filter: 'Dead-end filter (resolved ambiguity)',
  plain_text_linked: 'Plain-text linked (all entries have pages)',
  ai_empty: 'AI returned empty (city/coverage rules)',
  ai_confident: 'AI extracted confidently (no questions)',
  coverage_gate: 'Coverage gate (<50% have pages)',
  interview_auto: 'Interview auto-resolved (learned rule)',
  admin_answer: 'Admin answered question',
  no_ai: 'AI unavailable (parser output used)',
};

/** Display order for the summary */
const MAKER_ORDER: DecisionMaker[] = [
  'city_districts',
  'dead_end_filter',
  'plain_text_linked',
  'ai_empty',
  'ai_confident',
  'coverage_gate',
  'interview_auto',
  'admin_answer',
  'no_ai',
];

const MAX_PAGES_SHOWN = 10;

/**
 * Format a decision summary for console output.
 * @param decisions - All decision entries from Phase 1
 * @param totalPagesProcessed - Total pages visited during extraction
 */
export function formatDecisionSummary(decisions: DecisionEntry[], totalPagesProcessed: number): string {
  if (decisions.length === 0) {
    return `═══ EXTRACTION DECISION SUMMARY ═══\nNo AI/shortcut decisions logged (${totalPagesProcessed} pages processed by parser only)\n═══════════════════════════════════`;
  }

  const grouped = new Map<DecisionMaker, DecisionEntry[]>();
  for (const d of decisions) {
    const list = grouped.get(d.decidedBy) ?? [];
    list.push(d);
    grouped.set(d.decidedBy, list);
  }

  const lines: string[] = [
    '═══ EXTRACTION DECISION SUMMARY ═══',
    `Pages with decisions: ${decisions.length} of ${totalPagesProcessed} processed`,
    '',
  ];

  for (const maker of MAKER_ORDER) {
    const entries = grouped.get(maker);
    if (!entries || entries.length === 0) continue;

    const decisions_str = entries.map(e => e.decision);
    const unique_decisions = [...new Set(decisions_str)].join('/');
    lines.push(`${maker} → ${unique_decisions} (${entries.length}):`);
    lines.push(`  ${MAKER_LABELS[maker]}`);

    // Show page details — for coverage_gate include stats
    if (maker === 'coverage_gate' || maker === 'interview_auto') {
      // Show detail per page (stats matter)
      const shown = entries.slice(0, MAX_PAGES_SHOWN);
      for (const e of shown) {
        lines.push(`  - ${e.page}: ${e.detail}`);
      }
    } else {
      // Just show page names
      const shown = entries.slice(0, MAX_PAGES_SHOWN);
      lines.push(`  ${shown.map(e => e.page).join(', ')}`);
    }

    if (entries.length > MAX_PAGES_SHOWN) {
      lines.push(`  ...and ${entries.length - MAX_PAGES_SHOWN} more`);
    }
    lines.push('');
  }

  const remaining = totalPagesProcessed - decisions.length;
  if (remaining > 0) {
    lines.push(`Remaining ${remaining} pages: parser handled confidently (no AI needed)`);
  }
  lines.push('═══════════════════════════════════');

  return lines.join('\n');
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/wikivoyageExtract/__tests__/decisionSummary.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Wire up the summary print in index.ts**

In `backend/src/services/wikivoyageExtract/index.ts`, after the Phase 1 complete log (line 263), add:

```typescript
    // Print decision summary
    if (progress.decisions.length > 0) {
      const { formatDecisionSummary } = await import('./decisionSummary.js');
      console.log(formatDecisionSummary(progress.decisions, progress.regionsFetched));
    }
```

Import is dynamic to keep it lightweight — only loaded when there are decisions.

**Step 6: Run all tests**

Run: `cd backend && npx vitest run src/services/wikivoyageExtract/__tests__/ --reporter=verbose`
Expected: All PASS

**Step 7: Commit**

```
feat: add decision summary printer after Phase 1 extraction
```

---

### Task 4: Run checks and final commit

**Step 1: Run typecheck and lint**

Run: `npm run check`
Expected: PASS

**Step 2: Run knip**

Run: `npm run knip`
Expected: No new unused exports (DecisionEntry and DecisionMaker are used in treeBuilder)

**Step 3: Run tests**

Run: `TEST_REPORT_LOCAL=1 npm test`
Expected: All PASS

**Step 4: Update planning doc**

Trim `docs/tech/planning/2026-02-28-extraction-decision-logging-design.md` to mark as implemented. Add a note pointing to the new `decisionSummary.ts` file.

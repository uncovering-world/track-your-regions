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
  country_depth: 'Country depth limit (area-based)',
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
  'country_depth',
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

    const uniqueDecisions = [...new Set(entries.map(e => e.decision))].join('/');
    lines.push(`${maker} → ${uniqueDecisions} (${entries.length}):`);
    lines.push(`  ${MAKER_LABELS[maker]}`);

    // Show detail per page for coverage_gate and country_depth (stats matter)
    if (maker === 'coverage_gate' || maker === 'country_depth') {
      const shown = entries.slice(0, MAX_PAGES_SHOWN);
      for (const e of shown) {
        lines.push(`  - ${e.page}: ${e.detail}`);
      }
    } else {
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

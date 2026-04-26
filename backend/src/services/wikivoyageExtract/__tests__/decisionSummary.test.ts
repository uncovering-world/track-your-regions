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

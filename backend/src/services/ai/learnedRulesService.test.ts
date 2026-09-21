/**
 * Learned rules are six statements on one table and one mapping from the row
 * `pg` returns to the ISO-dated shape the admin page reads. These pin the
 * clause each statement decides by, and that the mapping survives a row whose
 * `created_at` the database left null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  addRule, buildLearnedRulesPrompt, deleteRule, deleteRules, getAllRules, getRules,
  updateRuleText,
} from './learnedRulesService.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const STORED = {
  id: 7,
  feature: 'extraction',
  rule_text: 'Islands are leaves.',
  context: null,
  created_at: new Date('2026-01-02T03:04:05Z'),
};

const lastCall = () => mockedQuery.mock.calls.at(-1) as [string, unknown[] | undefined];

beforeEach(() => {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('reading rules', () => {
  it('getRules filters by feature, oldest first, and maps the row to the ISO-dated shape', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [STORED] });

    const rules = await getRules('extraction');

    const [sql, params] = lastCall();
    expect(sql).toMatch(/FROM ai_learned_rules\s+WHERE feature = \$1\s+ORDER BY created_at ASC/);
    expect(params).toEqual(['extraction']);
    expect(rules).toEqual([{
      id: 7,
      feature: 'extraction',
      ruleText: 'Islands are leaves.',
      context: null,
      createdAt: '2026-01-02T03:04:05.000Z',
    }]);
  });

  it('getAllRules orders by feature, then age, and still dates a row the database left undated', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ ...STORED, created_at: null }] });

    const [rule] = await getAllRules();

    const [sql, params] = lastCall();
    expect(sql).toMatch(/ORDER BY feature ASC, created_at ASC/);
    expect(params).toBeUndefined();
    expect(rule.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('writing rules', () => {
  it('addRule inserts the three columns and returns the row it wrote', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [STORED] });

    const rule = await addRule('extraction', 'Islands are leaves.');

    const [sql, params] = lastCall();
    expect(sql).toMatch(/INSERT INTO ai_learned_rules \(feature, rule_text, context\)/);
    expect(sql).toMatch(/RETURNING id, feature, rule_text, context, created_at/);
    expect(params).toEqual(['extraction', 'Islands are leaves.', null]);
    expect(rule.id).toBe(7);
  });

  it('updateRuleText replaces the text of one row and answers whether it existed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await updateRuleText(7, 'Islands are leaves, always.')).toBe(true);

    const [sql, params] = lastCall();
    expect(sql).toMatch(/SET rule_text = \$2 WHERE id = \$1 RETURNING id/);
    expect(params).toEqual([7, 'Islands are leaves, always.']);

    expect(await updateRuleText(8, 'x')).toBe(false);
  });

  it('deleteRule answers by the row it removed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await deleteRule(7)).toBe(true);

    const [sql, params] = lastCall();
    expect(sql).toMatch(/DELETE FROM ai_learned_rules WHERE id = \$1 RETURNING id/);
    expect(params).toEqual([7]);

    expect(await deleteRule(8)).toBe(false);
  });

  it('deleteRules takes the ids as one array and counts what it removed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 7 }, { id: 9 }] });
    expect(await deleteRules([7, 8, 9])).toBe(2);

    const [sql, params] = lastCall();
    expect(sql).toMatch(/WHERE id = ANY\(\$1::int\[\]\) RETURNING id/);
    expect(params).toEqual([[7, 8, 9]]);
  });

  it('deleteRules sends nothing for an empty list', async () => {
    expect(await deleteRules([])).toBe(0);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

describe('buildLearnedRulesPrompt', () => {
  it('is empty when the feature has no rules', async () => {
    expect(await buildLearnedRulesPrompt('extraction')).toBe('');
  });

  it('numbers the rules and leaves their context out', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [
      STORED,
      { ...STORED, id: 8, rule_text: 'Cities are leaves.', context: 'About the Azores page' },
    ] });

    const prompt = await buildLearnedRulesPrompt('extraction');

    expect(prompt).toContain('1. Islands are leaves.');
    expect(prompt).toContain('2. Cities are leaves.');
    expect(prompt).not.toContain('Azores');
  });
});

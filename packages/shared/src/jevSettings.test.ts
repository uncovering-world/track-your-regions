import { describe, expect, it } from 'vitest';
import { DEFAULT_JEV_FINDER_BUDGET_USD, finderBudgetUsd, finderJudges } from './jevSettings.js';

describe("Jev's judging at finder time (#1355)", () => {
  it('is on only where the setting says on', () => {
    expect(finderJudges('on')).toBe(true);
    expect(finderJudges('off')).toBe(false);
    expect(finderJudges(undefined)).toBe(false);
    expect(finderJudges('true')).toBe(false);
  });

  it('reads a budget within bounds, and the default otherwise', () => {
    expect(finderBudgetUsd('0.25')).toBe(0.25);
    expect(finderBudgetUsd('0')).toBe(0);
    expect(finderBudgetUsd(undefined)).toBe(DEFAULT_JEV_FINDER_BUDGET_USD);
    expect(finderBudgetUsd('')).toBe(DEFAULT_JEV_FINDER_BUDGET_USD);
    expect(finderBudgetUsd('7')).toBe(DEFAULT_JEV_FINDER_BUDGET_USD);
    expect(finderBudgetUsd('-1')).toBe(DEFAULT_JEV_FINDER_BUDGET_USD);
    expect(finderBudgetUsd('ten cents')).toBe(DEFAULT_JEV_FINDER_BUDGET_USD);
  });
});

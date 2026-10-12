/**
 * Whether the component-item finder has Jev judge what it proposed, and what
 * one pass may spend on it (#1355): two AI settings the admin panel writes and
 * the finder's pass reads. Jev is paid by the input token, so judging is off
 * until an admin turns it on, and a pass stops asking before it would spend
 * more than its budget; the candidates past it are asked when a curator opens
 * their card, as when judging is off.
 */

/** The setting that turns judging at finder time on: `on`, or anything else for off. */
export const JEV_FINDER_JUDGES_KEY = 'jev_finder_judges';

/** The setting that caps what one pass spends on Jev, in US dollars. */
export const JEV_FINDER_BUDGET_USD_KEY = 'jev_finder_budget_usd';

/**
 * The budget where none is set. Ten cents bought about 4,000 questions at
 * 2026-10-12's price and token counts, several times every open candidate:
 * a ceiling on a mistake, not a ration.
 */
export const DEFAULT_JEV_FINDER_BUDGET_USD = 0.1;

/** The largest budget the panel accepts for one press of a button. */
export const MAX_JEV_FINDER_BUDGET_USD = 5;

/** Whether a stored value turns judging on. */
export function finderJudges(value: string | undefined): boolean {
  return value === 'on';
}

/** The budget a stored value states: a number of dollars within bounds, else the default. */
export function finderBudgetUsd(value: string | undefined): number {
  const n = value === undefined || value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_JEV_FINDER_BUDGET_USD ? n : DEFAULT_JEV_FINDER_BUDGET_USD;
}

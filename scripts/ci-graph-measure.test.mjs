import { describe, expect, it } from 'vitest';
import { dayRanges, edgeEffect, jobStats, percentile, perPullRequest, ran, runCost } from './ci-graph-measure.mjs';

/** A job as the jobs API answers it, trimmed to what the measurement reads; times are minutes past 10:00. */
const at = (minute) => new Date(Date.UTC(2026, 8, 28, 10, 0, minute * 60)).toISOString().replace('.000Z', 'Z');
const job = (name, conclusion, from, to) => ({ name, conclusion, started_at: at(from), completed_at: at(to) });
const skipped = (name) => ({ name, conclusion: 'skipped', started_at: at(0), completed_at: at(0) });

/** A green run: the lint job holds back the smoke lane, which ends the run. */
const GREEN = {
  id: 1,
  head_repository: 'uncovering-world/track-your-regions',
  head_branch: 'fix/834-probe-names-empty-root',
  conclusion: 'success',
  run_started_at: at(0),
  jobs: [
    job('Changes', 'success', 0, 0.5),
    job('Lint & Type Check', 'success', 0.5, 3),
    job('Unit Tests', 'success', 0.5, 4),
    job('E2E Smoke', 'success', 3, 7),
    skipped('Trivy Image Scan (cv-python)'),
  ],
};

/** A red lint job, so the smoke lane never started. */
const RED = {
  id: 2,
  head_repository: 'uncovering-world/track-your-regions',
  head_branch: 'fix/834-probe-names-empty-root',
  conclusion: 'failure',
  run_started_at: at(0),
  jobs: [job('Changes', 'success', 0, 0.5), job('Lint & Type Check', 'failure', 0.5, 2), skipped('E2E Smoke')],
};

describe('the CI graph measurement', () => {
  it('tells a job that ran from one its if: skipped', () => {
    expect(ran(GREEN.jobs[1])).toBe(true);
    expect(ran(skipped('Build'))).toBe(false);
  });

  it('interpolates percentiles between ranks', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([], 50)).toBeNull();
  });

  it('measures a run from its start to its last job\'s end, and adds up only the jobs that ran', () => {
    expect(runCost(GREEN)).toEqual({ criticalPath: 7, runnerMinutes: 0.5 + 2.5 + 3.5 + 4 });
  });

  it('counts each job\'s runs, skips and failures, and times the jobs that ran', () => {
    const smoke = jobStats([GREEN, RED]).find((s) => s.name === 'E2E Smoke');
    expect(smoke).toMatchObject({ seen: 2, ran: 1, skipped: 1, failed: 0, offsets: [3], durations: [4] });
    expect(jobStats([GREEN, RED]).find((s) => s.name === 'Lint & Type Check')).toMatchObject({ ran: 2, failed: 1 });
  });

  it('groups runs by pull request, the cancelled ones counted apart and in the minutes', () => {
    const cancelled = { ...GREEN, id: 3, conclusion: 'cancelled' };
    expect(perPullRequest([GREEN, RED, cancelled])).toEqual([
      { head: 'uncovering-world/track-your-regions:fix/834-probe-names-empty-root', runs: 3, cancelled: 1, runnerMinutes: 10.5 + 2 + 10.5 },
    ]);
  });

  it('keeps a fork\'s branch apart from the same branch name in the repository', () => {
    const fork = { ...GREEN, id: 4, head_repository: 'a-contributor/track-your-regions' };
    expect(perPullRequest([GREEN, fork]).map((p) => p.head)).toEqual([
      'uncovering-world/track-your-regions:fix/834-probe-names-empty-root',
      'a-contributor/track-your-regions:fix/834-probe-names-empty-root',
    ]);
  });

  it('cuts a window into days, the last one short, so no query meets the endpoint\'s cap', () => {
    expect(dayRanges('2026-09-21T14:05:00Z', '2026-09-23T20:00:00Z')).toEqual([
      ['2026-09-21T14:05:00Z', '2026-09-22T14:05:00Z'],
      ['2026-09-22T14:05:00Z', '2026-09-23T14:05:00Z'],
      ['2026-09-23T14:05:00Z', '2026-09-23T20:00:00Z'],
    ]);
  });

  it('says what the wait on the lint job cost on green and saved on red', () => {
    expect(edgeEffect([GREEN, RED], 'E2E Smoke')).toEqual({
      job: 'E2E Smoke',
      ran: 1,
      delayP50: 2.5,
      delayP90: 2.5,
      lastToFinish: 1,
      redGateRuns: [2],
      savedPerRedGate: 4,
    });
  });
});

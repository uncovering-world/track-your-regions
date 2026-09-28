#!/usr/bin/env node
/**
 * Measures the CI job graph over a window of pull-request runs (#965): per job
 * its start offset, duration, failure and skip rates; per run its critical path
 * and runner-minutes; per pull request its runs and runner-minutes, cancelled
 * runs counted apart; and for the build, the smoke lane and Lighthouse, how long
 * after `Changes` each started and what a red `Lint & Type Check` spared.
 *
 * Those three waited on `Lint & Type Check` until #965 took the waits out, and
 * that edge table is what the decision was taken on. Over a window after it, a
 * job's delay after `Changes` is its queue time rather than a wait, and no
 * red check skips it, so the same table reads as the new graph's.
 *
 *   node scripts/ci-graph-measure.mjs [--since ISO] [--until ISO] [--refresh]
 *
 * The runs and their jobs are read with `gh api` and kept in
 * data/cache/ci-graph/ (gitignored), keyed by the window, so a second run over
 * the same --since and --until reads the file instead of the API and a
 * measurement can be re-read after the window has moved on; --refresh reads the
 * API again. Without --until the window ends now, which names a new file.
 * The output is the markdown docs/tech/gates.md § The job graph carries, with
 * the command that produced it.
 *
 * Runner-minutes are the sum of the jobs' own durations, not what GitHub bills:
 * billing rounds each job up to a whole minute, which would count the ten-second
 * Changes job as a minute and hide the difference an edge makes.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** The lint job, and the jobs that waited on it until #965. */
export const GATE = 'Lint & Type Check';
export const GATED = ['Build', 'E2E Smoke', 'Performance (Lighthouse)'];
const DETECTION = 'Changes';

const minutes = (from, to) => (Date.parse(to) - Date.parse(from)) / 60_000;

/** A job that ran, as opposed to one its `if:` skipped. */
export function ran(job) {
  return job.conclusion !== 'skipped' && job.started_at != null && job.completed_at != null;
}

/** R-7 percentile, as the latency probe computes it. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Per job name: how often it ran, failed and was skipped, when it started and how long it took. */
export function jobStats(runs) {
  const byName = new Map();
  for (const run of runs) {
    for (const job of run.jobs) {
      const entry = byName.get(job.name) ?? { name: job.name, seen: 0, ran: 0, failed: 0, skipped: 0, offsets: [], durations: [] };
      entry.seen += 1;
      if (job.conclusion === 'skipped') entry.skipped += 1;
      if (ran(job)) {
        entry.ran += 1;
        if (job.conclusion === 'failure') entry.failed += 1;
        entry.offsets.push(minutes(run.run_started_at, job.started_at));
        entry.durations.push(minutes(job.started_at, job.completed_at));
      }
      byName.set(job.name, entry);
    }
  }
  return [...byName.values()];
}

/** A run's wall clock from its start to its last job's end, and the minutes its jobs ran for. */
export function runCost(run) {
  const ranJobs = run.jobs.filter(ran);
  const runnerMinutes = ranJobs.reduce((sum, job) => sum + minutes(job.started_at, job.completed_at), 0);
  const lastEnd = ranJobs.reduce((latest, job) => (job.completed_at > latest ? job.completed_at : latest), run.run_started_at);
  return { criticalPath: minutes(run.run_started_at, lastEnd), runnerMinutes };
}

/**
 * Per pull request: runs, cancelled runs and runner-minutes, the cancelled ones
 * included. A pull request is its head repository and branch. A run's
 * `pull_requests` list would name it, but the API leaves the list empty on
 * nearly every run of this repository (one of 69 on 2026-09-27..28), so the
 * head is what identifies one. Two pull requests opened one after the other
 * from the same branch would count as one.
 */
export function perPullRequest(runs) {
  const byHead = new Map();
  for (const run of runs) {
    const head = `${run.head_repository}:${run.head_branch}`;
    const entry = byHead.get(head) ?? { head, runs: 0, cancelled: 0, runnerMinutes: 0 };
    entry.runs += 1;
    if (run.conclusion === 'cancelled') entry.cancelled += 1;
    entry.runnerMinutes += runCost(run).runnerMinutes;
    byHead.set(head, entry);
  }
  return [...byHead.values()];
}

/**
 * One of the three jobs over the completed runs, as observed.
 *
 * The start lag is the time from the detection job's end to the job's own
 * start. An ungated job starts at that moment, so for a job waiting on the gate
 * the lag is the gate's run plus the runners' queueing, and for one that does
 * not wait it is the queueing alone. How often the job finished last says how
 * often its end was the run's end. That makes the lag a close estimate of what
 * the wait added to those runs, not a counterfactual proof.
 *
 * The red-gate runs are those where the gate failed and the job did not run. It
 * is an upper bound on the runs the wait spared: the change map may have
 * skipped the job there anyway, and the map's per-job verdict is not in the
 * jobs API. The runner-minutes a spared run would have spent are the job's
 * median duration where it ran.
 */
export function edgeEffect(runs, gated) {
  const durations = [];
  const delays = [];
  let lastToFinish = 0;
  const redGate = [];
  for (const run of runs) {
    const job = run.jobs.find((j) => j.name === gated);
    const gate = run.jobs.find((j) => j.name === GATE);
    const detection = run.jobs.find((j) => j.name === DETECTION);
    if (!job || !gate || !detection || !ran(detection)) continue;
    if (ran(job)) {
      durations.push(minutes(job.started_at, job.completed_at));
      delays.push(minutes(detection.completed_at, job.started_at));
      const last = run.jobs.filter(ran).every((other) => other.completed_at <= job.completed_at);
      if (last) lastToFinish += 1;
    } else if (gate.conclusion === 'failure') {
      redGate.push(run.id);
    }
  }
  return {
    job: gated,
    ran: delays.length,
    delayP50: percentile(delays, 50),
    delayP90: percentile(delays, 90),
    lastToFinish,
    redGateRuns: redGate,
    savedPerRedGate: percentile(durations, 50),
  };
}

function fmt(value, digits = 1) {
  return value == null ? '-' : value.toFixed(digits);
}

function pct(part, whole) {
  return whole === 0 ? '-' : `${((100 * part) / whole).toFixed(1)}%`;
}

/** The markdown the doc carries. */
export function report({ since, until, runs }) {
  const completed = runs.filter((run) => run.conclusion !== 'cancelled');
  const lines = [];
  lines.push(`Window: \`pull_request\` runs of \`ci.yml\` created ${since} .. ${until}: ${runs.length} runs, ${runs.length - completed.length} cancelled.`, '');
  lines.push('| Job | ran | skipped | failed (of ran) | start offset p50 / p90 min | duration p50 / p90 min |');
  lines.push('|-----|-----|---------|-----------------|---------------------------|------------------------|');
  for (const s of jobStats(completed).sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${s.name} | ${s.ran} | ${pct(s.skipped, s.seen)} | ${s.failed} (${pct(s.failed, s.ran)}) | ${fmt(percentile(s.offsets, 50))} / ${fmt(percentile(s.offsets, 90))} | ${fmt(percentile(s.durations, 50))} / ${fmt(percentile(s.durations, 90))} |`);
  }
  const costs = completed.map(runCost);
  const prs = perPullRequest(runs);
  lines.push('');
  lines.push('| Per run (completed) | p50 | p90 |');
  lines.push('|---------------------|-----|-----|');
  lines.push(`| critical path, min | ${fmt(percentile(costs.map((c) => c.criticalPath), 50))} | ${fmt(percentile(costs.map((c) => c.criticalPath), 90))} |`);
  lines.push(`| runner-minutes | ${fmt(percentile(costs.map((c) => c.runnerMinutes), 50))} | ${fmt(percentile(costs.map((c) => c.runnerMinutes), 90))} |`);
  lines.push('');
  lines.push(`| Per pull request (${prs.length}) | p50 | p90 |`);
  lines.push('|----------------------|-----|-----|');
  lines.push(`| runs | ${fmt(percentile(prs.map((p) => p.runs), 50))} | ${fmt(percentile(prs.map((p) => p.runs), 90))} |`);
  lines.push(`| cancelled runs | ${fmt(percentile(prs.map((p) => p.cancelled), 50))} | ${fmt(percentile(prs.map((p) => p.cancelled), 90))} |`);
  lines.push(`| runner-minutes | ${fmt(percentile(prs.map((p) => p.runnerMinutes), 50))} | ${fmt(percentile(prs.map((p) => p.runnerMinutes), 90))} |`);
  lines.push('');
  lines.push(`| After Changes (waited on ${GATE} until #965) | ran | start lag p50 / p90 min | last to finish | red-gate runs, at most | saved per red gate, min |`);
  lines.push('|------|-----|---------------------------|----------------|--------------------------|-------------------------|');
  for (const gated of GATED) {
    const e = edgeEffect(completed, gated);
    lines.push(`| ${e.job} | ${e.ran} | ${fmt(e.delayP50)} / ${fmt(e.delayP90)} | ${e.lastToFinish} | ${e.redGateRuns.length}${e.redGateRuns.length ? ` (${e.redGateRuns.join(', ')})` : ''} | ${fmt(e.savedPerRedGate)} |`);
  }
  return lines.join('\n');
}

const REPO = 'uncovering-world/track-your-regions';
const CACHE = path.join('data', 'cache', 'ci-graph');

function gh(args) {
  return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
}

/**
 * A window cut into days. The runs endpoint answers at most 1,000 runs to a
 * query filtered by `created`, however it is paginated, so a window read in one
 * query would come back silently short once it held more.
 */
export function dayRanges(since, until) {
  const ranges = [];
  for (let from = Date.parse(since); from < Date.parse(until); from += 86_400_000) {
    const to = Math.min(from + 86_400_000, Date.parse(until));
    ranges.push([new Date(from).toISOString().replace('.000Z', 'Z'), new Date(to).toISOString().replace('.000Z', 'Z')]);
  }
  return ranges;
}

/** Every pull-request run of ci.yml in the window, each with its jobs. */
function readRuns(since, until) {
  const runs = [];
  for (const [from, to] of dayRanges(since, until)) {
    const pages = gh(['--paginate', '--slurp', `repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&per_page=100&created=${from}..${to}`]);
    if (pages[0]?.total_count >= 1000) {
      throw new Error(`${from}..${to} holds ${pages[0].total_count} runs, past what the runs endpoint answers to one query`);
    }
    runs.push(...pages.flatMap((page) => page.workflow_runs).filter((run) => run.status === 'completed'));
  }
  const byId = new Map(runs.map((run) => [run.id, run]));
  return [...byId.values()].map((run) => ({
    id: run.id,
    head_repository: run.head_repository?.full_name ?? null,
    head_branch: run.head_branch,
    conclusion: run.conclusion,
    run_started_at: run.run_started_at,
    jobs: gh(['--paginate', '--slurp', `repos/${REPO}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`])
      .flatMap((page) => page.jobs)
      .map(({ name, conclusion, started_at, completed_at }) => ({ name, conclusion, started_at, completed_at })),
  }));
}

function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  // The window opens at the merge of #920 (PR #968), which made a push to a
  // pull request cancel the run it superseded.
  const since = option('since') ?? '2026-09-21T14:05:00Z';
  const until = option('until') ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const file = path.join(CACHE, `runs-${since}-${until}.json`.replaceAll(':', ''));
  let runs;
  if (existsSync(file) && !argv.includes('--refresh')) {
    runs = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    runs = readRuns(since, until);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(runs));
  }
  process.stdout.write(`${report({ since, until, runs })}\n`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('ci-graph-measure.mjs')) process.exit(main(process.argv.slice(2)));

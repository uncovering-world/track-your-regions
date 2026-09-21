import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { GATES, decide, githubOutputs } from './gates.mjs';
import { repoFile } from './repo-root.mjs';

/**
 * The fail-safe clause of `.github/workflows/ci.yml`, pinned (#952).
 *
 * Since #783 every job but `Changes` runs only when the map says its inputs
 * moved, and the whole arrangement rests on one line per job:
 *
 *     if: ${{ !cancelled() && (needs.changes.result != 'success' || …) }}
 *
 * `!cancelled()` removes the implicit `success()`, so a `Changes` job that
 * fails skips nothing and every job runs — the map's own rule for a change set
 * it cannot work out, applied one level up. Drop either half from one job and
 * the workflow stays green for as long as detection keeps working; the day it
 * breaks, that job is skipped, reports Success to branch protection, and leaves
 * a pull request mergeable on which nothing ran. The invariant was stated in
 * comments, in `docs/tech/gates.md` and in ADR-0062, and checked by nothing.
 *
 * The workflow is parsed, and the expression inside each parsed `if:` is then
 * pinned **whole**: that text is the contract, and the clauses are worth
 * nothing in the wrong places. `!cancelled() && (A || B)` runs the job when the
 * decision failed; `!cancelled() && (A) && B` carries every clause of it and
 * skips the job on that same failure, because a job that failed wrote no output
 * and `B` compares the empty string. A spec that asked only whether each clause
 * appeared would call the second one fine (CodeRabbit on PR #954). So the
 * expected string is built per job from the map — the output key it publishes,
 * and whether the job waits behind `check` — and compared after runs of
 * whitespace are collapsed, since YAML may fold a long condition across lines.
 *
 * It reads in both directions, because one of them alone is no check at all: a
 * job whose clauses are checked is a job that is still in the file, so the map
 * is also asked for every job it names. What the loops could otherwise pass
 * over is pinned three ways, each at the altitude it belongs to — the number of
 * jobs is derived from `GATES`, so it needs no number here; the jobs that wait
 * behind `check` are a named list with the reason they are those three; and
 * only the guarded steps are a bare count, because nothing in the map says how
 * many steps of a job ask for a toolchain.
 */

const WORKFLOW = repoFile('.github', 'workflows', 'ci.yml');

/** The detection job every other job reads, and the clauses that protect them. */
const DETECTION = 'changes';
const FAIL_SAFE = '!cancelled()';
const ESCAPE = `needs.${DETECTION}.result != 'success' ||`;
const ORDER = "needs.check.result == 'success'";

/**
 * The expression a job's `if:` is, and the one a guarded step's `if:` is.
 *
 * Assembled from the clauses above in the order and the grouping the workflow
 * writes them in, with the output key left to the caller. Everything here is a
 * decision the map already took — which key a job reads, whether it waits
 * behind `check` — so the expected string is derived and not transcribed.
 *
 * These two builders are where the workflow's *phrasing* is pinned, not only
 * its meaning, so rephrasing a condition on purpose is a change to them as much
 * as to the YAML. Three shapes say exactly what the file says today and would
 * still turn this red: swapping the escape's operands
 * (`needs.changes.outputs.<key> == 'true' || needs.changes.result != 'success'`),
 * writing the condition in the quoted `if: "…"` form without the `${{ }}`
 * braces, and a step guarded on two keys at once. None of the three is wrong;
 * each is a decision to take here as well, and the alternative — a spec that
 * accepts any phrasing — is what let the clauses drift into the wrong places.
 */
const jobCondition = (key, behindCheck) =>
  `\${{ ${FAIL_SAFE} && ${behindCheck ? `${ORDER} && ` : ''}`
  + `(${ESCAPE} needs.${DETECTION}.outputs.${key} == 'true') }}`;

const stepCondition = (key) =>
  `\${{ ${ESCAPE} needs.${DETECTION}.outputs.${key} == 'true' }}`;

/** One expression, however the YAML wrapped it. */
const normalise = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The jobs that wait behind `check`, named rather than merely counted.
 *
 * These three are the lanes there is no point judging before lint and typecheck
 * have passed: a branch that does not compile should fail in four minutes with
 * a tsc error instead of burning a build, a seeded smoke run and a Lighthouse
 * pass. `!cancelled()` removed the implicit `success()` that used to enforce
 * that order, so the workflow states it — and a tidy-up that drops the clause
 * and `check` from the same job's `needs` is self-consistent, which is why the
 * list is pinned here and not only held against `needs` further down.
 */
const BEHIND_CHECK = ['build', 'e2e-smoke', 'perf'];

/**
 * How many steps read a map output. The eight are the check job's five setup
 * steps — `Setup Python`, `Install backend dependencies`,
 * `Install frontend dependencies`, `Install shared package dependencies`
 * (ADR-0065), `Set up cv-python venv` — the security job's two scans,
 * `Semgrep SAST (Node)` and `Semgrep SAST (Python)`, and the smoke job's
 * `Run the database-backed backend specs` (#522).
 *
 * This is a property of the workflow rather than of the map: nothing in
 * `gates.mjs` says how many steps of a job install a toolchain, so the number
 * is stated here. A step that quietly loses its condition, or one added
 * without it, moves it.
 */
const GUARDED_STEPS = 8;

function readWorkflow() {
  if (!existsSync(WORKFLOW)) {
    throw new Error(
      `${WORKFLOW} is not there, so this spec cannot read the workflow it exists for. `
      + 'In the container unit lane that means the backend service is missing the read-only '
      + 'mount docker-compose.yml declares for .github/workflows/ci.yml — recreate the stack '
      + 'so it applies.',
    );
  }
  return readFileSync(WORKFLOW, 'utf8');
}

const source = readWorkflow();
const workflow = parse(source);
const jobs = workflow.jobs ?? {};
const downstream = Object.entries(jobs).filter(([id]) => id !== DETECTION);

/** `needs:` is a bare string when a job waits on one job and a list when on several. */
const needsOf = (job) => {
  if (job.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
};

/**
 * The output keys the map publishes, read off the map rather than restated here
 * (`reason` is a sentence for the log, not a gate's verdict, so it is dropped).
 */
const emitted = githubOutputs(decide({ paths: [] }))
  .map((line) => line.slice(0, line.indexOf('=')))
  .filter((key) => key.startsWith('job_'));

/** The CI jobs the map knows about, and the key each of them is published under. */
const mapJobs = [...new Set(GATES.map((gate) => gate.job))];
const keyOf = (mapJob) => `job_${mapJob.replaceAll('-', '_')}`;

/**
 * Which of the map's jobs a workflow job is, so that "reads its own key" is
 * checked and not merely "reads some key" — two jobs with each other's key
 * would pass the looser test and skip the wrong lane.
 *
 * The two sets of names are not the same words: the workflow calls a job after
 * what it does (`trivy-image` scans an image, `e2e-smoke` runs the smoke lane),
 * the map after the gate that fills it. A dash-separated segment is the bridge,
 * and the spec refuses a name that matches none or several rather than guessing.
 */
function mapJobFor(workflowJobId) {
  const segments = workflowJobId.split('-');
  const found = mapJobs.filter((job) => job === workflowJobId || segments.includes(job));
  if (found.length !== 1) {
    throw new Error(
      `The workflow job "${workflowJobId}" matches ${found.length} of the map's jobs `
      + `(${mapJobs.join(', ')}), so this spec cannot say which output key belongs to it. `
      + 'Name the job after the gate it runs, or teach this bridge the new name.',
    );
  }
  return found[0];
}

/** Every `needs.changes.outputs.<key>` the file mentions, wherever it mentions it. */
const OUTPUT_READ = new RegExp(`needs\\.${DETECTION}\\.outputs\\.([A-Za-z0-9_]+)`, 'g');
const OUTPUT_READ_ONE = new RegExp(OUTPUT_READ.source);
const outputsRead = [...source.matchAll(OUTPUT_READ)].map(([, key]) => key);

describe('the CI fail-safe clause', () => {
  it('has as many jobs as the map names, and a detection job', () => {
    // A vacuous loop is a passing loop: every assertion below walks this list,
    // so a job quietly leaving it — or joining it — has to fail here rather
    // than read as clean.
    expect(
      jobs[DETECTION],
      `${WORKFLOW} has no "${DETECTION}" job, so nothing decides which gates this change runs`,
    ).toBeDefined();
    expect(
      downstream.length,
      `${WORKFLOW} carries ${downstream.length} jobs beside ${DETECTION} and the map names `
      + `${mapJobs.length}. A job the workflow lost takes its gates out of CI while the map goes `
      + 'on listing them; a job it gained runs gates the map does not know it has, on a change '
      + 'set decided for something else. Either way the loops below walk only the jobs that are '
      + 'in the file',
    ).toBe(mapJobs.length);
  });

  it('pairs each job the map names with exactly one job of the workflow', () => {
    const paired = downstream.map(([id]) => [id, mapJobFor(id)]);
    for (const mapJob of mapJobs) {
      const ids = paired.filter(([, job]) => job === mapJob).map(([id]) => id);
      expect(
        ids,
        `the map gives gates to the CI job "${mapJob}" and ${WORKFLOW} has ${ids.length} jobs for `
        + 'it. With none, those gates run nowhere — the map still names them, `npm run check` '
        + 'still lists them, and CI is green having never run one of them; with two, one output '
        + 'key starts both',
      ).toHaveLength(1);
    }
  });

  it('makes every job wait on the detection job', () => {
    for (const [id, job] of downstream) {
      expect(
        needsOf(job),
        `${id} does not wait on ${DETECTION}, so its if: reads outputs of a job that may not have `
        + 'run yet — an empty value there reads as false and the job is skipped with nothing run',
      ).toContain(DETECTION);
    }
  });

  it('is, for every job, the whole expression and not a bag of clauses', () => {
    for (const [id, job] of downstream) {
      const key = keyOf(mapJobFor(id));
      const behindCheck = needsOf(job).includes('check');
      expect(
        normalise(job.if),
        `${id}'s if: is not the expression this workflow runs a job by, and the expression is `
        + `the whole of the invariant: ${FAIL_SAFE} suppresses the implicit success(), so a `
        + `failed ${DETECTION} job skips nothing; the escape runs every gate when the decision `
        + 'is unknown; the output comparison sits inside that escape, because a failed job '
        + 'writes no output and a comparison joined on from outside is false on exactly the '
        + `failure the fail-safe is for; and "${ORDER}" belongs to the jobs that wait behind `
        + 'check. Whichever of those has moved, the cost is one thing — a required context '
        + 'reporting Success with nothing run on it — and the diff below says which it was',
      ).toBe(normalise(jobCondition(key, behindCheck)));
    }
  });

  it('reads no output the map does not emit', () => {
    // `base` is the one output the step writes itself rather than the map: it
    // is the range the decision was taken over, passed on to `npm run check`.
    const allowed = new Set([...emitted, 'base']);
    for (const key of outputsRead) {
      expect(
        allowed.has(key),
        `the workflow reads needs.${DETECTION}.outputs.${key}, which scripts/gates.mjs does not `
        + 'emit. An output that is never written arrives as the empty string, reads as false, and '
        + 'skips whatever it guards on every run',
      ).toBe(true);
    }
  });

  it('declares every job_* key the map emits as an output of the detection job', () => {
    const declared = jobs[DETECTION]?.outputs ?? {};
    for (const key of emitted) {
      expect(
        Object.keys(declared),
        `the ${DETECTION} job does not publish ${key}, so every if: that reads it compares the `
        + 'empty string and skips its job — silently, on every run, whatever changed',
      ).toContain(key);
      expect(
        declared[key],
        `${DETECTION}.outputs.${key} does not come from the step that runs the map, so it cannot `
        + 'be the map\'s answer',
      ).toContain(`steps.gates.outputs.${key}`);
    }
  });

  it('keeps the build, the smoke lane and Lighthouse behind check', () => {
    const behindCheck = downstream
      .filter(([, job]) => (job.if ?? '').includes(ORDER))
      .map(([id]) => id)
      .sort();
    expect(
      behindCheck,
      `${BEHIND_CHECK.join(', ')} are the jobs there is no point judging before lint and `
      + 'typecheck have passed, and the ones #952 names. A job that loses the clause and its '
      + 'wait on check together loses that order without any other line of this workflow — or '
      + 'of this spec — saying so, so the list is pinned rather than only held against needs',
    ).toEqual([...BEHIND_CHECK].sort());
  });

  it('is the whole expression on every step that reads a map output too', () => {
    const guarded = [];
    for (const [id, job] of downstream) {
      for (const step of job.steps ?? []) {
        const condition = normalise(step.if);
        if (!condition.includes(`needs.${DETECTION}.outputs.job_`)) continue;
        const name = step.name ?? step.uses;
        guarded.push(`${id} / ${name}`);
        // The key a step reads is the step's own choice — the map says which
        // gates a job holds, not which of its steps installs what — so the
        // expected expression is built around the key the step names, and
        // whether that key exists at all is the emitted-keys test above.
        const [, key] = condition.match(OUTPUT_READ_ONE) ?? [];
        expect(
          condition,
          `the step "${name}" of ${id} reads a map output and its if: is not the expression this `
          + 'workflow guards a step with: the escape and the comparison are one term, the '
          + 'comparison inside the escape and nothing joined on from outside. A condition of any '
          + `other shape is skipped when ${DETECTION} fails while its job — which has the escape `
          + '— runs, so the lane reports Success having installed nothing, or scanned nothing. '
          + 'The diff below says how it differs',
        ).toBe(normalise(stepCondition(key)));
      }
    }
    // Again the vacuous loop, and this time with the number: the loop above
    // checks the steps it finds, so a step that stops reading an output leaves
    // it with nothing to say.
    expect(
      guarded.length,
      `${guarded.length} steps read a map output where ${GUARDED_STEPS} do `
      + `(${guarded.join('; ')}). `
      + 'A step that loses its condition pays for a toolchain its job did not ask for, and one '
      + 'added without the escape is skipped on a failed decision while its job runs — the lane '
      + 'reporting Success having installed nothing, or scanned nothing',
    ).toBe(GUARDED_STEPS);
  });

  it('filters on the jobs and never on the workflow', () => {
    // A YAML 1.1 reader turns the key `on` into the boolean true; this parser
    // reads 1.2, where it stays a string, and the fallback costs one line.
    const triggers = workflow.on ?? workflow[true];
    expect(triggers, `${WORKFLOW} declares no triggers`).toBeTruthy();

    const filters = (node, trail) => {
      if (node === null || typeof node !== 'object') return [];
      const found = [];
      for (const [key, value] of Object.entries(node)) {
        if (key === 'paths' || key === 'paths-ignore') found.push(`${trail}.${key}`);
        found.push(...filters(value, `${trail}.${key}`));
      }
      return found;
    };

    expect(
      filters(triggers, 'on'),
      'the workflow itself is filtered by paths. A workflow skipped that way never reports its '
      + 'checks at all, so the required contexts — Lint & Type Check, Security Scan, Unit Tests — '
      + 'stay Pending for ever and the merge button never lights up. The filter belongs on the '
      + 'jobs, where a skipped job reports Success and satisfies the same required check '
      + '(ADR-0062 decision 2)',
    ).toEqual([]);
  });
});

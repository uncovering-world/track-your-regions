/**
 * What the test-report wrapper (scripts/test-report.mjs) reads off a lane's
 * results, and the verdict it draws over the run: a Vitest JSON report parsed
 * into its counts and cases, a container's spec path read back as the
 * checkout's, and the summary of every step. Kept apart from the wrapper,
 * which starts running lanes as soon as it is loaded, so a spec can import it
 * (#655) — as playwright-summary.mjs and lighthouse-summary.mjs are.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseVitestReport(filePath) {
  const empty = {
    ok: false,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    files: [],
    cases: [],
    parseError: null,
  };

  if (!fs.existsSync(filePath)) {
    return { ...empty, parseError: `Missing Vitest report: ${filePath}` };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const testResults = Array.isArray(data.testResults) ? data.testResults : [];
    const files = unique(
      testResults
        .map((suite) => suite?.name)
        .filter(Boolean)
        .map((suitePath) => normalizeSuitePath(suitePath)),
    );

    const allCases = [];
    for (const suite of testResults) {
      const suitePath = suite?.name ? normalizeSuitePath(suite.name) : 'unknown';
      const assertions = Array.isArray(suite?.assertionResults)
        ? suite.assertionResults
        : [];
      for (const assertion of assertions) {
        const title = `${suitePath} :: ${assertion?.fullName || assertion?.title || 'Unnamed test'}`;
        allCases.push(title);
      }
    }

    const total = asNumber(data.numTotalTests, allCases.length);
    const passed = asNumber(
      data.numPassedTests,
      allCases.length ? allCases.length : 0,
    );
    const failed = asNumber(data.numFailedTests, 0);
    const skipped = asNumber(data.numPendingTests, 0) + asNumber(data.numTodoTests, 0);
    // `passed > 0`, not `total > 0`: `numTotalTests` counts pending and todo,
    // so a suite where everything is skipped — a `describe.skip` left behind,
    // a guard on a missing fixture — would satisfy a total-based check while
    // having executed nothing. The verdict has to rest on tests that actually
    // ran and passed.
    //
    // Belt to the runner's braces rather than a live fix: Vitest already exits
    // non-zero on an empty run and `ok` is combined with that exit code. This
    // is the lock for the day someone reaches for `passWithNoTests`, which
    // reads like a convenience flag rather than a hole in the gate.
    const ok = Boolean(data.success) && failed === 0 && passed > 0;

    return {
      ok,
      total,
      passed,
      failed,
      skipped,
      files,
      cases: unique(allCases),
      parseError: null,
    };
  } catch (error) {
    return {
      ...empty,
      parseError: `Invalid Vitest JSON report (${filePath}): ${error.message}`,
    };
  }
}

export function buildOverallSummary(activeMode, allSteps, finishedSteps, started, now = Date.now()) {
  const total = sum(finishedSteps.map((step) => step.total));
  const passed = sum(finishedSteps.map((step) => step.passed));
  const failed = sum(finishedSteps.map((step) => step.failed));
  // Only the Playwright lanes retry, so every other kind reports none.
  const flaky = sum(finishedSteps.map((step) => step.flaky ?? 0));
  const skipped = sum(finishedSteps.map((step) => step.skipped));
  const failedSteps = finishedSteps.filter((step) => !step.ok).length;
  const pendingSteps = allSteps.slice(finishedSteps.length).map((step) => step.label);

  return {
    mode: activeMode,
    // Deliberately not `flaky === 0`: a spec that passed on retry passed
    // (#447). It is reported, loudly and by name, and it does not fail a run.
    ok: failed === 0 && failedSteps === 0 && pendingSteps.length === 0,
    durationMs: now - started,
    total,
    passed,
    failed,
    flaky,
    skipped,
    stepResults: finishedSteps,
    pendingSteps,
  };
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return 'unknown';
  }

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function relativeToRoot(targetPath) {
  const relativePath = path.relative(ROOT_DIR, path.resolve(targetPath));
  return toPosix(relativePath);
}

export function normalizeSuitePath(rawPath) {
  const normalized = toPosix(rawPath);
  if (!normalized.startsWith('/app/')) {
    // A spec the container lane reads from the repository mounts beside /app
    // — /scripts, /packages/shared/src (docker-compose.yml) — sits at the
    // container root under its own repository path, so the path minus the
    // leading slash is the checkout's path when the checkout has it.
    const mounted = normalized.slice(1);
    if (normalized.startsWith('/') && fs.existsSync(path.join(ROOT_DIR, mounted))) {
      return mounted;
    }
    return relativeToRoot(rawPath);
  }

  const suffix = normalized.slice('/app/'.length);
  const backendCandidate = path.join(ROOT_DIR, 'backend', suffix);
  if (fs.existsSync(backendCandidate)) {
    return toPosix(path.join('backend', suffix));
  }

  const frontendCandidate = path.join(ROOT_DIR, 'frontend', suffix);
  if (fs.existsSync(frontendCandidate)) {
    return toPosix(path.join('frontend', suffix));
  }

  return suffix;
}

function toPosix(targetPath) {
  return targetPath.split(path.sep).join('/');
}

function unique(values) {
  return Array.from(new Set(values));
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

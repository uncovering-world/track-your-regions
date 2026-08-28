#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLighthouseResults } from './lighthouse-summary.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, '.test-results');
const TEST_STACK_SCRIPT = path.join(ROOT_DIR, 'scripts', 'test-stack.sh');
const RUN_CONTAINER_TESTS = process.env.TEST_REPORT_LOCAL !== '1';

// `containerOnly` marks a lane that has no host-side shape at all. The
// variable is a documented idiom for the unit lanes (CLAUDE.md,
// CONTRIBUTING.md), and it used to reach these too: the branch above is
// global, so `TEST_REPORT_LOCAL=1 npm run test:e2e:smoke` skipped
// test-stack.sh and browsed whatever dev stack happened to be up, failing on
// the missing fixture with nothing naming the cause (#432). Such a lane is
// refused up front, with its reason, rather than running something else under
// the same name.
const E2E_CONTAINER_ONLY =
  'the specs browse the isolated stack seeded with world view 9001 '
  + '(backend/src/db/seed/e2eFixture.ts); on the host they browse whatever dev '
  + 'stack is up and fail on the fixture that is not there';
const PERF_CONTAINER_ONLY =
  'the lane measures a production build served inside the test stack, by the '
  + "stack's own pinned Chromium; no host-side shape of it produces comparable "
  + 'numbers';

fs.mkdirSync(RESULTS_DIR, { recursive: true });

const STEP_TEMPLATES = {
  'backend-unit': {
    id: 'backend-unit',
    label: 'Backend Unit/Integration',
    scope: 'backend/src/**/*.test.ts',
    kind: 'vitest',
    packageDir: 'backend',
    coverage: false,
  },
  'backend-coverage': {
    id: 'backend-coverage',
    label: 'Backend Coverage',
    scope: 'backend/src/**/*.test.ts + coverage',
    kind: 'vitest',
    packageDir: 'backend',
    coverage: true,
  },
  'frontend-unit': {
    id: 'frontend-unit',
    label: 'Frontend Unit/Integration',
    scope: 'frontend/src/**/*.test.{ts,tsx}',
    kind: 'vitest',
    packageDir: 'frontend',
    coverage: false,
  },
  'frontend-coverage': {
    id: 'frontend-coverage',
    label: 'Frontend Coverage',
    scope: 'frontend/src/**/*.test.{ts,tsx} + coverage',
    kind: 'vitest',
    packageDir: 'frontend',
    coverage: true,
  },
  'e2e-smoke': {
    id: 'e2e-smoke',
    label: 'Frontend E2E Smoke',
    scope: 'frontend/tests/e2e/**/*.spec.ts (project=smoke)',
    kind: 'playwright',
    packageDir: 'frontend',
    project: 'smoke',
    containerOnly: E2E_CONTAINER_ONLY,
  },
  'e2e-full': {
    id: 'e2e-full',
    label: 'Frontend E2E Full',
    scope: 'frontend/tests/e2e/**/*.spec.ts (project=full)',
    kind: 'playwright',
    packageDir: 'frontend',
    project: 'full',
    containerOnly: E2E_CONTAINER_ONLY,
  },
  perf: {
    id: 'perf',
    label: 'Frontend Performance (Lighthouse)',
    scope: 'frontend/perf/lighthouse-budgets.json (production build on the test stack)',
    kind: 'lighthouse',
    packageDir: 'frontend',
    // The stack's frontend must come up as a production build for this
    // step; the mode is decided when the stack is started (below), not by
    // the step, because a container already up in the other shape is left
    // alone by the step's own `up` (TEST_STACK_SKIP_UP).
    frontendMode: 'preview',
    containerOnly: PERF_CONTAINER_ONLY,
    // A "test" here is one assertion on one URL; the listed items are the
    // measured pages and the assertions that spoke.
    filesLabel: 'Pages',
    casesLabel: 'Assertions',
  },
};

const MODE_STEPS = {
  test: ['backend-unit', 'frontend-unit'],
  fast: ['backend-unit', 'frontend-unit'],
  coverage: ['backend-coverage', 'frontend-coverage'],
  'backend-unit': ['backend-unit'],
  'backend-coverage': ['backend-coverage'],
  'frontend-unit': ['frontend-unit'],
  'frontend-coverage': ['frontend-coverage'],
  'e2e-smoke': ['e2e-smoke'],
  'e2e-full': ['e2e-full'],
  perf: ['perf'],
};

const STEP_CONTAINER_COMMAND = {
  'backend-unit': 'run-backend-unit',
  'backend-coverage': 'run-backend-coverage',
  'frontend-unit': 'run-frontend-unit',
  'frontend-coverage': 'run-frontend-coverage',
  'e2e-smoke': 'run-e2e-smoke',
  'e2e-full': 'run-e2e-full',
  perf: 'run-perf',
};

const mode = process.argv[2] || 'test';
const selectedStepIds = MODE_STEPS[mode];

if (!selectedStepIds) {
  printError(
    `Unknown mode: ${mode}\nAvailable modes: ${Object.keys(MODE_STEPS).join(', ')}`,
  );
  process.exit(1);
}

const steps = selectedStepIds.map((stepId) => {
  const template = STEP_TEMPLATES[stepId];
  if (!template) {
    throw new Error(`Missing step template for "${stepId}"`);
  }
  return { ...template };
});

// Before anything is started: a lane with no host-side shape says so and
// stops, instead of taking the host branch and reporting a failure that
// describes the wrong stack.
if (!RUN_CONTAINER_TESTS) {
  const refused = steps.filter((step) => step.containerOnly);
  if (refused.length > 0) {
    printError(
      `TEST_REPORT_LOCAL=1 does not apply to mode "${mode}": the lanes below run only against the isolated test stack.`,
    );
    for (const step of refused) {
      printError(`  ${step.label}: ${step.containerOnly}.`);
    }
    printError(
      'Unset TEST_REPORT_LOCAL and re-run — the lane starts and seeds the stack itself (Docker required).',
    );
    process.exit(1);
  }
}

const startedAt = Date.now();
const stepResults = [];
let hadRunnerFailure = false;

// docker-compose.yml reads FRONTEND_MODE when the frontend container is
// created, so a mode a step needs has to reach the `up` that creates it.
// Unset means the dev server, which is what every other lane browses.
const stackEnv = steps.some((step) => step.frontendMode === 'preview')
  ? { FRONTEND_MODE: 'preview' }
  : {};

if (RUN_CONTAINER_TESTS) {
  printSectionHeader('Preparing Test Environment', 'Starting shared test services');
  const upExitCode = await runCommand(TEST_STACK_SCRIPT, ['up'], { cwd: ROOT_DIR, env: stackEnv });
  if (upExitCode !== 0) {
    printError('Failed to prepare test environment.');
    process.exit(upExitCode);
  }
}

for (let i = 0; i < steps.length; i += 1) {
  const step = steps[i];
  printSectionHeader(
    `Running ${step.label} (${i + 1}/${steps.length})`,
    `Scope: ${step.scope}`,
  );

  const result = await runStep(step, mode, i);
  stepResults.push(result);

  const status = result.ok ? 'PASS' : 'FAIL';
  printLine(`${status} ${step.label}`);

  if (!result.ok) {
    hadRunnerFailure = true;
    printLine('Stopping remaining steps due to test failure.');
    break;
  }
}

const summary = buildOverallSummary(mode, steps, stepResults, startedAt);
printOverallReport(summary);

if (RUN_CONTAINER_TESTS && process.env.TEST_REPORT_KEEP_ENV !== '1') {
  printSectionHeader('Cleaning Up', 'Stopping test services');
  await runCommand(TEST_STACK_SCRIPT, ['down'], { cwd: ROOT_DIR, env: {} });
}

process.exit(summary.ok && !hadRunnerFailure ? 0 : 1);

async function runStep(step, activeMode, index) {
  const token = `${Date.now()}-${index}-${Math.random().toString(16).slice(2, 10)}`;
  const jsonPath = path.join(RESULTS_DIR, `${activeMode}-${step.id}-${token}.json`);

  let command;
  let args;
  let env = {};
  let cwd = ROOT_DIR;

  if (RUN_CONTAINER_TESTS) {
    const stackCommand = STEP_CONTAINER_COMMAND[step.id];
    if (!stackCommand) {
      throw new Error(`No container command configured for step "${step.id}"`);
    }
    command = TEST_STACK_SCRIPT;
    args = [stackCommand, jsonPath];
    env = { ...stackEnv, TEST_STACK_SKIP_UP: '1' };
  } else {
    const packageCwd = path.join(ROOT_DIR, step.packageDir);
    cwd = packageCwd;
    if (step.kind === 'vitest') {
      command = resolveLocalBinary(step.packageDir, 'vitest');
      args = ['run', '--reporter=default', '--reporter=json', `--outputFile=${jsonPath}`];
      if (step.coverage) {
        args.push('--coverage');
      }
    } else {
      // Only the unit lanes have a host shape. The playwright and lighthouse
      // ones are `containerOnly` and were refused before anything started, so
      // there is deliberately no host arm for them to fall into: a branch
      // that quietly ran the wrong stack is what #432 was.
      throw new Error(`Unsupported step kind on the host: ${step.kind}`);
    }
  }

  const exitCode = await runCommand(command, args, { cwd, env });
  const parsed = parseStepReport(step, jsonPath);

  // `ok` after the spread, not before it: the parsed report carries its own
  // `ok`, and spread last it replaced this one - so a runner that exited
  // non-zero still printed PASS whenever the report file said so. The two
  // report files written fresh per run made that unreachable; a report that
  // survives from an earlier run does not.
  return {
    ...step,
    ...parsed,
    exitCode,
    ok: exitCode === 0 && parsed.ok,
    reportPath: jsonPath,
  };
}

function parseStepReport(step, jsonPath) {
  if (step.kind === 'vitest') {
    return parseVitestReport(jsonPath);
  }
  if (step.kind === 'lighthouse') {
    return parseLighthouseResults({
      assertionResultsPath: jsonPath,
      reportDir: path.join(ROOT_DIR, step.packageDir, 'lighthouse-report'),
    });
  }
  return parsePlaywrightReport(jsonPath);
}

function resolveLocalBinary(packageDir, binName) {
  const bin =
    process.platform === 'win32'
      ? `${binName}.cmd`
      : binName;
  const fullPath = path.join(ROOT_DIR, packageDir, 'node_modules', '.bin', bin);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Required binary not found: ${fullPath}\nRun npm install in "${packageDir}" first.`,
    );
  }
  return fullPath;
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function parseVitestReport(filePath) {
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

function parsePlaywrightReport(filePath) {
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
    return { ...empty, parseError: `Missing Playwright report: ${filePath}` };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const suites = Array.isArray(data.suites) ? data.suites : [];
    const stats = data.stats || {};
    const collected = [];

    for (const suite of suites) {
      collectPlaywrightCases(suite, [], collected);
    }

    const files = unique(
      collected
        .map((item) => item.file)
        .filter(Boolean)
        .map((file) => `frontend/tests/e2e/${file}`),
    );
    const cases = unique(
      collected.map((item) => {
        const filePathWithRoot = `frontend/tests/e2e/${item.file}`;
        return `${filePathWithRoot} :: ${item.title}`;
      }),
    );

    const expected = asNumber(stats.expected, 0);
    const unexpected = asNumber(stats.unexpected, 0);
    const flaky = asNumber(stats.flaky, 0);
    const skipped = asNumber(stats.skipped, 0);
    const total = expected + unexpected + flaky + skipped;
    const failed = unexpected + flaky;
    // `expected > 0` — Playwright's count of specs that ran and passed.
    //
    // Unlike the Vitest twin this closes a reachable hole, not a theoretical
    // one. Measured: a suite whose specs are all skipped reports
    // `expected: 0, skipped: 2` and Playwright exits **0**, so both of the
    // other locks pass — the exit code is clean and `total` (which counts
    // skipped) is non-zero. The verdict has to rest on specs that actually
    // ran.
    //
    // The route in is ordinary: the smoke suite selects by the `@smoke` tag,
    // and a `test.skip()` guard on a missing fixture or environment skips
    // rather than fails by design.
    const ok = failed === 0 && expected > 0;

    return {
      ok,
      total,
      passed: expected,
      failed,
      skipped,
      files,
      cases,
      parseError: null,
    };
  } catch (error) {
    return {
      ...empty,
      parseError: `Invalid Playwright JSON report (${filePath}): ${error.message}`,
    };
  }
}

function collectPlaywrightCases(suite, parentTitles, output) {
  const title = typeof suite?.title === 'string' ? suite.title.trim() : '';
  const isLikelyFileNode =
    title.endsWith('.spec.ts') || title.endsWith('.test.ts') || title.endsWith('.test.tsx');
  const nextParents =
    title && !isLikelyFileNode ? [...parentTitles, title] : parentTitles;

  const specs = Array.isArray(suite?.specs) ? suite.specs : [];
  for (const spec of specs) {
    const parts = [...nextParents, spec.title].filter(Boolean);
    output.push({
      file: spec.file || suite.file || 'unknown',
      title: parts.join(' > '),
    });
  }

  const nestedSuites = Array.isArray(suite?.suites) ? suite.suites : [];
  for (const nested of nestedSuites) {
    collectPlaywrightCases(nested, nextParents, output);
  }
}

function buildOverallSummary(activeMode, allSteps, finishedSteps, started) {
  const total = sum(finishedSteps.map((step) => step.total));
  const passed = sum(finishedSteps.map((step) => step.passed));
  const failed = sum(finishedSteps.map((step) => step.failed));
  const skipped = sum(finishedSteps.map((step) => step.skipped));
  const failedSteps = finishedSteps.filter((step) => !step.ok).length;
  const pendingSteps = allSteps.slice(finishedSteps.length).map((step) => step.label);

  return {
    mode: activeMode,
    ok: failed === 0 && failedSteps === 0 && pendingSteps.length === 0,
    durationMs: Date.now() - started,
    total,
    passed,
    failed,
    skipped,
    stepResults: finishedSteps,
    pendingSteps,
  };
}

function printOverallReport(summary) {
  printSectionHeader('Overall Test Report', `Mode: ${summary.mode}`);
  printLine(`Overall Result: ${summary.ok ? 'PASS' : 'FAIL'}`);
  printLine(`Duration: ${formatDuration(summary.durationMs)}`);
  printLine(
    `Totals: ${summary.total} tests | ${summary.passed} passed | ${summary.failed} failed | ${summary.skipped} skipped`,
  );

  for (const step of summary.stepResults) {
    printLine('');
    printLine(`${step.ok ? '[PASS]' : '[FAIL]'} ${step.label}`);
    printLine(`Scope: ${step.scope}`);
    printLine(
      `Result: ${step.total} tests | ${step.passed} passed | ${step.failed} failed | ${step.skipped} skipped`,
    );
    if (step.note) {
      printLine(step.note);
    }

    if (step.parseError) {
      printLine(`Report parse error: ${step.parseError}`);
    } else {
      printLimitedList(step.filesLabel || 'Test files', step.files, 20);
      printLimitedList(step.casesLabel || 'Test cases', step.cases, 30);
    }
  }

  if (summary.pendingSteps.length > 0) {
    printLine('');
    printLine(`Not executed due to earlier failure: ${summary.pendingSteps.join(', ')}`);
  }
}

function printLimitedList(label, values, limit) {
  if (!values || values.length === 0) {
    printLine(`${label}: none`);
    return;
  }

  const shown = values.slice(0, limit);
  printLine(`${label} (${values.length}):`);
  for (const value of shown) {
    printLine(`  - ${value}`);
  }
  if (values.length > shown.length) {
    printLine(`  - ... and ${values.length - shown.length} more`);
  }
}

function formatDuration(ms) {
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

function normalizeSuitePath(rawPath) {
  const normalized = toPosix(rawPath);
  if (!normalized.startsWith('/app/')) {
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

function printSectionHeader(title, subtitle) {
  printLine('');
  printLine('========================================');
  printLine(title);
  if (subtitle) {
    printLine(subtitle);
  }
  printLine('========================================');
}

function printLine(message) {
  process.stdout.write(`${message}\n`);
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}

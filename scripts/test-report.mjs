#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLighthouseResults } from './lighthouse-summary.mjs';
import { parsePlaywrightResults } from './playwright-summary.mjs';
import { buildOverallSummary, formatDuration, parseVitestReport } from './test-report-summary.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT_DIR, '.test-results');
const TEST_STACK_SCRIPT = path.join(ROOT_DIR, 'scripts', 'test-stack.sh');
const RUN_CONTAINER_TESTS = process.env.TEST_REPORT_LOCAL !== '1';

// `containerOnly` marks a lane that has no host-side shape at all. The
// variable is a documented idiom for the unit lanes (CLAUDE.md,
// CONTRIBUTING.md), and the branch above is global, so without this mark
// `TEST_REPORT_LOCAL=1 npm run test:e2e:smoke` would skip
// test-stack.sh and browse whatever dev stack happened to be up, failing on
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
// The database-backed specs (#522) execute statements and assert on the rows
// they selected, so they build and tear down rows in whatever database the
// backend points at — and on the host backend/src/db/index.ts points at the
// developer's own catalogue when nothing is set. Inside the stack that is
// track_regions_test, and the lane's global setup refuses any other name.
const DB_CONTAINER_ONLY =
  'the specs write rows into whatever database the backend points at, and on '
  + 'the host that is the dev catalogue (backend/src/db/index.ts); the lane runs '
  + 'only inside the isolated test stack, against track_regions_test';

fs.mkdirSync(RESULTS_DIR, { recursive: true });

const STEP_TEMPLATES = {
  'backend-unit': {
    id: 'backend-unit',
    label: 'Backend Unit/Integration',
    scope: 'backend/src/**/*.test.ts + scripts/**/*.test.mjs + packages/shared/src/**/*.test.ts',
    kind: 'vitest',
    packageDir: 'backend',
    coverage: false,
  },
  'backend-coverage': {
    id: 'backend-coverage',
    label: 'Backend Coverage',
    scope: 'backend/src/**/*.test.ts + scripts/**/*.test.mjs + packages/shared/src/**/*.test.ts + coverage',
    kind: 'vitest',
    packageDir: 'backend',
    coverage: true,
  },
  'backend-db': {
    id: 'backend-db',
    label: 'Backend Database (a real Postgres, not the mocked pool)',
    scope: 'backend/src/**/*.db.test.ts (inside the test stack, against track_regions_test)',
    kind: 'vitest',
    packageDir: 'backend',
    coverage: false,
    containerOnly: DB_CONTAINER_ONLY,
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
  'backend-db': ['backend-db'],
  'frontend-unit': ['frontend-unit'],
  'frontend-coverage': ['frontend-coverage'],
  'e2e-smoke': ['e2e-smoke'],
  'e2e-full': ['e2e-full'],
  perf: ['perf'],
};

const STEP_CONTAINER_COMMAND = {
  'backend-unit': 'run-backend-unit',
  'backend-coverage': 'run-backend-coverage',
  'backend-db': 'run-backend-db',
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
// The performance lane always measures the build; any other lane browses the
// dev server unless FRONTEND_MODE=preview is set for the run, which is how CI
// runs the smoke lane on the build a visitor gets (#654,
// docs/tech/development-guide.md § The shape the smoke lane browses).
const frontendMode = steps.some((step) => step.frontendMode === 'preview')
  || process.env.FRONTEND_MODE === 'preview'
  ? 'preview'
  : 'dev';
const stackEnv = { FRONTEND_MODE: frontendMode };

if (RUN_CONTAINER_TESTS) {
  printSectionHeader(
    'Preparing Test Environment',
    `Starting shared test services (frontend: ${frontendMode === 'preview' ? 'the production build' : 'the dev server'})`,
  );
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

  // The affected selection (scripts/affected-specs.mjs): the paths to hand
  // `vitest related`, set by `gates.mjs run test --affected`. Only the host
  // shape can take it; the container lane runs whole and says so.
  const related = relatedTargets();
  if (related && RUN_CONTAINER_TESTS) {
    console.log(`${step.label}: the container shape runs the whole lane; the affected selection needs TEST_REPORT_LOCAL=1.`);
  }

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
      args = related && !step.coverage
        ? ['related', ...related, '--run', '--passWithNoTests']
        : ['run'];
      args.push('--reporter=default', '--reporter=json', `--outputFile=${jsonPath}`);
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
  const selected = related && !RUN_CONTAINER_TESTS && step.kind === 'vitest' && !step.coverage;
  if (selected) {
    const total = process.env.TEST_REPORT_SPEC_TOTAL;
    console.log(`${step.label}: ran ${parsed.files.length}${total ? ` of ${total}` : ''} spec files, the affected selection.`);
  }
  // A selection no spec of the lane imports is an answer, not a failure: the
  // change reaches none of them. Said as such, so an empty run never reads as
  // a lane that passed its specs.
  if (selected && exitCode === 0 && !parsed.parseError && parsed.files.length === 0) {
    console.log(`${step.label}: no spec of the lane reaches the change.`);
    return { ...step, ...parsed, exitCode, ok: true, reportPath: jsonPath };
  }

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
  return parsePlaywrightResults(jsonPath);
}

/** The affected selection's targets, or null for a whole lane. */
function relatedTargets() {
  const raw = process.env.TEST_REPORT_RELATED;
  if (!raw) return null;
  const targets = JSON.parse(raw);
  if (!Array.isArray(targets) || targets.some((target) => typeof target !== 'string')) {
    throw new Error('TEST_REPORT_RELATED must be a JSON array of paths.');
  }
  return targets;
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

function printOverallReport(summary) {
  printSectionHeader('Overall Test Report', `Mode: ${summary.mode}`);
  printLine(`Overall Result: ${summary.ok ? 'PASS' : 'FAIL'}`);
  printLine(`Duration: ${formatDuration(summary.durationMs)}`);
  printLine(
    `Totals: ${summary.total} tests | ${summary.passed} passed | ${summary.flaky} flaky | ${summary.failed} failed | ${summary.skipped} skipped`,
  );
  if (summary.flaky > 0) {
    // The run is green and something still needs saying: a retry hid a
    // failure that will come back. The listed specs below name which, and the
    // attempt's trace, screenshot and video are in frontend/test-results
    // (CI keeps both directories as the `playwright-report` artifact).
    printLine(
      `Flaky: ${summary.flaky} passed on retry — green, but the first attempt failed. See frontend/playwright-report.`,
    );
  }

  for (const step of summary.stepResults) {
    printLine('');
    printLine(`${step.ok ? '[PASS]' : '[FAIL]'} ${step.label}`);
    printLine(`Scope: ${step.scope}`);
    printLine(
      `Result: ${step.total} tests | ${step.passed} passed | ${step.flaky ?? 0} flaky | ${step.failed} failed | ${step.skipped} skipped`,
    );
    if (step.note) {
      printLine(step.note);
    }

    if (step.parseError) {
      printLine(`Report parse error: ${step.parseError}`);
    } else {
      printLimitedList(step.filesLabel || 'Test files', step.files, 20);
      printLimitedList(step.casesLabel || 'Test cases', step.cases, 30);
      if (step.flakyCases && step.flakyCases.length > 0) {
        printLimitedList('Flaky (passed on retry)', step.flakyCases, 30);
      }
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

/**
 * Turns one Playwright run into the shape scripts/test-report.mjs prints for
 * every lane: counts, the spec files that ran, one line per test case — and,
 * separately from both passes and failures, the specs that needed a retry.
 *
 * Input is the JSON reporter's output, copied out of the e2e container by
 * scripts/test-stack.sh to the caller's path.
 *
 * **A spec that passes on retry is flaky, not failed** (#447). Playwright
 * itself says so — `stats.flaky` is a category of its own and the process
 * exits 0 — and this file is where that had been overridden: counting flaky
 * as failed turned "the box was busy" into a red pre-push gate, and truncated
 * the rest of the lane behind it. A flake is loud instead: named here, printed
 * on its own line, and the failed attempt's trace kept by the CI job.
 *
 * Extracted from test-report.mjs so the verdict can be tested without running
 * a suite (frontend/tests/playwright-summary.test.mjs), the way
 * lighthouse-summary.mjs is.
 */

import fs from 'node:fs';

export function parsePlaywrightResults(filePath) {
  const empty = {
    ok: false,
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    files: [],
    cases: [],
    flakyCases: [],
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
    const cases = unique(collected.map(caseLabel));
    const flakyCases = unique(collected.filter((item) => item.flaky).map(caseLabel));

    const expected = asNumber(stats.expected, 0);
    const unexpected = asNumber(stats.unexpected, 0);
    const flaky = asNumber(stats.flaky, 0);
    const skipped = asNumber(stats.skipped, 0);
    const total = expected + unexpected + flaky + skipped;
    // `expected + flaky > 0` — Playwright's count of specs that ran and ended
    // green, first attempt or second.
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
    const ok = unexpected === 0 && expected + flaky > 0;

    return {
      ok,
      total,
      passed: expected,
      failed: unexpected,
      flaky,
      skipped,
      files,
      cases,
      flakyCases,
      parseError: null,
    };
  } catch (error) {
    return {
      ...empty,
      parseError: `Invalid Playwright JSON report (${filePath}): ${error.message}`,
    };
  }
}

function caseLabel(item) {
  return `frontend/tests/e2e/${item.file} :: ${item.title}`;
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
    const tests = Array.isArray(spec?.tests) ? spec.tests : [];
    output.push({
      file: spec.file || suite.file || 'unknown',
      title: parts.join(' > '),
      // Per spec, so the report can name the one that flaked. `stats.flaky`
      // only ever says how many did.
      flaky: tests.some((test) => test?.status === 'flaky'),
    });
  }

  const nestedSuites = Array.isArray(suite?.suites) ? suite.suites : [];
  for (const nested of nestedSuites) {
    collectPlaywrightCases(nested, nextParents, output);
  }
}

function unique(values) {
  return Array.from(new Set(values));
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Turns one Playwright run into the shape scripts/test-report.mjs prints for
 * every lane: counts, the spec files that ran, one line per test case.
 *
 * Input is the JSON reporter's output, copied out of the e2e container by
 * scripts/test-stack.sh to the caller's path.
 *
 * Lives beside lighthouse-summary.mjs, and for the same reason: what a run
 * means is a rule, and a rule that sits inside a script which starts
 * containers on import cannot be put a question without running a suite.
 */

import fs from 'node:fs';

export function parsePlaywrightResults(filePath) {
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

function unique(values) {
  return Array.from(new Set(values));
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

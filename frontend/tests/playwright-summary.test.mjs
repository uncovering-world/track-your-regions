import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlaywrightResults } from '../../scripts/playwright-summary.mjs';

const SPEC_FILE = 'smoke/explore-workflows.smoke.spec.ts';
const paths = [];

/**
 * One JSON report in the shape Playwright's json reporter writes: a file-level
 * suite, a describe inside it, and one spec per test. Modelled on a real
 * smoke-lane report, not on the documentation — the parser reads `stats` for
 * the counts and the spec tree for the names, and both have to be the real
 * thing for the test to mean anything.
 */
function report({ specs, stats }) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-summary-')), 'report.json');
  paths.push(file);
  fs.writeFileSync(
    file,
    JSON.stringify({
      config: {},
      errors: [],
      suites: [
        {
          title: SPEC_FILE,
          file: SPEC_FILE,
          suites: [
            {
              title: 'Explore Workflows @smoke',
              file: SPEC_FILE,
              specs: specs.map(({ title, status }) => ({
                title,
                ok: status !== 'unexpected',
                file: SPEC_FILE,
                tests: [{ status, results: [] }],
              })),
            },
          ],
        },
      ],
      stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0, ...stats },
    }),
  );
  return file;
}

afterEach(() => {
  for (const file of paths.splice(0)) {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

describe('parsePlaywrightResults', () => {
  it('passes a clean run and names every spec that ran', () => {
    const result = parsePlaywrightResults(
      report({
        specs: [
          { title: 'map mode can open and close region explore panel', status: 'expected' },
          { title: 'discover mode opens source workflow from region source tag', status: 'expected' },
        ],
        stats: { expected: 2 },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ total: 2, passed: 2, flaky: 0, failed: 0, skipped: 0 });
    expect(result.files).toEqual([`frontend/tests/e2e/${SPEC_FILE}`]);
    expect(result.cases).toHaveLength(2);
    expect(result.flakyCases).toEqual([]);
  });

  // The defect this file exists for (#447): the gate read Playwright's own
  // `1 flaky, 5 passed` as a failure, so a slow box blocked a push and
  // truncated the lane behind it.
  it('reports a spec that passed on retry as flaky, and still passes the run', () => {
    const result = parsePlaywrightResults(
      report({
        specs: [
          { title: 'map mode can open and close region explore panel', status: 'flaky' },
          { title: 'discover mode opens source workflow from region source tag', status: 'expected' },
        ],
        stats: { expected: 1, flaky: 1 },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ total: 2, passed: 1, flaky: 1, failed: 0 });
    expect(result.flakyCases).toEqual([
      `frontend/tests/e2e/${SPEC_FILE} :: Explore Workflows @smoke > map mode can open and close region explore panel`,
    ]);
  });

  it('fails a run with a spec that never passed', () => {
    const result = parsePlaywrightResults(
      report({
        specs: [
          { title: 'map mode can open and close region explore panel', status: 'unexpected' },
          { title: 'discover mode opens source workflow from region source tag', status: 'flaky' },
        ],
        stats: { expected: 0, unexpected: 1, flaky: 1 },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ passed: 0, flaky: 1, failed: 1 });
  });

  // Playwright exits 0 for a suite that only skipped, so the verdict cannot
  // rest on the exit code or on a non-zero total.
  it('fails a run where nothing actually ran', () => {
    const result = parsePlaywrightResults(
      report({
        specs: [{ title: 'map mode can open and close region explore panel', status: 'skipped' }],
        stats: { skipped: 1 },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ total: 1, passed: 0, flaky: 0, failed: 0, skipped: 1 });
  });

  it('fails, with the path, when the report was never written', () => {
    const missing = path.join(os.tmpdir(), 'playwright-summary-absent', 'report.json');
    const result = parsePlaywrightResults(missing);

    expect(result.ok).toBe(false);
    expect(result.parseError).toContain(missing);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOverallSummary, formatDuration, normalizeSuitePath, parseVitestReport } from './test-report-summary.mjs';

/** A Vitest JSON report, written where the parser will read it. */
const dirs = [];
function report(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tyr-test-report-'));
  dirs.push(dir);
  const file = path.join(dir, 'vitest.json');
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const SPEC = '/app/src/middleware/cors.test.ts';
const passing = {
  success: true, numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ name: SPEC, assertionResults: [{ fullName: 'apiCors answers a preflight' }, { title: 'names one origin' }] }],
};

describe('a Vitest report, read (#655)', () => {
  it('counts what ran and names every case under its spec, as the checkout names it', () => {
    const parsed = parseVitestReport(report(passing));

    expect(parsed).toMatchObject({ ok: true, total: 2, passed: 2, failed: 0, skipped: 0, parseError: null });
    expect(parsed.files).toEqual(['backend/src/middleware/cors.test.ts']);
    expect(parsed.cases).toEqual([
      'backend/src/middleware/cors.test.ts :: apiCors answers a preflight',
      'backend/src/middleware/cors.test.ts :: names one origin',
    ]);
  });

  it('is not ok when a test failed, whatever the report says of itself', () => {
    expect(parseVitestReport(report({ ...passing, numPassedTests: 1, numFailedTests: 1 })).ok).toBe(false);
  });

  it('is not ok when nothing ran, even with every test merely skipped', () => {
    const skippedOnly = { ...passing, numPassedTests: 0, numPendingTests: 1, numTodoTests: 1 };
    expect(parseVitestReport(report(skippedOnly))).toMatchObject({ ok: false, skipped: 2 });
  });

  it('says a report is missing or unreadable rather than reading it as a pass', () => {
    expect(parseVitestReport('/nonexistent/vitest.json')).toMatchObject({ ok: false, parseError: expect.stringMatching(/^Missing Vitest report/) });
    expect(parseVitestReport(report('{ not json'))).toMatchObject({ ok: false, parseError: expect.stringMatching(/^Invalid Vitest JSON report/) });
  });
});

describe("a container's spec path, read back (#655)", () => {
  it('maps /app/ to the package that holds the file, and keeps a mounted repository path', () => {
    expect(normalizeSuitePath('/app/src/middleware/cors.test.ts')).toBe('backend/src/middleware/cors.test.ts');
    expect(normalizeSuitePath('/app/src/hooks/useDocumentTitle.test.ts')).toBe('frontend/src/hooks/useDocumentTitle.test.ts');
    expect(normalizeSuitePath('/scripts/gates.test.mjs')).toBe('scripts/gates.test.mjs');
  });
});

describe('the summary over a run (#655)', () => {
  const step = (over) => ({ label: 'Backend Unit', ok: true, total: 3, passed: 3, failed: 0, skipped: 0, ...over });

  it('adds up the steps and passes a run whose steps all passed', () => {
    const steps = [step(), step({ label: 'Frontend Unit', total: 2, passed: 1, skipped: 1, flaky: 1 })];
    expect(buildOverallSummary('test', steps, steps, 1000, 4000)).toMatchObject({
      mode: 'test', ok: true, durationMs: 3000, total: 5, passed: 4, failed: 0, flaky: 1, skipped: 1, pendingSteps: [],
    });
  });

  it('fails a run with a failed step, or with a step that never finished', () => {
    const failedStep = [step({ ok: false })];
    expect(buildOverallSummary('test', failedStep, failedStep, 0, 0).ok).toBe(false);
    const all = [step(), step({ label: 'Frontend Unit' })];
    expect(buildOverallSummary('test', all, all.slice(0, 1), 0, 0)).toMatchObject({ ok: false, pendingSteps: ['Frontend Unit'] });
  });

  it('formats a duration in minutes and seconds, and says when it cannot', () => {
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(-1)).toBe('unknown');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLighthouseResults } from '../../scripts/lighthouse-summary.mjs';

const URL = 'http://frontend:5173/?wv=9001';
const dirs = [];

function reportDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lighthouse-summary-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseLighthouseResults', () => {
  it('counts errors as failures, warns as skipped, and prints each in its own unit', () => {
    const dir = reportDir({
      'assertion-results.json': [
        { url: URL, auditId: 'resource-summary', auditProperty: 'total:count', level: 'error', operator: '<=', expected: 60, actual: 61, passed: false },
        { url: URL, auditId: 'resource-summary', auditProperty: 'script:size', level: 'error', operator: '<=', expected: 825000, actual: 782659, passed: true },
        { url: URL, auditId: 'largest-contentful-paint', level: 'warn', operator: '<=', expected: 2000, actual: 2150, passed: false },
        { url: URL, auditId: 'categories:performance', level: 'warn', operator: '>=', expected: 0.8, actual: 0.94, passed: true },
      ],
      'manifest.json': [
        { url: URL, isRepresentativeRun: true, jsonPath: '/app/lighthouse-report/root-wv-9001-run2.report.json', summary: { performance: 0.94 } },
      ],
      'root-wv-9001-run2.report.json': {
        audits: {
          'largest-contentful-paint': { numericValue: 2150 },
          'resource-summary': { details: { items: [{ resourceType: 'total', transferSize: 912327 }, { resourceType: 'script', transferSize: 782659 }] } },
        },
      },
    });

    const result = parseLighthouseResults({ assertionResultsPath: path.join(dir, 'assertion-results.json'), reportDir: dir });

    expect(result.ok).toBe(false);
    expect([result.total, result.passed, result.failed, result.skipped]).toEqual([4, 2, 1, 1]);
    expect(result.note).toMatch(/^1 budget\(s\) at warn level are over/);
    expect(result.cases).toEqual([
      '[error] resource-summary:total:count on /?wv=9001: 61 requests (<= 60 requests)',
      '[warn] largest-contentful-paint on /?wv=9001: 2.15 s (<= 2.00 s)',
    ]);
    expect(result.files).toEqual(['/?wv=9001 - perf 94 | LCP 2.15 s | script 782.7 kB | total 912.3 kB']);
  });

  it('reports a missing or unreadable results file as a failure, not an empty pass', () => {
    const dir = reportDir({});
    const missing = parseLighthouseResults({ assertionResultsPath: path.join(dir, 'assertion-results.json'), reportDir: dir });
    expect(missing.ok).toBe(false);
    expect(missing.parseError).toMatch(/Missing Lighthouse assertion results/);

    fs.writeFileSync(path.join(dir, 'assertion-results.json'), '');
    const empty = parseLighthouseResults({ assertionResultsPath: path.join(dir, 'assertion-results.json'), reportDir: dir });
    expect(empty.ok).toBe(false);
    expect(empty.parseError).toMatch(/Unreadable Lighthouse assertion results/);

    // A well-formed file with nothing in it is a lane that judged nothing,
    // which the sibling lanes also refuse to call a pass.
    fs.writeFileSync(path.join(dir, 'assertion-results.json'), '[]');
    const none = parseLighthouseResults({ assertionResultsPath: path.join(dir, 'assertion-results.json'), reportDir: dir });
    expect(none.ok).toBe(false);
    expect(none.parseError).toMatch(/empty - no budget was judged/);
  });
});

/**
 * Turns one run of the performance lane into the shape scripts/test-report.mjs
 * prints for every lane: counts, one line per measured page, one line per
 * assertion that spoke.
 *
 * Inputs are what frontend/perf/lighthouse.mjs leaves in the bind-mounted
 * lighthouse-report/ directory, in Lighthouse CI's file shapes:
 *   - assertion-results.json, one row per budget per page (copied out of
 *     the e2e container by scripts/test-stack.sh to the caller's path);
 *   - manifest.json, which names the representative run per URL and where
 *     its full report lives.
 *
 * A "test" here is one assertion on one URL. Warnings are reported but do
 * not count as failures - that is the level's meaning in
 * frontend/perf/lighthouse-budgets.json.
 */

import fs from 'node:fs';
import path from 'node:path';

const METRIC_AUDITS = [
  ['largest-contentful-paint', 'LCP', formatMs],
  ['total-blocking-time', 'TBT', formatMs],
  ['cumulative-layout-shift', 'CLS', (v) => v.toFixed(3)],
  ['interactive', 'TTI', formatMs],
];

export function parseLighthouseResults({ assertionResultsPath, reportDir }) {
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

  if (!fs.existsSync(assertionResultsPath)) {
    return { ...empty, parseError: `Missing Lighthouse assertion results: ${assertionResultsPath}` };
  }

  let assertions;
  try {
    assertions = JSON.parse(fs.readFileSync(assertionResultsPath, 'utf8'));
  } catch (error) {
    return { ...empty, parseError: `Unreadable Lighthouse assertion results: ${error.message}` };
  }
  if (!Array.isArray(assertions)) {
    return { ...empty, parseError: 'Lighthouse assertion results are not a list' };
  }
  // No assertions means nothing was judged - a budgets file with an empty
  // block, or a run that wrote its results before reading a single one. The
  // sibling parsers treat zero tests the same way: a lane that asserted
  // nothing has not passed.
  if (assertions.length === 0) {
    return { ...empty, parseError: 'Lighthouse assertion results are empty - no budget was judged' };
  }

  // Only the literal "warn" is a warning; a breached budget at any other
  // level is a failure, so a level the runner did not validate can never
  // read as a pass here.
  const failures = assertions.filter((a) => !a.passed && a.level !== 'warn');
  const warnings = assertions.filter((a) => !a.passed && a.level === 'warn');
  const cases = [...failures, ...warnings].map(describeAssertion);

  return {
    ...empty,
    ok: failures.length === 0,
    total: assertions.length,
    passed: assertions.length - failures.length - warnings.length,
    failed: failures.length,
    // A breached warn-level budget is neither passed nor failed; the
    // counts line has no other column for it, so the note says what the
    // number means before a reader skims past it.
    skipped: warnings.length,
    note:
      warnings.length > 0
        ? `${warnings.length} budget(s) at warn level are over - counted as skipped above, listed below, never a failure`
        : null,
    files: describePages(reportDir),
    cases,
  };
}

function describeAssertion(assertion) {
  const page = pathOf(assertion.url);
  const property = assertion.auditProperty ? `:${assertion.auditProperty}` : '';
  const expected = formatValue(assertion, assertion.expected);
  const actual = formatValue(assertion, assertion.actual);
  return `[${assertion.level}] ${assertion.auditId}${property} on ${page}: ${actual} (${assertion.operator} ${expected})`;
}

/** One line per URL, from the representative run's full report. */
function describePages(reportDir) {
  const manifestPath = path.join(reportDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(manifest)) {
    return [];
  }

  return manifest
    .filter((entry) => entry.isRepresentativeRun)
    .map((entry) => {
      const score = entry.summary?.performance;
      const parts = [`perf ${Number.isFinite(score) ? Math.round(score * 100) : '?'}`];
      const lhr = readReport(reportDir, entry.jsonPath);
      if (lhr) {
        for (const [auditId, label, format] of METRIC_AUDITS) {
          const value = lhr.audits?.[auditId]?.numericValue;
          if (Number.isFinite(value)) {
            parts.push(`${label} ${format(value)}`);
          }
        }
        const script = resourceBytes(lhr, 'script');
        const total = resourceBytes(lhr, 'total');
        if (script !== null) parts.push(`script ${formatBytes(script)}`);
        if (total !== null) parts.push(`total ${formatBytes(total)}`);
      }
      return `${pathOf(entry.url)} - ${parts.join(' | ')}`;
    });
}

/**
 * The manifest records the container's absolute path (/app/lighthouse-report/...);
 * on the host the same file sits under reportDir, so only the basename is
 * trusted.
 */
function readReport(reportDir, jsonPath) {
  if (typeof jsonPath !== 'string' || jsonPath.length === 0) {
    return null;
  }
  const hostPath = path.join(reportDir, path.basename(jsonPath));
  try {
    return JSON.parse(fs.readFileSync(hostPath, 'utf8'));
  } catch {
    return null;
  }
}

function resourceBytes(lhr, resourceType) {
  const items = lhr.audits?.['resource-summary']?.details?.items;
  if (!Array.isArray(items)) {
    return null;
  }
  const row = items.find((item) => item.resourceType === resourceType);
  return row && Number.isFinite(row.transferSize) ? row.transferSize : null;
}

/**
 * A resource-summary row is bytes for `<type>:size` and a request count for
 * `<type>:count`; the unit follows the property, not the audit.
 */
function formatValue({ auditId, auditProperty }, value) {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (auditId.startsWith('resource-summary')) {
    return auditProperty?.endsWith(':count') ? `${value} requests` : formatBytes(value);
  }
  if (auditId.startsWith('categories:')) {
    return value.toFixed(2);
  }
  if (auditId === 'cumulative-layout-shift') {
    return value.toFixed(3);
  }
  return formatMs(value);
}

function formatMs(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function formatBytes(value) {
  return `${(value / 1000).toFixed(1)} kB`;
}

function pathOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return String(url);
  }
}

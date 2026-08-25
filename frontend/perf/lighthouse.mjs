#!/usr/bin/env node
/**
 * The performance lane's runner: Lighthouse against each page in
 * lighthouse-budgets.json, several runs per page, the median run kept and
 * judged against the budgets there. Started by scripts/test-stack.sh inside
 * the e2e container (`npm run lighthouse`), where the pages, the backend and
 * the tile server all answer on the compose network.
 *
 * Lighthouse is driven through its Node API rather than Lighthouse CI: the
 * CI package pins a year-old Lighthouse whose dependency tree carried nine
 * high-severity advisories at the time of writing, for a feature set this
 * lane needs a small part of - N runs, a median, a handful of assertions,
 * reports on disk. What it writes keeps Lighthouse CI's shapes
 * (manifest.json, assertion-results.json) so the summary printer and anyone
 * used to that tool read it unchanged.
 *
 *   node perf/lighthouse.mjs [budgets.json]
 *
 * CHROME_PATH names the browser; unset, chrome-launcher looks for one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse, { desktopConfig } from 'lighthouse';
import { computeMedianRun, filterToValidRuns } from 'lighthouse/core/lib/median-run.js';
import { launch } from 'chrome-launcher';
import { evaluateAssertions, hasFailures, validateAssertions } from './assertions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const budgetsPath = path.resolve(process.argv[2] ?? path.join(here, 'lighthouse-budgets.json'));
const budgets = JSON.parse(fs.readFileSync(budgetsPath, 'utf8'));
const outputDir = path.resolve(here, '..', budgets.outputDir ?? 'lighthouse-report');
const runsPerUrl = Number(budgets.runs ?? 3);
// The world view the pages name. The budgets file carries the one its
// baseline was measured on; PERF_WORLD_VIEW (set by scripts/perf-local.sh
// from --world-view) names another database's. Substituted into every
// `{worldView}` in the URLs and in expectRequestMatching.
const worldView = String(process.env.PERF_WORLD_VIEW ?? budgets.worldView ?? '');
// Likewise the port: the dev stack maps the frontend wherever .env says
// (scripts/perf-local.sh exports FRONTEND_PORT from it); the budgets file
// carries the default. The CI budgets name the in-network port, which no
// .env moves, and use no placeholder.
const port = String(process.env.FRONTEND_PORT ?? budgets.port ?? '5173');
const fill = (text) => text.replaceAll('{worldView}', worldView).replaceAll('{port}', port);
const urls = (budgets.urls ?? []).map(fill);
// A page can load and still not be the page the budgets were set on: an id
// the visitor cannot see falls back to the default world view without a
// word - after one request for it that answers 404. So the representative
// run must have made a request containing this fragment that was answered
// 2xx; a request alone proves nothing.
const expectRequestMatching = budgets.expectRequestMatching ? fill(budgets.expectRequestMatching) : null;
const assertions = budgets.assertions;
// A lane that could not gate must not run, let alone pass: no budgets (the
// likely cause is a file shaped like a real lighthouserc, whose assertions
// sit under `ci.assert.assertions` - this runner reads them at the root), a
// mistyped level, a threshold that is not a number.
try {
  validateAssertions(assertions);
} catch (error) {
  throw new Error(`${path.relative(process.cwd(), budgetsPath)}: ${error.message}`);
}

resetOutputDir(outputDir);
await assertProductionBuild(urls[0]);

const manifest = [];
const assertionResults = [];

const chrome = await launch({
  chromeFlags: budgets.chromeFlags ?? ['--headless=new'],
  chromePath: process.env.CHROME_PATH,
});
try {
  for (const url of urls) {
    const runs = [];
    for (let i = 1; i <= runsPerUrl; i += 1) {
      const result = await lighthouse(
        url,
        { port: chrome.port, output: ['json', 'html'], onlyCategories: ['performance'], logLevel: 'error' },
        desktopConfig,
      );
      const base = path.join(outputDir, `${slugOf(url)}-run${i}`);
      fs.writeFileSync(`${base}.report.json`, result.report[0]);
      fs.writeFileSync(`${base}.report.html`, result.report[1]);
      runs.push({ lhr: result.lhr, jsonPath: `${base}.report.json`, htmlPath: `${base}.report.html` });
      log(`${pathOf(url)} run ${i}/${runsPerUrl}: ${describe(result.lhr)}`);
    }

    // Lighthouse's own notion of the representative run (closest to the
    // median of its key timings), so what is judged is one real report,
    // not a metric-by-metric composite that no single run produced.
    const valid = filterToValidRuns(runs.map((r) => r.lhr));
    if (valid.length === 0) {
      throw new Error(`No valid Lighthouse run for ${url} - every run errored on a key metric`);
    }
    const median = computeMedianRun(valid);
    if (expectRequestMatching && !gotSuccessfulRequestMatching(median, expectRequestMatching)) {
      throw new Error(
        `${pathOf(url)} got no successful request for "${expectRequestMatching}" - the page did not load world view ${worldView} (is it public on this database?)`,
      );
    }
    for (const run of runs) {
      manifest.push({
        url,
        isRepresentativeRun: run.lhr === median,
        jsonPath: run.jsonPath,
        htmlPath: run.htmlPath,
        summary: { performance: run.lhr.categories.performance?.score ?? null },
      });
    }
    assertionResults.push(...evaluateAssertions(median, assertions, url));
    log(`${pathOf(url)} median: ${describe(median)}`);
  }
} finally {
  await chrome.kill();
}

fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(outputDir, 'assertion-results.json'), JSON.stringify(assertionResults, null, 2));

// Every budget "off" is the other way to judge nothing; the summary refuses
// an empty results file too, but the runner should not exit 0 on it.
if (assertionResults.length === 0) {
  log('No budget was judged: every assertion is "off".');
  process.exit(1);
}

const spoke = assertionResults.filter((r) => !r.passed);
for (const r of spoke) {
  const property = r.auditProperty ? `:${r.auditProperty}` : '';
  const why = r.message ? ` (${r.message})` : '';
  log(`[${r.level}] ${r.auditId}${property} on ${pathOf(r.url)}: ${r.actual} ${r.operator} ${r.expected} failed${why}`);
}
if (hasFailures(assertionResults)) {
  log(`${spoke.filter((r) => r.level === 'error').length} budget(s) over: see ${path.relative(process.cwd(), budgetsPath)}`);
  process.exit(1);
}
log(`All budgets met (${assertionResults.length} assertions over ${urls.length} pages, ${runsPerUrl} runs each).`);

/**
 * The app reads the world view the address names eagerly and only then
 * learns the visitor cannot see it, so a 404 for the fragment is exactly
 * the fallback case; only a
 * 2xx says the page the budgets were set on is the page that loaded. The
 * CORS preflight that precedes every cross-origin read is listed as its
 * own request and answers 204 whatever the read then answers, so it does
 * not count - verified against a world view that does not exist, whose
 * root-regions read is a 204 preflight followed by a 404.
 */
function gotSuccessfulRequestMatching(lhr, fragment) {
  const items = lhr.audits?.['network-requests']?.details?.items;
  return (
    Array.isArray(items) &&
    items.some(
      (item) =>
        typeof item.url === 'string' &&
        item.url.includes(fragment) &&
        item.resourceType !== 'Preflight' &&
        Number.isFinite(item.statusCode) &&
        item.statusCode >= 200 &&
        item.statusCode < 300,
    )
  );
}

/**
 * The lane measures the production build and nothing else, and the dev
 * server answers on the same origin when the frontend container is up in
 * its other shape - the first run of this runner did exactly that and
 * reported 370 script requests, 19.7 MB and a 17 s LCP as if they were the
 * bundle's. Vite's dev server injects its client into every document, so
 * its presence is the tell; a built index.html references hashed assets.
 */
async function assertProductionBuild(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${url} did not answer (${error.cause?.code ?? error.message}); is the stack up on that port?`);
  }
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}; is the stack up?`);
  }
  if (html.includes('/@vite/client')) {
    throw new Error(
      `${url} is served by Vite's dev server; the performance lane measures the production build. ` +
        'Start the stack with FRONTEND_MODE=preview (scripts/test-stack.sh run-perf does).',
    );
  }
  if (!/\/assets\/[^"']+\.js/.test(html)) {
    throw new Error(`${url} does not look like a built index.html (no /assets/*.js reference)`);
  }
}

/**
 * Only this runner's own files are removed, so a stale representative run
 * from last time cannot be read as this time's; anything else in the
 * directory is left alone.
 */
function resetOutputDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (/\.report\.(json|html)$/.test(name) || name === 'manifest.json' || name === 'assertion-results.json') {
      fs.rmSync(path.join(dir, name));
    }
  }
}

function describe(lhr) {
  const a = lhr.audits;
  const ms = (id) => (Number.isFinite(a[id]?.numericValue) ? `${Math.round(a[id].numericValue)} ms` : 'n/a');
  const score = lhr.categories.performance?.score;
  const cls = a['cumulative-layout-shift']?.numericValue;
  return [
    `perf ${Number.isFinite(score) ? Math.round(score * 100) : '?'}`,
    `LCP ${ms('largest-contentful-paint')}`,
    `TBT ${ms('total-blocking-time')}`,
    `CLS ${Number.isFinite(cls) ? cls.toFixed(3) : 'n/a'}`,
    `TTI ${ms('interactive')}`,
  ].join(' | ');
}

/** `/wv/9001` becomes `wv-9001`, `/discover/wv/9001` becomes `discover-wv-9001`. */
function slugOf(url) {
  const { pathname, search } = new URL(url);
  const route = pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
  const query = search.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return query ? `${route}-${query}` : route;
}

function pathOf(url) {
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

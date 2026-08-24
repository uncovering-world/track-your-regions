#!/usr/bin/env node
/**
 * Latency probe for the reads the map depends on: the by-region experience
 * reads and the Martin tile functions. Sequential requests against a
 * running stack, wall-clock p50/p95/max per endpoint, plus the bytes that
 * crossed the wire and the encoding they crossed it in.
 *
 * The bytes are counted off the socket, which is why this uses node:http
 * rather than fetch: fetch decodes a compressed body transparently and
 * reports the decoded length, so it measures the size of a download nobody
 * makes. That is not hypothetical - Martin has always gzipped its tiles,
 * and the first baseline recorded its z3 tile at 3.7 kB where 3.2 kB went
 * over the wire. The request asks for the encodings a browser asks for, so
 * the number is the one a visitor pays.
 *
 * A measurement, not a gate: the numbers depend on the rows in the database
 * and on the machine, so they are recorded in docs/tech/performance.md with
 * both named, and compared by hand. Run it against the dev stack, whose
 * database holds the real catalogue; the isolated test stack's fixture has
 * three experiences and one region, which measures nothing.
 *
 *   node scripts/perf-api.mjs [--api URL] [--martin URL] [--world-view ID]
 *                             [--region ID] [--runs N] [--json]
 *
 * Defaults name the dev stack's ports and the targets the baseline in
 * docs/tech/performance.md was measured on - world view 5 ("Administrative",
 * the base-layer mirror every experience is placed in) and its region 6737
 * (Europe, the heaviest read a click on a continent makes) - so the bare
 * `npm run perf:api` reproduces that table. The probe is anonymous, as a
 * visitor is, so the world view has to be public for the run (a world view
 * that is not answers 404 through requireVisibleWorldView, which the probe
 * reports as a failure rather than a number); override both flags when the
 * database differs. Only the origin of --api and --martin is used, so
 * nothing else typed into them reaches the output.
 *
 * The backend's publicReadLimiter allows 60 requests a minute per address,
 * so backend requests are paced just under that rate - a 429 timed as an
 * answer would read as the fastest endpoint in the table. Tile requests
 * are not limited and run back to back. Every request has a deadline; one
 * that misses it, or answers anything but 200, is counted as a failure and
 * kept out of the timings, and the probe exits non-zero.
 */

import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import https from 'node:https';

// Declared before the first call below: a `const` further down the module
// is in its temporal dead zone when top-level code runs, and the parser is
// the first thing that does.
const OPTIONS_WITH_VALUE = new Set(['api', 'martin', 'world-view', 'region', 'runs']);

const options = parseArgs(process.argv.slice(2));
const API = originOf(options.api ?? 'http://localhost:3001', '--api');
const MARTIN = originOf(options.martin ?? 'http://localhost:3000', '--martin');
const WORLD_VIEW = options['world-view'] ?? '5';
const REGION = options.region ?? '6737';
const RUNS = Number(options.runs ?? 30);
const RATE_LIMIT_PER_MINUTE = 60;
// One request every 1.1 s keeps a rolling minute under the limiter with
// room for the warm-up and for the previous endpoint's tail.
const BACKEND_PACE_MS = Math.ceil(60_000 / RATE_LIMIT_PER_MINUTE) + 100;
const REQUEST_TIMEOUT_MS = 30_000;
// What a browser offers, minus the zstd no server in this stack speaks.
const ACCEPT_ENCODING = 'gzip, deflate, br';
// Distinguishes this run's tile requests from every earlier run's; see
// requestUrl below for why the sample index alone is not enough.
const RUN_TOKEN = `${process.pid}-${Date.now().toString(36)}`;
// Keep-alive, so the table times the endpoint rather than a TCP handshake
// per sample; destroyed before the summary so the process can exit.
const AGENTS = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
};

const BACKEND_TARGETS = [
  {
    name: 'experiences by region (whole region, as the map reads it)',
    url: `${API}/api/experiences/by-region/${REGION}?includeChildren=true&limit=5000`,
  },
  {
    name: 'experience locations by region',
    url: `${API}/api/experiences/by-region/${REGION}/locations?includeChildren=true`,
  },
  {
    name: 'experience counts per region',
    url: `${API}/api/experiences/region-counts?worldViewId=${WORLD_VIEW}`,
  },
].map((target) => ({ ...target, paceMs: BACKEND_PACE_MS }));

// The z3 tile over Europe (3/4/2) is the one #551 measured at 676 ms of
// Postgres time; the rest cover the other functions the map draws from.
const TILE_TARGETS = [
  { name: 'tile: world view root regions z3', url: `${MARTIN}/tile_world_view_root_regions/3/4/2?world_view_id=${WORLD_VIEW}` },
  { name: 'tile: world view root regions z5', url: `${MARTIN}/tile_world_view_root_regions/5/16/10?world_view_id=${WORLD_VIEW}` },
  { name: 'tile: region subregions z5', url: `${MARTIN}/tile_region_subregions/5/16/10?parent_id=${REGION}` },
  { name: 'tile: all leaf regions z3', url: `${MARTIN}/tile_world_view_all_leaf_regions/3/4/2?world_view_id=${WORLD_VIEW}` },
  { name: 'tile: GADM root divisions z3', url: `${MARTIN}/tile_gadm_root_divisions/3/4/2` },
].map((target) => ({ ...target, bustCache: true }));

if (!Number.isInteger(RUNS) || RUNS < 1) {
  fail('--runs must be a positive integer');
}

const results = [];
for (const target of [...BACKEND_TARGETS, ...TILE_TARGETS]) {
  results.push(await probe(target));
}
for (const agent of Object.values(AGENTS)) {
  agent.destroy();
}

const failed = results.filter((r) => r.failures > 0);
if (options.json) {
  process.stdout.write(`${JSON.stringify({ api: API, martin: MARTIN, worldView: WORLD_VIEW, region: REGION, runs: RUNS, results }, null, 2)}\n`);
} else {
  printTable(results);
  if (failed.length > 0) {
    process.stdout.write(`\n${failed.length} endpoint(s) had samples that timed out or did not answer 200; those samples are excluded from the timings above.\n`);
  }
}
if (failed.length > 0) {
  process.exitCode = 1;
}

async function probe(target) {
  // One untimed request first: connection setup and any cold cache belong
  // to the first visitor, not to the endpoint's steady state. Untimed is
  // not unjudged - a warm-up that times out or errors is a failure like
  // any other sample, or the first visitor's experience would be the one
  // the probe never mentions.
  const samples = [];
  let failures = 0;
  let status = 200;
  let bytes = 0;
  let encoding = '-';
  const warmUp = await fetchOnce(requestUrl(target, -1));
  if (warmUp.status !== 200) {
    failures += 1;
    status = warmUp.status;
  }
  for (let i = 0; i < RUNS; i += 1) {
    if (target.paceMs) {
      await sleep(target.paceMs);
    }
    const sample = await fetchOnce(requestUrl(target, i));
    if (sample.status === 200) {
      samples.push(sample.ms);
      bytes = sample.bytes;
      encoding = sample.encoding;
    } else {
      failures += 1;
      // The first thing that went wrong is what the table shows; 0 means
      // the request never got an answer (timeout, connection refused).
      if (status === 200) status = sample.status;
    }
  }
  samples.sort((a, b) => a - b);
  return {
    name: target.name,
    url: target.url,
    status,
    samples: samples.length,
    failures,
    bytes,
    encoding,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: samples.length > 0 ? samples[samples.length - 1] : null,
  };
}

/**
 * Martin keeps generated tiles in memory, keyed by the full request URL, so
 * repeating one URL times the cache (about 2 ms) rather than the tile
 * function - which is the cost #551 is about. A query parameter no function
 * reads makes every request a fresh generation; the map does the same with
 * its `_v` cache-buster. Backend reads are not cached and are left as they
 * are.
 *
 * The parameter carries a token of the run and not just the sample's index,
 * because Martin's cache outlives the probe: the index alone repeats from
 * run to run, so a second run against a Martin still holding the first
 * run's tiles timed its cache and reported a z3 tile at one millisecond
 * where generating it costs twenty-five.
 */
function requestUrl(target, index) {
  if (!target.bustCache) {
    return target.url;
  }
  const separator = target.url.includes('?') ? '&' : '?';
  return `${target.url}${separator}_probe=${RUN_TOKEN}-${index}`;
}

/**
 * One request, counted as it arrives. The body is read and discarded rather
 * than decoded: what is being measured is the transfer, and decoding it
 * would put the client's CPU inside the timing.
 */
function fetchOnce(url) {
  return new Promise((resolve) => {
    const started = performance.now();
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    let settled = false;
    let deadline;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      // Clearing matters twice over: an uncleared timer both fires into a
      // finished request and holds the event loop open after the last sample.
      clearTimeout(deadline);
      resolve({ ms: performance.now() - started, ...result });
    };
    const request = transport.request(
      target,
      { agent: AGENTS[target.protocol], headers: { 'accept-encoding': ACCEPT_ENCODING } },
      (response) => {
        let bytes = 0;
        response.on('data', (chunk) => { bytes += chunk.length; });
        response.on('end', () => settle({
          bytes,
          status: response.statusCode ?? 0,
          encoding: response.headers['content-encoding'] ?? 'identity',
        }));
        // Both, because a destroyed socket reaches one or the other
        // depending on how far the response had got, and a probe that
        // hangs is worse than a probe that reports a failure.
        response.on('error', () => settle({ bytes: 0, status: 0, encoding: '-' }));
        response.on('aborted', () => settle({ bytes: 0, status: 0, encoding: '-' }));
      },
    );
    // A sample that misses its deadline is a failure, not a slow number:
    // destroying the request makes the handlers above report it as one.
    // The deadline is the whole request's, not the socket's: an endpoint
    // that trickles a chunk every few seconds resets `request.setTimeout`
    // forever and would hold up every remaining sample behind it.
    deadline = setTimeout(() => request.destroy(), REQUEST_TIMEOUT_MS);
    request.on('error', () => settle({ bytes: 0, status: 0, encoding: '-' }));
    request.end();
  });
}

/**
 * Linear interpolation between ranks (R-7, what spreadsheets and NumPy
 * compute), so that at thirty samples p95 sits between the second-highest
 * and the highest rather than being the maximum under another name - which
 * is what nearest-rank gives for every sample count below twenty.
 */
function percentile(sorted, p) {
  if (sorted.length === 0) {
    return null;
  }
  const position = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function printTable(rows) {
  const header = ['endpoint', 'ok', 'status', 'wire bytes', 'enc', 'p50 ms', 'p95 ms', 'max ms'];
  const ms = (value) => (value === null ? '-' : value.toFixed(0));
  const table = rows.map((r) => [
    r.name,
    `${r.samples}/${RUNS}`,
    String(r.status),
    String(r.bytes),
    r.encoding,
    ms(r.p50),
    ms(r.p95),
    ms(r.max),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  process.stdout.write(`runs=${RUNS} api=${API} martin=${MARTIN} worldView=${WORLD_VIEW} region=${REGION}\n`);
  process.stdout.write(`${line(header)}\n`);
  for (const row of table) {
    process.stdout.write(`${line(row)}\n`);
  }
}

/**
 * Only the origin is kept: a path, query or credentials typed into --api
 * would otherwise be echoed into the output. The error message names the
 * flag and not the value, for the same reason.
 */
function originOf(value, flag) {
  try {
    return new URL(value).origin;
  } catch {
    return fail(`${flag} must be a URL`);
  }
}

/** Errors name the option, never what was typed after it. */
function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (!OPTIONS_WITH_VALUE.has(key)) {
      fail(`Unexpected argument at position ${i + 1}; options are --api, --martin, --world-view, --region, --runs, --json`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`--${key} needs a value`);
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

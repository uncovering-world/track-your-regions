#!/usr/bin/env node
/**
 * Test the running API against its OpenAPI document with generated requests
 * (#1091, ADR-0072).
 *
 *   node scripts/api-contract.mjs --url http://localhost:5301 --accounts '<json>'
 *
 * Run by `scripts/test-stack.sh run-api-contract`, which brings the isolated
 * test stack up, seeds its fixture and hands over the fixture's accounts.
 * Schemathesis, pinned by digest, generates requests from the document —
 * valid ones and deliberately invalid ones — and fails on an undocumented
 * 500, a response that does not match its schema, a content type the
 * document does not name, or a route that answers without the token it
 * declares.
 *
 * Four runs, one per caller, each over the routes that caller may read: an
 * anonymous caller over `public` and `optional` routes, then the fixture's
 * traveller, curator and admin over `signed-in`, `curator` and `admin`.
 * **Reads only.** The stack is shared with the smoke and database lanes, and a
 * write would change what they read, so every POST, PUT, PATCH and DELETE is
 * left out; the GET routes left out besides are named below with the reason.
 */
import { spawnSync } from 'node:child_process';

import { repoFile } from './repo-root.mjs';

export const SCHEMATHESIS = 'schemathesis/schemathesis:4.28.0@sha256:0a71757c60ccdba270c154a859d9dd3d019625f782f23ab36ad604771e15f78b';

/**
 * The test stack's backend port, as `scripts/test-stack.sh` publishes it: the
 * one address this lane will send a request to.
 */
export const TEST_BACKEND_PORT = process.env.TEST_BACKEND_PORT || '5301';

/** The dev stack's backend port, refused even when a test port is set to it. */
const DEV_BACKEND_PORT = '3001';

/** GET routes left out by name, and why: each starts long work or calls a service outside the stack. */
export const EXCLUDED = {
  getAuthGoogle: 'redirects to Google',
  getAuthGoogleCallback: 'finishes a Google sign-in the lane never started',
  getAuthApple: 'redirects to Apple',
  getGeocodeSearch: 'asks OpenStreetMap Nominatim',
  getGeocodeSuggestImage: 'asks Wikidata',
  getAiStatus: 'lists OpenAI models when a key is set',
  getAiModels: 'lists OpenAI models when a key is set',
  getAdminImageProxy: 'fetches from Wikimedia Commons',
  getAdminDataAssertions: 'runs every catalogue check, and is limited to five calls a minute on purpose',
  getAdminWvImportGeoshapeByWikidataId: 'fetches from Wikimedia when the shape is not stored',
  getWorldViewsRegionsByRegionIdGeometryComputeStream: 'computes and stores a region geometry',
  getAdminWvImportMatchesByWorldViewIdColorMatchStream: 'starts the colour-match pipeline',
  getAdminWvImportMatchesByWorldViewIdCoverageStream: 'runs the coverage analysis',
};

/**
 * Checks left out, and why. `unsupported_method` expects 405 for a method a
 * path does not declare; Express answers 404, as every route here always has,
 * and a 405 with its Allow header is a behaviour to decide on its own.
 */
export const EXCLUDED_CHECKS = ['unsupported_method'];

/**
 * Who each run calls as, which declared access it reads, and how fast. A
 * traveller's routes sit behind `authenticatedLimiter`, which the environment
 * cannot raise (`middleware/rateLimiter.ts`), so that run keeps under it
 * rather than meeting 429 where it probes for 401.
 */
export const RUNS = [
  { caller: 'anonymous', access: ['public', 'optional'] },
  // Fewer examples than the others, so the slower pace keeps the run to a few
  // minutes: its routes are a traveller's own reads, and the coverage phase
  // still reaches every parameter.
  { caller: 'traveller', access: ['signed-in'], rateLimit: '50/m', maxExamples: 12 },
  { caller: 'curator', access: ['curator'] },
  { caller: 'admin', access: ['admin'] },
];

/** The Schemathesis arguments for one run, token aside. */
export function argumentsFor(run, url) {
  return [
    'run', '/spec/openapi.generated.json', '--url', url,
    // Includes are ORed, excludes ANDed: the run's access levels in, every
    // write and every named GET out.
    ...run.access.flatMap((access) => ['--include-by', `/x-access == "${access}"`]),
    ...['POST', 'PUT', 'PATCH', 'DELETE'].flatMap((method) => ['--exclude-method', method]),
    ...Object.keys(EXCLUDED).flatMap((id) => ['--exclude-operation-id', id]),
    '--checks', 'all', '--exclude-checks', EXCLUDED_CHECKS.join(','),
    '--phases', 'examples,coverage,fuzzing',
    '--max-examples', String(run.maxExamples ?? 25), '--seed', '1091',
    ...(run.rateLimit ? ['--rate-limit', run.rateLimit] : []),
    '--no-color',
  ];
}

/**
 * Refuses anything but the test stack's backend on this machine: the port must
 * be the one the test stack publishes, not merely some port that is not the
 * dev stack's, so another service on this machine is refused as well.
 */
export function assertTestStack(url, testPort = TEST_BACKEND_PORT) {
  const { hostname, port } = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(hostname) || port !== testPort || port === DEV_BACKEND_PORT) {
    throw new Error(`Refusing to run the API contract lane against ${url}: only the isolated test stack's backend on this machine`);
  }
}

async function tokenFor(url, account) {
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!response.ok) throw new Error(`Signing in as ${account.email} answered ${response.status}`);
  return (await response.json()).accessToken;
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  const accounts = JSON.parse(argv[argv.indexOf('--accounts') + 1]);
  assertTestStack(url);

  const spec = repoFile('packages', 'shared', 'src');
  const failed = [];
  for (const run of RUNS) {
    const token = run.caller === 'anonymous' ? null : await tokenFor(url, accounts[run.caller]);
    console.log(`\n=== ${run.caller}: ${run.access.join(', ')} routes ===`);
    const result = spawnSync('docker', [
      'run', '--rm', '--network', 'host', '-v', `${spec}:/spec:ro,z`, SCHEMATHESIS,
      ...argumentsFor(run, url),
      ...(token ? ['-H', `Authorization: Bearer ${token}`] : []),
    ], { stdio: 'inherit' });
    if (result.status !== 0) failed.push(run.caller);
  }
  console.log(failed.length === 0 ? '\nAPI contract: every run passed.' : `\nAPI contract: failures as ${failed.join(', ')}.`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('api-contract.mjs')) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

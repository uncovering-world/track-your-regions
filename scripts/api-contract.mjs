#!/usr/bin/env node
/**
 * Test the running API against its OpenAPI document with generated requests
 * (#1091, ADR-0072).
 *
 *   node scripts/api-contract.mjs --url http://localhost:5301 --accounts '<json>' [--part <part>]
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
 * traveller, curator and admin over `signed-in`, `curator` and `admin`. The
 * lane is cut into parts (`PARTS`), one CI job each on a stack of its own,
 * because the paced runs take as long as they have requests (#2513): the
 * curator's run is cut into shards of its routes, and the other runs share a
 * part. Without `--part` every part runs, in turn, on the one stack.
 * **Reads only.** The stack is shared with the smoke and database lanes, and a
 * write would change what they read, so every POST, PUT, PATCH and DELETE is
 * left out; the GET routes left out besides are named below with the reason.
 *
 * **No generated request reaches a service outside the stack** (#2428). A GET
 * route that calls one (`OUTSIDE`) is left out of the four runs and read in a
 * run of its own, once, with fixed values: a real place, never a generated or
 * a malformed one. Its answer is checked like any other, an outside service's
 * failure included, which the route answers with its declared error.
 *
 * **A signed-in run holds a live token from its first request to its last**
 * (#2513). An access token lasts 15 minutes and the curator's run takes longer,
 * so the run is not handed a token: Schemathesis signs in itself as the
 * caller (`authConfig`) and signs in again every five minutes, and again on any
 * 401, retrying the request once. An operation that answered only 401 or 403
 * fails the run, and so does a run whose signing in stopped working: neither is
 * counted as a route exercised.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoFile } from './repo-root.mjs';

export const SCHEMATHESIS = 'schemathesis/schemathesis:4.28.0@sha256:0a71757c60ccdba270c154a859d9dd3d019625f782f23ab36ad604771e15f78b';

/**
 * The test stack's backend port, as `scripts/test-stack.sh` publishes it: the
 * one address this lane will send a request to.
 */
export const TEST_BACKEND_PORT = process.env.TEST_BACKEND_PORT || '5301';

/** The dev stack's backend port, refused even when a test port is set to it. */
const DEV_BACKEND_PORT = '3001';

/**
 * GET routes left out by name, and why: each signs in elsewhere, starts long
 * work or is rate-limited on purpose, or answers a defect the lane has found
 * and the route has yet to mend, which the lane would report on every run.
 */
export const EXCLUDED = {
  getAuthGoogle: 'redirects to Google',
  getAuthGoogleCallback: 'finishes a Google sign-in the lane never started',
  getAuthApple: 'redirects to Apple',
  getAdminDataAssertions: 'runs every catalogue check, and is limited to five calls a minute on purpose',
  getWorldViewsRegionsByRegionIdGeometryComputeStream: 'computes and stores a region geometry',
  getAdminWvImportMatchesByWorldViewIdColorMatchStream: 'starts the colour-match pipeline',
  getAdminWvImportMatchesByWorldViewIdCoverageStream: 'runs the coverage analysis',
  // Public routes the anonymous run had never read (#2513): their documents
  // name a plain string where the route refuses all but one shape of it (#2515).
  getExperiencesPoints: 'documents `bbox` as any string up to 100 characters, and refuses all but four numbers',
  getExperiencesWikipediaEditions: 'documents `languages` as any string, and refuses all but language codes',
};

/** The fixture's first place (`e2eFixture.ts`), whose routes an outside call is read through. */
export const FIXTURE_PLACE_ID = 9001;

/**
 * The GET routes that call a service outside the stack, each with the caller
 * that reads it and the one request it is read with: the Brandenburg Gate
 * (Q82425) at its point for the geography, the fixture's place and point for a
 * place's own reads. `point` is the fixture place's point, read from the stack.
 */
export const OUTSIDE = {
  getGeocodeSearch: { service: 'OpenStreetMap Nominatim', caller: 'curator', parameters: () => ({ 'query.q': 'Brandenburger Tor', 'query.limit': 1 }) },
  getGeocodeReverse: { service: 'OpenStreetMap Nominatim', caller: 'curator', parameters: () => ({ 'query.lat': 52.516272, 'query.lon': 13.377722 }) },
  getGeocodeArticlePointById: { service: 'Wikipedia', caller: 'curator', parameters: () => ({ 'path.id': FIXTURE_PLACE_ID }) },
  getGeocodeSuggestImage: {
    service: 'Wikidata', caller: 'curator',
    parameters: () => ({ 'query.wikidataId': 'Q82425', 'query.name': 'Brandenburg Gate', 'query.lat': 52.516272, 'query.lng': 13.377722 }),
  },
  getExperiencesByIdWebsiteChecks: { service: "the websites a place names", caller: 'curator', parameters: () => ({ 'path.id': FIXTURE_PLACE_ID }) },
  getExperiencesByIdPictureClasses: { service: 'Wikimedia Commons', caller: 'curator', parameters: () => ({ 'path.id': FIXTURE_PLACE_ID }) },
  getExperiencesLocationsByLocationIdNearbyPictures: {
    service: 'Wikimedia Commons', caller: 'curator', parameters: ({ point }) => ({ 'path.locationId': point }),
  },
  getAiStatus: { service: 'OpenAI, where a key is set', caller: 'admin', parameters: () => ({}) },
  getAiModels: { service: 'OpenAI, where a key is set', caller: 'admin', parameters: () => ({}) },
  getAdminImageProxy: {
    service: 'Wikimedia Commons', caller: 'admin',
    parameters: () => ({ 'query.url': 'https://commons.wikimedia.org/wiki/Special:FilePath/Brandenburger%20Tor%20morgens.jpg?width=330' }),
  },
};

/** Where a run's configuration and its JSON report sit inside the container. */
const CONFIG_FILE = '/config/schemathesis.toml';
const REPORT_FILE = '/report/report.json';
const REPORT_ARGUMENTS = ['--report', 'json', '--report-json-path', REPORT_FILE];

/** One TOML string, quoted. */
const tomlValue = (value) => (typeof value === 'number' ? String(value) : JSON.stringify(value));

/**
 * The statuses a route answers for a service outside the stack that failed it
 * (`services/outsideStatus.ts`: 502, or 504 for its own deadline), read by the
 * outside runs as an answer rather than as the route's server error; a 500
 * stays one. The AI routes are the exception the runs never meet: they call
 * OpenAI only where a key is set.
 */
export const OUTSIDE_FAILURES = [502, 503, 504];

/**
 * What every run holds a route to beyond the checks: an operation that
 * answered only 401 or 403 fails the run rather than warning. Every run reads
 * only routes its caller may read, so such an answer is a token the run lost,
 * never the route's right answer.
 */
export const WARNINGS_CONFIG = '[warnings]\nfail-on = ["missing_auth"]\n';

/** The variables a signed-in run's container reads the caller's credentials from, so they never sit on a command line. */
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- the name of the variable that carries the fixture's password, not a password
export const CREDENTIAL_VARIABLES = { email: 'API_CONTRACT_EMAIL', password: 'API_CONTRACT_PASSWORD' };

/**
 * How a signed-in run gets its token: Schemathesis's dynamic token fetch
 * (`auth.dynamic.openapi`, for the document's `bearer` scheme) signs in at
 * `/api/auth/login` and reads `accessToken` from the answer. It keeps the token
 * five minutes (its `CachingAuthProvider`), against the 15 an access token
 * lasts (docs/tech/authentication.md § Token Lifecycle), and on a 401 it signs
 * in again and sends the request once more. No caller has a token of its own:
 * the anonymous run has none.
 */
export function authConfig(caller) {
  if (caller === 'anonymous') return '';
  return '[auth.dynamic.openapi.bearer]\npath = "/api/auth/login"\n'
    + `payload = { email = "\${${CREDENTIAL_VARIABLES.email}}", password = "\${${CREDENTIAL_VARIABLES.password}}" }\n`
    + 'extract_selector = "/accessToken"\n';
}

/** A caller's whole Schemathesis configuration: the warnings that fail, its sign-in, and the outside routes' values where given. */
export function configFor(caller, outside) {
  return [WARNINGS_CONFIG, authConfig(caller), outside ?? ''].filter(Boolean).join('\n');
}

/**
 * Why a run's JSON report fails it beside its own exit code, or null: a run
 * whose signing in stopped working mid-run reads the rest of its routes with
 * no token, and Schemathesis says so only as a line of its summary. A report
 * that is missing (`undefined`), unreadable (`null`) or silent on the point
 * fails the run too: every run asks for one, so its absence or a new shape
 * means the image or its format changed, and the rule would otherwise stop
 * catching anything without a word.
 */
export function reportFailure(report) {
  if (report === undefined) return 'Schemathesis wrote no JSON report, so whether signing in held cannot be read';
  if (typeof report?.auth?.reauth_broke !== 'boolean') {
    return 'its JSON report does not say whether signing in held (no boolean auth.reauth_broke): has its format changed?';
  }
  if (report.auth.reauth_broke) return 'signing in stopped working mid-run';
  return null;
}

/** A run's JSON report: `undefined` when there is none, `null` when it is not JSON. */
function readReport(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** The Schemathesis configuration that fixes every parameter of the outside routes a caller reads, optional ones included. */
export function outsideConfig(caller, context) {
  const statuses = ['"2xx"', '"3xx"', '"4xx"', ...OUTSIDE_FAILURES].join(', ');
  return `[checks]\nnot_a_server_error.expected-statuses = [${statuses}]\n\n` + Object.entries(OUTSIDE)
    .filter(([, route]) => route.caller === caller)
    .map(([id, route]) => {
      const values = Object.entries(route.parameters(context)).map(([name, value]) => `"${name}" = ${tomlValue(value)}`);
      return `[[operations]]\ninclude-operation-id = "${id}"\nparameters = { ${values.join(', ')} }\n`;
    })
    .join('\n');
}

/**
 * The arguments of a caller's outside run: its routes only, each requested
 * once with its fixed values and valid data only, one request a second
 * (Nominatim's own pace). It waits 30 s, longer than the backend's own
 * timeouts toward the services that have one, so a failure there is read as
 * the route's declared error; the image proxy's download has none.
 */
export function outsideArgumentsFor(caller, url) {
  const ids = Object.entries(OUTSIDE).filter(([, route]) => route.caller === caller).map(([id]) => id);
  return [
    '--config-file', CONFIG_FILE,
    'run', '/spec/openapi.generated.json', '--url', url,
    ...ids.flatMap((id) => ['--include-operation-id', id]),
    '--checks', 'all', '--exclude-checks', EXCLUDED_CHECKS.join(','),
    '--phases', 'fuzzing', '--mode', 'positive', '--max-examples', '1', '--seed', '1091',
    // How fast a third party answers is its own, not the route's contract:
    // the response-time check, which fails a ten-second answer by default,
    // allows what the request timeout does.
    '--rate-limit', '1/s', '--request-timeout', '30', '--max-response-time', '30',
    ...REPORT_ARGUMENTS, '--no-color',
  ];
}

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
 * rather than meeting 429 where it probes for 401. The curator's read routes
 * the lane does call (Jev's suggestions, the pins, the identifiers, the
 * standings) sit behind the same limiter, and on 2026-10-31 the coverage phase
 * crossed its sixty a minute from one address (#2192), so that run is paced
 * the same way: headroom under the limiter for the routes it reads.
 */
export const RUNS = [
  { caller: 'anonymous', access: ['public', 'optional'] },
  // Fewer examples than the others, so the slower pace keeps the run to a few
  // minutes: its routes are a traveller's own reads, and the coverage phase
  // still reaches every parameter.
  { caller: 'traveller', access: ['signed-in'], rateLimit: '50/m', maxExamples: 12 },
  // Cut into shards of its routes, each a CI job of its own: paced as the
  // traveller's is over more routes with more parameters, the whole run took
  // 1 146 s on run 43533554237 (2026-11-14), and 1 268 s signing in itself
  // (#2513), against 486 s for the traveller's.
  { caller: 'curator', access: ['curator'], rateLimit: '50/m', maxExamples: 12, shards: 3 },
  { caller: 'admin', access: ['admin'] },
];

/** The part the runs that are not cut share, with the outside runs: named after its callers. */
export const SHARED_PART = RUNS.filter((run) => !run.shards).map((run) => run.caller).join('-');

/** A shard's part, `curator-1-of-3`: the name a CI job carries. */
const shardPart = (run, shard) => `${run.caller}-${shard}-of-${run.shards}`;

/**
 * The lane's parts, in the order a run of every part takes them: each is a
 * matrix entry of the `api-contract` job in `ci.yml`, which lists them by
 * these names.
 */
export const PARTS = [
  SHARED_PART,
  ...RUNS.filter((run) => run.shards).flatMap((run) => Array.from({ length: run.shards }, (_, i) => shardPart(run, i + 1))),
];

/**
 * The GET operations a run reads, each with its weight: every operation of
 * its access levels but the ones left out by name. The weight is one plus the
 * operation's parameters, since the coverage phase draws its cases per
 * parameter: about sixteen cases a weight across the curator's routes, the
 * review queue's fifteen parameters drawing 245 of them (counted 2026-11-14).
 */
export function operationsFor(run, document) {
  const leftOut = new Set([...Object.keys(EXCLUDED), ...Object.keys(OUTSIDE)]);
  return Object.values(document.paths)
    .flatMap((methods) => Object.entries(methods))
    .filter(([method, operation]) => method === 'get' && run.access.includes(operation['x-access']) && !leftOut.has(operation.operationId))
    .map(([, operation]) => ({ id: operation.operationId, weight: 1 + (operation.parameters?.length ?? 0) }));
}

/**
 * Operations cut into `count` shards of about equal weight: heaviest first,
 * each to the lightest shard so far (the first on a tie), ties among the
 * operations broken by id, so the cut depends on the document alone.
 */
export function shardsOf(operations, count) {
  const shards = Array.from({ length: count }, () => ({ weight: 0, ids: [] }));
  const ordered = [...operations].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  for (const operation of ordered) {
    const lightest = shards.reduce((min, shard) => (shard.weight < min.weight ? shard : min));
    lightest.weight += operation.weight;
    lightest.ids.push(operation.id);
  }
  return shards.map((shard) => shard.ids.sort());
}

/**
 * What a part runs: each of its runs with the operations it reads, and
 * whether the outside runs are its. A run or a shard with no operation is
 * refused, since Schemathesis given no operation to include reads them all.
 */
export function planFor(part, document) {
  if (!PARTS.includes(part)) throw new Error(`No API contract part "${part}": the parts are ${PARTS.join(', ')}`);
  const runs = RUNS.flatMap((run) => {
    const operations = operationsFor(run, document);
    if (!run.shards) return part === SHARED_PART ? [{ run, label: run.caller, ids: operations.map((one) => one.id).sort() }] : [];
    return shardsOf(operations, run.shards)
      .map((ids, i) => ({ run, label: `${run.caller}, shard ${i + 1} of ${run.shards}`, ids, part: shardPart(run, i + 1) }))
      .filter((shard) => shard.part === part);
  });
  for (const { label, ids } of runs) {
    if (ids.length === 0) throw new Error(`The API contract run "${label}" has no operation to read`);
  }
  return { runs, outside: part === SHARED_PART };
}

/**
 * The Schemathesis arguments for one run over the operations it reads
 * (`planFor`); its sign-in is in its configuration (`configFor`).
 */
export function argumentsFor(run, url, ids) {
  return [
    '--config-file', CONFIG_FILE,
    'run', '/spec/openapi.generated.json', '--url', url,
    // Includes are ORed, excludes ANDed: the run's operations in, and every
    // write and every named GET out besides, should one be among them.
    ...ids.flatMap((id) => ['--include-operation-id', id]),
    ...['POST', 'PUT', 'PATCH', 'DELETE'].flatMap((method) => ['--exclude-method', method]),
    ...[...Object.keys(EXCLUDED), ...Object.keys(OUTSIDE)].flatMap((id) => ['--exclude-operation-id', id]),
    '--checks', 'all', '--exclude-checks', EXCLUDED_CHECKS.join(','),
    '--phases', 'examples,coverage,fuzzing',
    '--max-examples', String(run.maxExamples ?? 25), '--seed', '1091',
    ...(run.rateLimit ? ['--rate-limit', run.rateLimit] : []),
    ...REPORT_ARGUMENTS, '--no-color',
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

/**
 * A fetch whose network failure says why, undici's own message being only
 * "fetch failed". A pooled connection the backend closed while a
 * Schemathesis run went on ("other side closed") is asked again once, on a
 * fresh connection.
 */
async function fetchSaying(url, init) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt === 1 && error.cause?.code === 'UND_ERR_SOCKET') continue;
      throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${error.cause?.code ?? ''} ${error.cause?.message ?? error.message}`.trim());
    }
  }
}

/** The fixture place's point, as the stack serves it: the point the nearby-pictures route is read at. */
async function fixturePoint(url) {
  const response = await fetchSaying(`${url}/api/experiences/${FIXTURE_PLACE_ID}/locations`);
  if (!response.ok) throw new Error(`Reading the fixture's point answered ${response.status}`);
  const body = await response.json();
  const id = (Array.isArray(body) ? body : body.locations)?.[0]?.id;
  if (typeof id !== 'number') throw new Error("The fixture's first place has no point to read");
  return id;
}

/**
 * One Schemathesis run in its container: the document and the run's
 * configuration mounted read-only, the report directory writable, and a
 * signed-in caller's credentials passed by variable name from this process's
 * environment. Answers the caller's failure, or null.
 */
function runSchemathesis({ label, caller, account, args, config, scratch }) {
  const configDir = join(scratch, 'config');
  const reportDir = join(scratch, 'report');
  rmSync(reportDir, { recursive: true, force: true });
  mkdirSync(reportDir);
  // Written by the container's own user, which is not this one on a CI runner.
  chmodSync(reportDir, 0o777);
  const file = join(configDir, 'schemathesis.toml');
  writeFileSync(file, config);
  // Not masked by the umask, as a mode given to writeFileSync is.
  chmodSync(file, 0o644);
  const credentials = account
    ? { [CREDENTIAL_VARIABLES.email]: account.email, [CREDENTIAL_VARIABLES.password]: account.password }
    : {};
  console.log(`\n=== ${label} ===`);
  const result = spawnSync('docker', [
    'run', '--rm', '--network', 'host',
    ...Object.keys(credentials).flatMap((name) => ['-e', name]),
    '-v', `${repoFile('packages', 'shared', 'src')}:/spec:ro,z`, '-v', `${configDir}:/config:ro,z`, '-v', `${reportDir}:/report:z`,
    SCHEMATHESIS, ...args,
  ], { stdio: 'inherit', env: { ...process.env, ...credentials } });
  const why = reportFailure(readReport(join(reportDir, 'report.json')));
  if (why) console.log(`${caller}: ${why}`);
  return result.status !== 0 || why ? caller : null;
}

/** Runs one part's plan (`planFor`) and answers the runs that failed. */
async function runPart(plan, { url, accounts, scratch }) {
  console.log(`\n##### API contract part ${plan.part} #####`);
  const failed = plan.runs.map(({ run, label, ids }) => runSchemathesis({
    label: `${label}: ${ids.length} ${run.access.join(', ')} routes`,
    caller: label,
    account: accounts[run.caller],
    args: argumentsFor(run, url, ids),
    config: configFor(run.caller),
    scratch,
  }));
  if (plan.outside) {
    // The routes that call a service outside the stack, read once each with fixed values.
    const context = { point: await fixturePoint(url) };
    for (const caller of [...new Set(Object.values(OUTSIDE).map((route) => route.caller))]) {
      failed.push(runSchemathesis({
        label: `${caller}: the routes that call a service outside the stack, once each`,
        caller: `${caller} (outside)`,
        account: accounts[caller],
        args: outsideArgumentsFor(caller, url),
        config: configFor(caller, outsideConfig(caller, context)),
        scratch,
      }));
    }
  }
  return failed.filter(Boolean);
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const url = option('--url');
  const accounts = JSON.parse(option('--accounts'));
  const parts = option('--part') ? [option('--part')] : PARTS;
  assertTestStack(url);
  const document = JSON.parse(readFileSync(repoFile('packages', 'shared', 'src', 'openapi.generated.json'), 'utf8'));
  const plans = parts.map((part) => ({ part, ...planFor(part, document) }));

  const failed = [];
  const scratch = mkdtempSync(join(tmpdir(), 'api-contract-'));
  // Readable by the container's own user: mkdtemp makes the directory its owner's alone.
  chmodSync(scratch, 0o755);
  mkdirSync(join(scratch, 'config'), { mode: 0o755 });
  try {
    for (const plan of plans) failed.push(...await runPart(plan, { url, accounts, scratch }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
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

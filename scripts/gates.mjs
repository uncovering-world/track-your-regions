#!/usr/bin/env node
/**
 * Which gates a change asks for, and why every other one is skipped.
 *
 * Every gate runs on every change today, so a pull request that edits one
 * Markdown file waits about 25 minutes for Semgrep, Trivy, both unit lanes, a
 * Playwright smoke run and a Lighthouse pass, none of which can see a word of
 * what it changed (#783). The fix is not a `paths:` filter on the workflow — a
 * workflow skipped that way leaves its required checks Pending for ever and the
 * merge button never lights up. It is this: one map from each gate to the
 * inputs it actually reads, and a runner that consults it.
 *
 * The rule the map serves (ADR-0062): a gate runs when, and only when, the
 * inputs it checks have changed. Every skip prints its reason, and a change
 * set the runner cannot work out — a shallow clone, an unknown base — runs
 * everything and says so. A runner that runs nothing must say so loudly;
 * passing by silence is the failure mode this whole file exists to avoid.
 *
 * This is the only place the map is written. CI reads it (`--github-output`),
 * the local scripts read it (`npm run check`), and `docs/tech/gates.md` embeds
 * the tables `--table` prints, pinned by `scripts/gates.test.mjs`.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

import { LANES, loadsModules, readsText, selectSpecs } from './affected-specs.mjs';
import { openGateCache } from './gate-cache.mjs';
import { READ_EXTENSIONS } from './lint-line-pointers.mjs';

/**
 * The scripts no unit or stack lane executes: the gate map and its cache, the
 * board, the review and coverage tools, the database shell, the tool guards and
 * the gates that run them by name (`config` on their entries below). Escaped
 * for the `runners` pattern.
 */
const TOOL_SCRIPTS = [
  'affected-specs.mjs', 'board.sh', 'catalogue-coverage.sh', 'ci-graph-measure.mjs', 'db-cli.sh', 'db-migrate.sh',
  'db-types.sh', 'gate-cache.mjs', 'gates.mjs', 'lib/db-env.sh', 'lint-line-pointers.mjs',
  'match-snapshot.sh', 'openapi-breaking.mjs', 'require-node-tools.sh', 'require-py-tools.sh',
  'require-python-312.sh', 'review-surface.mjs', 'scan-image.sh', 'scan-secrets.sh', 'setup.sh',
  'setup-integrations.sh', 'test-db-migrate.sh',
].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/**
 * The classes of file a gate can read, in the order a reader should meet them.
 *
 * A `paths` entry ending in `/` matches everything under that directory; any
 * other string matches that one path exactly; a RegExp is tested against the
 * whole repository-relative path. A path may belong to several classes, and one
 * that belongs to none is reported, never dropped.
 */
export const INPUTS = [
  {
    id: 'backend',
    // A README beside the code is prose: no lint, typecheck or spec reads it.
    paths: [/^backend\/(?!.*\.md$)/],
    note:
      "The API's source, its specs and its build. The web reads none of it: the"
      + " backend's response schemas reach the web only as the OpenAPI document"
      + ' in packages/shared (ADR-0072, ADR-0073), which api/openApi.test.ts holds'
      + ' to the schemas. So a backend change that leaves the document as it was'
      + " asks for the backend's own gates and the lanes that run the stack.",
  },
  {
    id: 'web',
    paths: [/^frontend\/(?!.*\.md$)/],
    note:
      'The web client, its specs and its Playwright and Lighthouse runners.'
      + ' The backend unit lane reads frontend/src through repoFile() — the URL'
      + ' safety and antimeridian scans — so a change here still asks for'
      + " test:backend; none of the backend's other gates reads it.",
  },
  {
    id: 'shared',
    paths: [/^packages\/(?!.*\.md$)/],
    note:
      'The rules both sides import (ADR-0065) and the OpenAPI document the'
      + " web's client is generated from (ADR-0072): both typechecks read it"
      + ' through the link, and its specs run in the backend unit lane. A change'
      + ' here asks for both sides.',
  },
  {
    id: 'database',
    // All of db/ but the coverage lists, which are data with one reader and
    // a class of their own below. Anything else that lands beside them stays here.
    paths: [/^db\/(?!catalogue-coverage\/.*\.jsonl$)/],
    note:
      'The schema, the migrations and the loaders: what a database is built'
      + ' from. The backend unit lane reads db/ through repoFile() — schema'
      + ' parity, the migration ledger, the trigger guards — and the stack lanes'
      + ' stand on it. No lint, typecheck or web gate reads it.',
  },
  {
    id: 'tiles',
    paths: ['martin/'],
    note:
      "Martin's configuration. The backend unit lane asserts on the tile"
      + ' sources it publishes, and the smoke and Lighthouse lanes draw them.',
  },
  {
    id: 'scripts',
    paths: ['scripts/'],
    note:
      "The repository's own scripts and their specs, whole: the tooling specs"
      + ' run in the backend unit lane, and two of its specs scan the tree for'
      + ' anything that switches the geometry triggers off.',
  },
  {
    id: 'runners',
    paths: [new RegExp(`^scripts/(?!.*\\.test\\.mjs$)(?!(?:${TOOL_SCRIPTS.join('|')})$)`)],
    note:
      'The scripts the unit and stack lanes run through: test-report.mjs,'
      + " test-stack.sh, the report parsers the web's specs import, the API"
      + ' contract and performance runners. Everything under scripts/ but the'
      + ' specs and the tools no lane executes, so a new script counts as a'
      + ' runner until it is named a tool.',
  },
  {
    id: 'compose',
    paths: ['docker-compose.yml', 'docker-compose.test.yml', '.env.example'],
    note:
      "What the containers are: the dev and test stacks, the unit lanes'"
      + ' container shape and the variables they read. Every lane that runs in'
      + ' a container reads it; no lint or typecheck does.',
  },
  {
    id: 'python',
    paths: ['cv-python/'],
    note:
      'The computer-vision service is its own interpreter, its own dependency'
      + ' set and its own image; no Node gate reads it except the Semgrep scan'
      + ' pointed at the whole checkout.',
  },
  {
    id: 'db-python',
    paths: [/^db\/.*\.py$/, 'db/pyproject.toml', 'db/requirements.txt'],
    note:
      'The GADM loaders live in db/ but are run by pytest, so they are an input'
      + ' to the Python test lane without being an input to cv-python’s lint.',
  },
  {
    id: 'coverage',
    paths: [/^db\/catalogue-coverage\/.*\.jsonl$/],
    note:
      'The catalogue-coverage register, regions and lists (ADR-0081) are data'
      + ' with one reader, services/catalogueCoverage/files.ts, and one spec that'
      + ' reads the committed files whole, files.test.ts, in the backend unit'
      + ' lane. The load and the report read them from a command, and their'
      + ' specs use fixtures; no lint, build or stack lane sees a line of them.'
      + ' The Semgrep scan does, for a secret in what agents copied from the web.',
  },
  {
    id: 'schema',
    paths: [
      // Everything docker-entrypoint-initdb.d applies, not the one file it
      // holds today, and the compose file that pins the image it runs on.
      /^db\/init\//,
      'docker-compose.yml',
      'backend/src/db/schema.generated.ts',
      'backend/src/db/generateSchemaTypes.ts',
      'backend/src/db/schemaTypesRender.ts',
      'backend/src/db/testDbName.ts',
      'scripts/db-types.sh',
    ],
    note:
      'The generated row types are a function of what a fresh database is'
      + ' built from: the db/init directory the image applies on first start,'
      + ' the compose file that pins that image, the file the generator'
      + ' produces, the generator, the renderer, the guard it imports and its'
      + ' runner. The migrations are not — a fresh database never reads them,'
      + ' and the schema-to-migration parity test answers for those.',
  },
  {
    id: 'node-deps',
    paths: [
      'backend/package.json',
      'backend/package-lock.json',
      'frontend/package.json',
      'frontend/package-lock.json',
      'packages/shared/package.json',
      'packages/shared/package-lock.json',
    ],
    note:
      'npm audit reads the three manifests and their lockfiles and nothing else,'
      + ' so a change of source code cannot alter its answer.',
  },
  {
    id: 'docs',
    paths: [/\.md$/],
    note:
      'Every tracked Markdown file, wherever it sits: the docs pass checks what'
      + ' renders and what a link points at, which is the same question in'
      + ' docs/, in a service’s README and in the root guides.',
  },
  {
    id: 'shell',
    paths: [/\.sh$/],
    note: 'shellcheck reads the scripts themselves; nothing else changes its verdict.',
  },
  {
    id: 'docker',
    paths: [/(^|\/)Dockerfile[^/]*$/],
    note: 'hadolint reads the Dockerfiles themselves, including their per-stage variants.',
  },
  {
    id: 'workflows',
    paths: ['.github/workflows/'],
    note:
      'actionlint parses the workflow files themselves — their syntax, their'
      + ' expressions, the shell in their `run:` blocks. Every one of them, not'
      + ' only ci.yml: a workflow is checked by nothing else, so a mistake in one'
      + ' is found by the run that hits it, on the branch it is already merged to.',
  },
  {
    id: 'prose',
    // The pass's own extension list, so what the gate reads and what asks for
    // it cannot disagree: an issue template under .github/ or the ASVS
    // checklist is in no class above, and a pointer added there would
    // otherwise surface as a red check on some unrelated branch.
    paths: [new RegExp(`\\.(?:${READ_EXTENSIONS.join('|')})$`)],
    note:
      'Every tracked file the line-pointer pass reads — Markdown, and each'
      + ' file type that carries a comment — by the extension list the pass'
      + ' itself declares (scripts/lint-line-pointers.mjs), whichever'
      + ' directory the file sits in.',
  },
  {
    id: 'api-contract',
    paths: ['packages/shared/src/openapi.generated.json', 'scripts/openapi-breaking.mjs'],
    note:
      'The OpenAPI document a client is generated from (ADR-0072), and the check'
      + ' that compares it with the base. The document also sits under shared,'
      + ' whose gates regenerate and lint it; this class is what asks whether it still'
      + ' serves a client built against the last one.',
  },
];

/**
 * Every gate, in the order a person would meet it: the fast checks, then the
 * unit tests, then the slow scans, then the stack lanes.
 *
 * `command` is an argv array — the runner spawns argv[0] directly, with no
 * shell — except in the `stack` tier, which is listed and never run, where the
 * array is the line a person types. `setup` is the toolchain a runner has to
 * install before the command works; `docker` means nothing to install, because
 * every runner already has it. `job` is the CI job the gate belongs to.
 *
 * `config` names the files outside its classes that the gate itself reads — its
 * tool's settings, the guard its script calls, the documents its specs open —
 * and asks for this gate alone when one of them changes (ADR-0092). The npm
 * script a gate runs is read the same way: a change to the root package.json
 * asks for the gates whose script, or a script it runs, changed.
 *
 * `uncached` says why a pass of this gate is never reused (ADR-0091): its
 * answer reads something outside the tree, which can change while the files
 * the gate reads stay as they were.
 */
const ADVISORIES = 'its answer reads an advisory database that changes while the tree does not';
const RULE_PACKS = 'Semgrep fetches its rule packs from the registry on every run, so a new rule can fail a tree that passed';
const BASE_DOCUMENT = "it compares with the base's OpenAPI document, which is not in this tree";
const VULNERABILITY_DATABASE = 'Trivy reads a vulnerability database and a base image that move under the same tree';
const LINK_TARGETS = 'lychee resolves links to files of every type, and its input class holds the Markdown only';

/**
 * `local` on a stack gate lists what of it is owed by hand as well as by CI
 * (#1379): CI runs every stack lane the change asks for on every pushed head,
 * so a local run of one only repeats it, unless the run measures something CI
 * cannot hold. Each entry names the classes whose change owes it, the files of
 * its own runner (CI never runs them, so a change to one owes the measurement
 * too), the command that measures it, and why. `covers` names a command whose
 * measurement this one includes, which is then not owed beside it.
 *
 * Both of perf's measure the dev stack, which serves the main checkout: they
 * measure a branch only where the branch is what that checkout holds.
 */
const PERF_LOCAL = [
  {
    reads: ['web', 'shared'],
    files: ['scripts/perf-local.sh', 'scripts/frontend-mode.sh'],
    covers: 'npm run perf:api',
    command: 'npm run perf:local',
    why: "Lighthouse on the dev stack's real catalogue, where CI's lane weighs a fixture: a change to what the browser loads",
  },
  {
    reads: ['backend', 'database', 'tiles', 'shared'],
    files: ['scripts/perf-api.mjs', 'scripts/perf-api-report.mjs'],
    command: 'npm run perf:api',
    why: "the latency probe over the hot reads and tiles, which no CI job runs: a change to what answers them",
  },
];

export const GATES = [
  { id: 'lint:backend', tier: 'check', inputs: ['backend', 'shared'], command: ['npm', '--prefix', 'backend', 'run', 'lint'], job: 'check', setup: 'node' },
  { id: 'lint:frontend', tier: 'check', inputs: ['web', 'shared'], command: ['npm', '--prefix', 'frontend', 'run', 'lint'], job: 'check', setup: 'node' },
  { id: 'typecheck:backend', tier: 'check', inputs: ['backend', 'shared'], command: ['npm', '--prefix', 'backend', 'run', 'typecheck'], job: 'check', setup: 'node' },
  { id: 'typecheck:frontend', tier: 'check', inputs: ['web', 'shared'], command: ['npm', '--prefix', 'frontend', 'run', 'typecheck'], job: 'check', setup: 'node' },
  { id: 'knip:backend', tier: 'check', inputs: ['backend', 'shared'], command: ['npm', '--prefix', 'backend', 'run', 'knip'], job: 'check', setup: 'node' },
  { id: 'knip:frontend', tier: 'check', inputs: ['web', 'shared'], command: ['npm', '--prefix', 'frontend', 'run', 'knip'], job: 'check', setup: 'node' },
  // The third package (ADR-0065): its own lint, typecheck and knip, the way
  // the other two have theirs. Its specs run in test:backend, like the
  // tooling's, and both sides' typechecks read its source through the link.
  { id: 'lint:shared', tier: 'check', inputs: ['shared'], command: ['npm', '--prefix', 'packages/shared', 'run', 'lint'], job: 'check', setup: 'node' },
  { id: 'typecheck:shared', tier: 'check', inputs: ['shared'], command: ['npm', '--prefix', 'packages/shared', 'run', 'typecheck'], job: 'check', setup: 'node' },
  { id: 'knip:shared', tier: 'check', inputs: ['shared'], command: ['npm', '--prefix', 'packages/shared', 'run', 'knip'], job: 'check', setup: 'node' },
  { id: 'lint:circular', tier: 'check', inputs: ['backend', 'web', 'shared'], command: ['npm', 'run', 'lint:circular'], job: 'check', setup: 'node', config: ['.madgerc', 'package-lock.json', 'scripts/require-node-tools.sh'] },
  // Stands a fresh Postgres up from db/init, regenerates the row types and
  // diffs them against the committed file (ADR-0064): a schema edit without
  // `npm run db:types` fails here. `node` because the generator runs from
  // backend/node_modules; the database is Docker, which every runner has.
  { id: 'db:types', tier: 'check', inputs: ['schema'], command: ['npm', 'run', 'db:types:check'], job: 'check', setup: 'node' },
  { id: 'security:deps', tier: 'check', inputs: ['node-deps'], command: ['npm', 'run', 'security:deps'], job: 'check', setup: 'node', uncached: ADVISORIES },
  // gitleaks over every file git tracks (ADR-0108, #1504): a generic
  // credential in any file type, which Semgrep's p/secrets and GitHub's own
  // scanning do not read. Every class, since a secret can be pasted anywhere.
  { id: 'security:secrets', tier: 'check', inputs: INPUTS.map((input) => input.id), command: ['npm', 'run', 'security:secrets'], job: 'check', setup: 'docker', config: ['.gitleaks.toml', 'scripts/scan-secrets.sh'] },
  { id: 'lint:shell', tier: 'check', inputs: ['shell'], command: ['npm', 'run', 'lint:shell'], job: 'check', setup: 'docker' },
  { id: 'lint:docker', tier: 'check', inputs: ['docker'], command: ['npm', 'run', 'lint:docker'], job: 'check', setup: 'docker' },
  { id: 'lint:actions', tier: 'check', inputs: ['workflows'], command: ['npm', 'run', 'lint:actions'], job: 'check', setup: 'docker' },
  { id: 'lint:md', tier: 'check', inputs: ['docs'], command: ['npm', 'run', 'lint:md'], job: 'check', setup: 'docs', config: ['.markdownlint-cli2.jsonc', 'package-lock.json', 'scripts/require-node-tools.sh'] },
  { id: 'lint:links', tier: 'check', inputs: ['docs'], command: ['npm', 'run', 'lint:links'], job: 'check', setup: 'docker', uncached: LINK_TARGETS },
  // Redocly over the OpenAPI document (ADR-0072). The document is generated
  // from the route declarations into packages/shared/src, and a backend change
  // that moves it moves that file; the rules are in packages/shared/redocly.yaml.
  { id: 'lint:openapi', tier: 'check', inputs: ['shared'], command: ['npm', 'run', 'lint:openapi'], job: 'check', setup: 'docker' },
  // oasdiff between the base's OpenAPI document and this one (#1090): a warning
  // while no native client exists, a failure once one does
  // (`scripts/openapi-breaking.mjs` holds the policy).
  { id: 'api:breaking', tier: 'check', inputs: ['api-contract'], command: ['npm', 'run', 'api:breaking'], job: 'check', setup: 'docker', uncached: BASE_DOCUMENT },
  // Orval regenerates the web client from the OpenAPI document and compares
  // it with the committed one (ADR-0073): a document, a mutator or an Orval
  // version changed without `npm --prefix frontend run api:client` fails here.
  { id: 'api:client', tier: 'check', inputs: ['api-contract', 'web', 'shared', 'node-deps'], command: ['npm', '--prefix', 'frontend', 'run', 'api:client:check'], job: 'check', setup: 'node' },
  // A line pointer — a file name with a line number after it — is refused
  // wherever living prose lives: a Markdown page, a code comment, a workflow's
  // `#` line. Its input is the `prose` class, which is the pass's own
  // extension list (#579). `docs` rather than `node`: the script needs the
  // runtime and nothing installed, which is the docs pass's own setup — the
  // root install CI's check job runs unconditionally — so a prose-only change
  // still installs no package.
  { id: 'lint:pointers', tier: 'check', inputs: ['prose'], command: ['node', 'scripts/lint-line-pointers.mjs'], job: 'check', setup: 'docs' },
  { id: 'check:py', tier: 'check', inputs: ['python'], command: ['npm', 'run', 'check:py'], job: 'check', setup: 'python', config: ['scripts/require-py-tools.sh', 'scripts/require-python-312.sh'] },
  { id: 'security:py:bandit', tier: 'check', inputs: ['python'], command: ['npm', 'run', 'security:py:bandit'], job: 'check', setup: 'python', config: ['scripts/require-py-tools.sh', 'scripts/require-python-312.sh'] },
  { id: 'security:py:deps', tier: 'check', inputs: ['python'], command: ['npm', 'run', 'security:py:deps'], job: 'check', setup: 'python', uncached: ADVISORIES, config: ['scripts/require-py-tools.sh', 'scripts/require-python-312.sh'] },
  { id: 'test:backend', tier: 'test', inputs: ['backend', 'web', 'shared', 'database', 'tiles', 'scripts', 'compose', 'coverage'], command: ['node', 'scripts/test-report.mjs', 'backend-unit'], job: 'test', setup: 'node', config: ['.github/workflows/ci.yml', 'docs/tech/gates.md', 'package.json'] },
  { id: 'test:frontend', tier: 'test', inputs: ['web', 'shared', 'runners', 'compose'], command: ['node', 'scripts/test-report.mjs', 'frontend-unit'], job: 'test', setup: 'node' },
  { id: 'test:py', tier: 'test', inputs: ['python', 'db-python'], command: ['npm', 'run', 'test:py'], job: 'python-tests', setup: 'python', config: ['scripts/require-py-tools.sh', 'scripts/require-python-312.sh'] },
  // The Node scan is pointed at the whole checkout, and its rule packs
  // (`p/default`, `p/owasp-top-ten`, `p/secrets`) carry Python rules, so
  // cv-python's files are its input too — not only the product's. And
  // `.semgrepignore` leaves `.jsonl` in, so `p/secrets` reads the coverage
  // lists, which agents write from web pages.
  { id: 'security:scan', tier: 'scan', inputs: ['backend', 'web', 'shared', 'database', 'tiles', 'scripts', 'compose', 'python', 'coverage'], command: ['npm', 'run', 'security:scan'], job: 'security', setup: 'docker', uncached: RULE_PACKS, config: ['.semgrepignore'] },
  { id: 'security:py:semgrep', tier: 'scan', inputs: ['python'], command: ['npm', 'run', 'security:py:semgrep'], job: 'security', setup: 'docker', uncached: RULE_PACKS, config: ['.semgrepignore'] },
  { id: 'security:image', tier: 'scan', inputs: ['python'], command: ['npm', 'run', 'security:image'], job: 'trivy', setup: 'docker', uncached: VULNERABILITY_DATABASE, config: ['scripts/scan-image.sh'] },
  // The stack tier is printed and never spawned, so this one line is two
  // commands: it is what a person types, not an argv the runner passes on.
  { id: 'build', tier: 'stack', inputs: ['backend', 'web', 'shared'], command: ['npm', 'run', 'build', '&&', 'npm', '--prefix', 'frontend', 'run', 'size'], job: 'build', setup: 'node' },
  { id: 'test:e2e:smoke', tier: 'stack', inputs: ['backend', 'web', 'shared', 'database', 'tiles', 'runners', 'compose'], command: ['npm', 'run', 'test:e2e:smoke'], job: 'smoke', setup: 'docker' },
  // The database-backed backend specs (#522): the ones that need a real
  // Postgres, by the criterion in docs/tech/development-guide.md § Tests that
  // need a database. They run inside the same isolated stack the smoke lane
  // stands up, so they hang off that job and share its inputs.
  { id: 'test:db', tier: 'stack', inputs: ['backend', 'shared', 'database', 'runners', 'compose'], command: ['npm', 'run', 'test:db'], job: 'smoke', setup: 'docker' },
  // The API contract lane (#1091): Schemathesis against the backend of that
  // same stack, as each of the fixture's accounts, reads only. It hangs off
  // the smoke job for the stack it stands up, as the database lane does.
  { id: 'test:api', tier: 'stack', inputs: ['backend', 'shared', 'database', 'runners', 'compose'], command: ['npm', 'run', 'test:api'], job: 'smoke', setup: 'docker' },
  { id: 'perf', tier: 'stack', inputs: ['backend', 'web', 'shared', 'database', 'tiles', 'runners', 'compose'], command: ['npm', 'run', 'perf:local'], job: 'perf', setup: 'docker' , local: PERF_LOCAL},
];

/**
 * The tracked paths no gate reads, each with the reason (ADR-0092). With no
 * class that runs everything, a file a gate reads but the map never names would
 * go unchecked locally and in CI alike, so `scripts/gates.test.mjs` holds every
 * tracked path to a class, a gate's `config`, or this list.
 */
export const UNREAD = [
  {
    path: '.agents/skills/',
    why: 'Links to .claude/skills for another agent (ADR-0080); the skills they point to are docs.',
  },
  {
    path: '.gitignore',
    why: 'Decides what git tracks, not what a gate reads: a file it newly ignores leaves the tree every gate sees.',
  },
  {
    path: 'LICENSE',
    why: 'No gate reads it. A link to it is lint:links’ gap for non-Markdown targets (§ What the map does not reach).',
  },
  {
    path: 'repomix.config.json',
    why: 'The settings of a packing tool no gate runs.',
  },
];

/**
 * Where each stack lane of this decision is owed (#1379): `run here`, under the
 * command of each `local` entry whose classes or runner files the change
 * touches, less one another owed entry covers, `CI runs it`
 * when it is asked for and CI answers for it alone, `skip` when nothing it
 * reads changed. A decision that runs everything owes every local entry.
 */
export function stackVerdicts(decision) {
  return decision.gates
    .filter((gate) => gate.tier === 'stack')
    .flatMap((gate) => {
      if (!gate.applies) return [{ ...gate, verdict: 'skip', reason: gate.why }];
      const changed = new Set(decision.paths ?? []);
      const due = (gate.local ?? []).filter((entry) =>
        decision.everything
        || entry.reads.some((id) => decision.inputs.has(id))
        || (entry.files ?? []).some((file) => changed.has(file)));
      // A measurement another owed one includes is not owed beside it:
      // perf:local runs the latency probe as its last step.
      const covered = new Set(due.map((entry) => entry.covers).filter(Boolean));
      const owed = due.filter((entry) => !covered.has(entry.command));
      if (!owed.length) return [{ ...gate, verdict: 'CI runs it', reason: gate.why }];
      // One line per measurement owed, under its own command: a backend change
      // owes the latency probe, not Lighthouse.
      return owed.map((entry) => ({
        ...gate,
        command: entry.command.split(' '),
        verdict: 'run here',
        reason: `${gate.why}; ${entry.why}`,
      }));
    });
}

/** The tiers `run` accepts. `stack` is listed by it, never run by it. */
const TIERS = ['check', 'test', 'scan', 'stack'];

/**
 * The files that decide what CI runs at all (ADR-0092): the map and the
 * workflow that applies it. In CI a change to one runs every gate, because an
 * edit that narrows the map could otherwise skip the very gate it broke, and a
 * job's definition is tested only by running it. Locally they ask for their
 * readers alone — the map's and the workflow's specs, actionlint — and CI
 * answers for the rest before anything merges.
 */
export const CI_GLOBAL = ['.github/workflows/ci.yml', 'scripts/gates.mjs'];

/**
 * The files every gate's cache key covers (ADR-0091) without their change
 * asking for every gate: the map, the cache, and the root manifests whose
 * scripts and tools the gates run through. A pass recorded under older gate
 * machinery is never reused, and that is all an edit to it costs.
 */
const KEY_GLOBALS = ['scripts/gates.mjs', 'scripts/gate-cache.mjs', 'package.json', 'package-lock.json'];

/**
 * The root npm scripts the workflow runs by name (`npm run check`, `npm run
 * perf`, `npm run setup:py:dev`): part of a CI job's definition, so in CI a
 * change to one runs every gate, like a change to the workflow itself
 * (ADR-0092). `npm --prefix <dir> run` names a package's script, not the
 * root's, and is left out.
 */
export function workflowScripts(workflow) {
  return new Set(
    [...String(workflow).matchAll(/npm (?:-s )?run (?:-s )?([\w:.-]+)/g)].map(([, name]) => name),
  );
}

/** The prefix a changed npm script of the root package.json is reported under. */
export const SCRIPT_PREFIX = 'package.json#scripts/';

/**
 * The root npm scripts a gate runs: the one its command names, and every one
 * that script runs through `npm run`, transitively (`check:py` runs `lint:py`).
 * A gate whose command is not a root `npm run` runs none.
 */
export function gateScripts(gate, scripts) {
  const [tool, verb, name] = gate.command;
  if (tool !== 'npm' || verb !== 'run') return new Set();
  const seen = new Set();
  const queue = [name];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    for (const [, called] of String(scripts[next] ?? '').matchAll(/npm (?:-s )?run (?:-s )?([\w:.-]+)/g)) {
      queue.push(called);
    }
  }
  return seen;
}

function matches(pattern, path) {
  if (pattern instanceof RegExp) return pattern.test(path);
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  return path === pattern;
}

const belongsTo = (input, path) => input.paths.some((pattern) => matches(pattern, path));

/**
 * The paths whose content enters a gate's cache key (ADR-0091): its own input
 * classes and config files, the gate machinery and root manifests, and the
 * Node manifests and lockfiles every Node gate runs its installed tools from.
 */
export function keyBelongs(gate) {
  const ids = new Set([...gate.inputs, 'node-deps']);
  const classes = INPUTS.filter((input) => ids.has(input.id));
  const files = new Set([...(gate.config ?? []), ...KEY_GLOBALS]);
  return (path) => files.has(path) || classes.some((input) => belongsTo(input, path));
}

/** Which input classes these paths touch, and which of them touch none. */
export function classifyPaths(paths) {
  const inputs = new Set(
    INPUTS.filter((input) => paths.some((path) => belongsTo(input, path))).map((i) => i.id),
  );
  const unclassified = paths.filter((path) => !INPUTS.some((input) => belongsTo(input, path)));
  return { inputs, unclassified };
}

/** A GitHub Actions output holds one line, so the reason is collapsed to one. */
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

/**
 * Every gate runs. The per-gate `why` is the short form rather than the
 * reason, which the caller prints once above the list: repeating one sentence
 * on every line buries the list it is meant to explain.
 */
function everything(reason, inputs, unclassified) {
  return {
    everything: true,
    reason,
    inputs,
    unclassified,
    gates: GATES.map((gate) => ({ ...gate, applies: true, why: 'every gate applies' })),
  };
}

/**
 * What this change asks for. Pure: the caller supplies the paths, so the same
 * decision serves the CLI, CI and the tests.
 *
 * `paths === null` means the change set could not be worked out at all, which
 * is the one case that runs everything without knowing why it must.
 *
 * A path may name an npm script of the root package.json
 * (`package.json#scripts/lint:md`, from `packageChanges`): it asks for the gates
 * that run that script. `package.json#other` — a change to the root manifest
 * outside its scripts and dependencies — is one this map cannot place, and asks
 * for everything. `scripts` is the root manifest's `scripts` object, which says
 * what each gate's script runs in turn. `ci` is true on a CI runner, where a
 * change to the map or the workflow (`CI_GLOBAL`) runs everything; elsewhere the
 * decision says CI will, and asks for the readers alone. `ciScripts` holds the
 * root npm scripts the workflow runs by name (`workflowScripts`): a change to
 * one is a change to a CI job's definition, and counts as `CI_GLOBAL` does.
 */
export function decide({ paths, reason, scripts = {}, ci = false, ciScripts = new Set() }) {
  if (paths === null) {
    return everything(
      reason ?? 'The set of changed paths is unknown, so every gate applies.',
      new Set(),
      [],
    );
  }

  const changedScripts = new Set(
    paths.filter((path) => path.startsWith(SCRIPT_PREFIX)).map((path) => path.slice(SCRIPT_PREFIX.length)),
  );
  const files = paths.filter((path) => !path.startsWith(SCRIPT_PREFIX));
  const { inputs, unclassified: unplaced } = classifyPaths(files);
  const configured = new Set(GATES.flatMap((gate) => gate.config ?? []));
  const unclassified = unplaced.filter((path) => !configured.has(path) && path !== 'package.json#other');

  if (paths.includes('package.json#other')) {
    return everything(
      'The root package.json changed outside its scripts and dependencies, which no gate'
      + ' reads on its own, so every gate applies.',
      inputs,
      unclassified,
    );
  }
  const global = paths.find((path) => CI_GLOBAL.includes(path)
    || (path.startsWith(SCRIPT_PREFIX) && ciScripts.has(path.slice(SCRIPT_PREFIX.length))));
  if (ci && global !== undefined) {
    return everything(
      `${global} decides what CI runs, so in CI every gate applies (ADR-0092).`,
      inputs,
      unclassified,
    );
  }

  const gates = GATES.map((gate) => {
    const touched = gate.inputs.filter((id) => inputs.has(id));
    const own = (gate.config ?? []).filter((file) => paths.includes(file));
    const ran = [...gateScripts(gate, scripts)].filter((name) => changedScripts.has(name));
    const reasons = [
      ...(touched.length ? [`inputs touched: ${touched.join(', ')}`] : []),
      ...own.map((file) => `reads ${file}`),
      ...ran.map((name) => `runs the changed npm script ${name}`),
    ];
    return {
      ...gate,
      applies: reasons.length > 0,
      why: reasons.length ? reasons.join('; ') : `inputs untouched: ${gate.inputs.join(', ')}`,
    };
  });

  const count = `${paths.length} changed path${paths.length === 1 ? '' : 's'}`;
  return {
    everything: false,
    ciNote:
      global === undefined
        ? null
        : `${global} decides what CI runs, so CI runs every gate for this change; locally its readers do (ADR-0092).`,
    reason: inputs.size
      ? `${count} touching: ${[...inputs].join(', ')}`
      : `${count}, none of them an input to any gate.`,
    inputs,
    unclassified,
    gates,
    paths,
  };
}

/**
 * The lines CI reads: one key per job, three that say which toolchain the check
 * job must install first — there is no `job_check_docker` because every runner
 * already has Docker, so a Docker-only check needs no setup step — and two that
 * split the security job's two scans, which share a job and share nothing else.
 *
 * Every key is printed on every run, whatever changed: a key that appeared only
 * sometimes would reach a job-level `if:` as the empty string and read as false.
 */
export function githubOutputs(decision) {
  const applying = decision.gates.filter((gate) => gate.applies);
  const hasJob = (job) => applying.some((gate) => gate.job === job);
  const hasGate = (id) => applying.some((gate) => gate.id === id);
  const hasSetup = (setup) =>
    applying.some((gate) => gate.tier === 'check' && gate.setup === setup);

  const values = {
    job_check: hasJob('check'),
    job_check_node: hasSetup('node'),
    job_check_python: hasSetup('python'),
    job_check_docs: hasSetup('docs'),
    job_test: hasJob('test'),
    // The unit job runs both Node lanes as steps of their own, in the shape of
    // the two Semgrep steps: a backend change does not install or run the web's
    // specs, and a change the web's lane alone reads does not run the backend's.
    job_test_backend: hasGate('test:backend'),
    job_test_frontend: hasGate('test:frontend'),
    job_python_tests: hasJob('python-tests'),
    job_build: hasJob('build'),
    job_security: hasJob('security'),
    // The Python scan reads cv-python and nothing else, so a change in
    // backend/ cannot alter its answer; the Node scan reads the whole checkout,
    // cv-python included, so it has both classes as inputs. The job-level key
    // starts the job; these two say which of its steps has anything to read.
    job_security_node: hasGate('security:scan'),
    job_security_python: hasGate('security:py:semgrep'),
    job_trivy: hasJob('trivy'),
    job_smoke: hasJob('smoke'),
    // The database lane is a step of the smoke job, in the same shape as the
    // two Semgrep steps: the job-level key starts the job, this one says the
    // step has something to read. Both gates read a subset of what the smoke
    // gate reads, so neither can be true while `job_smoke` is false — and
    // gates.test.mjs pins that, since a smoke gate narrowed on its own would
    // strand the step in a skipped job that reports Success.
    job_test_db: hasGate('test:db'),
    // The API contract lane, a step of the same job in the same shape.
    job_test_api: hasGate('test:api'),
    job_perf: hasJob('perf'),
  };
  return [
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    `reason=${oneLine(decision.reason)}`,
  ];
}

/**
 * A cell of a Markdown table. A pipe inside one ends the cell even in a code
 * span, and `/(^|\/)Dockerfile[^/]*$/` carries one.
 *
 * The pipe is the cell's only metacharacter, and it is escaped at the table
 * level: GFM strips the backslash before `|` and then parses the cell inline,
 * where a backslash inside a code span is literal. So the backslashes in
 * `/^db\/.*\.py$/` must stay as they are — escaping them, as a general
 * escaper would, prints them doubled on the page. That is why this is a
 * split-and-join over the one character rather than an escape function.
 */
const cell = (text) => text.split('|').join('\\|');
const code = (text) => `\`${cell(text)}\``;
const codes = (values) => values.map((value) => code(String(value))).join(', ');

/** The two tables docs/tech/gates.md embeds, so the map is written once. */
export function renderTable() {
  const inputRows = INPUTS.map(
    (input) => `| ${code(input.id)} | ${codes(input.paths)} | ${cell(input.note)} |`,
  );
  // The stack tier is listed and never run, so nothing records its passes.
  const reuse = (gate) => {
    if (gate.tier === 'stack') return 'never: run by hand';
    return gate.uncached ? `never: ${gate.uncached}` : 'on the same inputs';
  };
  const gateRows = GATES.map(
    (gate) =>
      `| ${code(gate.id)} | ${gate.tier} | ${codes(gate.inputs)}`
      + `${gate.config ? `; reads ${codes(gate.config)}` : ''} |`
      + ` ${code(gate.command.join(' '))} | ${gate.job} | ${cell(reuse(gate))} |`,
  );
  const unreadRows = UNREAD.map((entry) => `| ${code(entry.path)} | ${cell(entry.why)} |`);
  return [
    '### Inputs',
    '',
    '| Input | Paths | Why this is what it is |',
    '| --- | --- | --- |',
    ...inputRows,
    '',
    '### Gates',
    '',
    '| Gate | Tier | Inputs | Local command | CI job | Pass reused |',
    '| --- | --- | --- | --- | --- | --- |',
    ...gateRows,
    '',
    '### Read by no gate',
    '',
    '| Path | Why |',
    '| --- | --- |',
    ...unreadRows,
    '',
  ].join('\n');
}

/**
 * Git, asked about the repository the command was run in.
 *
 * The three location variables are dropped from the environment: git sets them
 * for a hook, and a hook that ran this would otherwise have it read a temporary
 * index or another worktree entirely.
 */
const git = (...args) => {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...env } = process.env;
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, env });
};

/** What GitHub sends as `before` for a branch's first push: no base at all. */
const ZERO_SHA = '0'.repeat(40);

/**
 * The base a local run measures against: `main`, unless `origin/main` has moved
 * past it. A clone's own `main` falls behind every merge made on GitHub, and a
 * change measured against a stale one counts every file merged since as its
 * own, asking for gates nothing on the branch touched. A local `main` with
 * commits of its own is the one meant, and is kept.
 */
export function freshestBase(present, isAncestor) {
  if (present.includes('main') && present.includes('origin/main') && isAncestor('main', 'origin/main')) {
    return 'origin/main';
  }
  return present[0];
}

/**
 * Which commit the change is measured against, or the reason there is none.
 *
 * A base that was *given* is authoritative, and that includes one given empty:
 * `--base`, or `GATES_BASE` merely being present in the environment, settles
 * the question and never falls back. CI sets the variable on every run and
 * sends the zero sha where the event carries no base of its own — a manual
 * dispatch, or a ref that had no previous tip — so it never sends an empty
 * value, and one arriving here was typed by a person or left by a later edit
 * of the workflow. Falling back to `main` in either case would compare the
 * checked-out tip with itself, find an empty change set and skip every gate:
 * a green run that checked nothing, which is the one outcome this file exists
 * to prevent. So an empty value and the zero sha both mean "no base", and
 * everything runs.
 *
 * Only an *unset* variable falls through to the local branches, which is the
 * case of a person running `npm run gates` in a checkout.
 */
function resolveBase(given) {
  let source = null;
  if (given !== null && given !== undefined) source = { name: '--base', value: given };
  else if ('GATES_BASE' in process.env) {
    source = { name: 'GATES_BASE', value: process.env.GATES_BASE };
  }

  if (source) {
    const named = (source.value ?? '').trim();
    if (named === '') {
      return {
        base: null,
        reason: `${source.name} is empty: nothing to diff against, so every gate applies.`,
      };
    }
    if (named === ZERO_SHA) {
      return {
        base: null,
        reason:
          `${source.name} is the zero sha, which names no commit (a first push,`
          + ' a ref just created, or a run with no base of its own): nothing to'
          + ' diff against, so every gate applies.',
      };
    }
    return { base: named, flag: source.name === '--base', reason: null };
  }

  const present = ['main', 'origin/main'].filter((ref) => {
    try {
      git('rev-parse', '--verify', '-q', ref);
      return true;
    } catch {
      return false; // not in this clone — give up rather than guess
    }
  });
  if (present.length) {
    const isAncestor = (older, newer) => {
      try {
        git('merge-base', '--is-ancestor', older, newer);
        return true;
      } catch {
        return false;
      }
    };
    return { base: freshestBase(present, isAncestor), reason: null };
  }
  return {
    base: null,
    reason:
      'No base to compare against (no --base, no GATES_BASE, no main, no origin/main),'
      + ' so every gate applies.',
  };
}

/**
 * What changed in the root package.json, as paths the map can read (ADR-0092).
 * Pure: the caller hands it both versions of the manifest.
 *
 * Each npm script whose text differs is `package.json#scripts/<name>`; a change
 * to the root's dependencies is the lockfile's business and is reported by it;
 * any other change — `engines`, a renamed field, a manifest that does not parse —
 * is `package.json#other`, which runs everything.
 */
export function packageChanges(before, after) {
  let old;
  let now;
  try {
    old = JSON.parse(before ?? '{}');
    now = JSON.parse(after ?? '{}');
  } catch {
    return ['package.json#other'];
  }
  const changed = [];
  const names = new Set([...Object.keys(old.scripts ?? {}), ...Object.keys(now.scripts ?? {})]);
  for (const name of [...names].sort()) {
    if ((old.scripts ?? {})[name] !== (now.scripts ?? {})[name]) changed.push(`${SCRIPT_PREFIX}${name}`);
  }
  const rest = (manifest) => {
    const { scripts, dependencies, devDependencies, ...others } = manifest;
    return JSON.stringify(others);
  };
  if (rest(old) !== rest(now)) changed.push('package.json#other');
  return changed;
}

/**
 * Which commit the change set is listed from. Pure: the caller says whether the
 * base came from `--base`, whether it is an ancestor of the revision, and
 * whether it lies on `main`'s line (an ancestor of `main` or `origin/main`).
 *
 * The merge base keeps out what the base's own line gained since the fork —
 * `main`'s commits, for a branch measured against `main` — and for a base that
 * is an ancestor it is the base itself. A base typed with `--base` that is *not*
 * an ancestor, and is not on `main`'s line either, is a pushed head the branch
 * has since rewritten past: a review wave folded into its commits, or a rebase.
 * Its merge base is the fork point from `main`, and listing from there reads
 * the wave as the whole branch. So the two trees are compared instead: what
 * differs from the tree the base holds, which is the one CI answered for. After
 * a rebase onto a newer `main` that also lists what `main` moved, which
 * over-reports — the safe direction.
 *
 * A `main` the branch forked from earlier (`--base origin/main` after a merge
 * on GitHub) is no ancestor either, and keeps the merge base: what it gained
 * since the fork is not the branch's. So does `GATES_BASE`, which CI sets from
 * the event: a pull request's base or a push's previous tip, never a head the
 * branch was rewritten past.
 */
export function listFrom({ base, flag, isAncestor, onMainLine, mergeBase }) {
  if (flag && !isAncestor && !onMainLine) return { from: base, how: 'tree' };
  return { from: mergeBase, how: 'merge-base' };
}

/**
 * The paths this change touches (impure: it asks git).
 *
 * `--no-renames` so that a file's old path counts as changed too: a gate whose
 * input was moved out from under it still has to run. Against `HEAD` the
 * comparison is the working tree rather than the commit, plus the files git
 * does not track yet, so that `npm run check` answers for what is on disk.
 */
export function changedPaths({ base, rev }) {
  const { base: resolved, flag, reason: noBase } = resolveBase(base);
  if (!resolved) {
    return { paths: null, base: null, mergeBase: null, reason: noBase };
  }

  let mergeBase;
  try {
    mergeBase = git('merge-base', resolved, rev).trim();
  } catch (error) {
    return {
      paths: null,
      base: resolved,
      mergeBase: null,
      reason:
        `No merge base between ${resolved} and ${rev}`
        + ` (${oneLine(error.stderr || error.message)}), so every gate applies.`,
    };
  }

  const isAncestorOf = (newer) => {
    try {
      git('merge-base', '--is-ancestor', resolved, newer);
      return true;
    } catch {
      return false; // not an ancestor, or a ref this clone does not have
    }
  };
  const { from, how } = listFrom({
    base: resolved,
    flag,
    isAncestor: isAncestorOf(rev),
    onMainLine: ['main', 'origin/main'].some(isAncestorOf),
    mergeBase,
  });

  const lines = (text) => text.split('\n').filter(Boolean);
  const againstWorkingTree = rev === 'HEAD';
  let changed;
  let untracked;
  try {
    changed = lines(
      againstWorkingTree
        ? git('diff', '--name-only', '--no-renames', from)
        : git('diff', '--name-only', '--no-renames', from, rev),
    );
    untracked = againstWorkingTree ? lines(git('ls-files', '--others', '--exclude-standard')) : [];
  } catch (error) {
    // A corrupt index, a file git cannot stat, a worktree half-removed. It is
    // still "the change set is unknown", and the reader needs the sentence
    // rather than a V8 stack trace out of `main`.
    return {
      paths: null,
      base: resolved,
      mergeBase,
      reason:
        `git could not list the change against ${from.slice(0, 7)}`
        + ` (${oneLine(error.stderr || error.message)}), so every gate applies.`,
    };
  }

  const paths = [...new Set([...changed, ...untracked])];
  if (paths.includes('package.json')) {
    // The manifest itself stays on the list: the specs that read it ask for it.
    const read = (spec) => {
      try {
        return git('show', spec);
      } catch {
        return '{}';
      }
    };
    const onDisk = () => {
      try {
        return readFileSync(`${git('rev-parse', '--show-toplevel').trim()}/package.json`, 'utf8');
      } catch {
        return '{}';
      }
    };
    const now = againstWorkingTree ? onDisk() : read(`${rev}:package.json`);
    paths.push(...packageChanges(read(`${from}:package.json`), now));
  }
  return {
    paths: paths.sort(),
    base: resolved,
    mergeBase,
    from: how,
    reason: null,
  };
}

const USAGE = [
  'usage: gates.mjs [--base <ref>] [--rev <ref>] [--json | --github-output | --table]',
  '       gates.mjs run <check|test|scan|stack> [--all] [--no-cache] [--affected] [--base <ref>] [--rev <ref>]',
].join('\n');

/**
 * Read the command line, refusing anything it cannot read rather than carrying
 * on with a default. A misread argument here is the worst kind of wrong: it
 * degrades into "nothing to run", which looks exactly like a clean gate.
 */
export function parseArgs(argv) {
  const args = { mode: 'list', tier: null, all: false, noCache: false, affected: false, base: null, rev: 'HEAD' };
  let modeSetBy = null;

  const setMode = (mode, flag) => {
    if (modeSetBy) throw new Error(`Pick one mode: ${modeSetBy} or ${flag}.`);
    modeSetBy = flag;
    args.mode = mode;
  };
  const value = (i, flag) => {
    const given = argv[i];
    if (given === undefined || given.trim() === '' || given.startsWith('--')) {
      throw new Error(`${flag} needs a value.`);
    }
    return given;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'run') {
      setMode('run', 'run');
      const tier = argv[i + 1];
      if (tier === undefined || tier.startsWith('--')) {
        throw new Error(`run needs a tier: ${TIERS.join(', ')}.`);
      }
      if (!TIERS.includes(tier)) {
        throw new Error(`"${tier}" is not a tier. Pick one of: ${TIERS.join(', ')}.`);
      }
      args.tier = tier;
      i += 1;
    } else if (arg === '--json') setMode('json', '--json');
    else if (arg === '--github-output') setMode('github-output', '--github-output');
    else if (arg === '--table') setMode('table', '--table');
    else if (arg === '--all') args.all = true;
    else if (arg === '--no-cache') args.noCache = true;
    else if (arg === '--affected') args.affected = true;
    else if (arg === '--base') args.base = value(++i, '--base');
    else if (arg === '--rev') args.rev = value(++i, '--rev');
    else throw new Error(`Unknown argument "${arg}".`);
  }
  // `--all` widens what `run` runs and means nothing to the other modes. Taking
  // it silently would let `gates.mjs --all` read as "everything ran".
  if (args.all && args.mode !== 'run') {
    throw new Error('--all only means something with `run <tier>`.');
  }
  if (args.noCache && args.mode !== 'run') {
    throw new Error('--no-cache only means something with `run <tier>`.');
  }
  // The selection narrows the unit lanes and nothing else; with --all, which
  // forces every gate whole, it would contradict what was asked.
  if (args.affected && args.tier !== 'test') {
    throw new Error('--affected only means something with `run test`.');
  }
  if (args.affected && args.all) throw new Error('Pick one: --affected or --all.');
  return args;
}

/**
 * An image a gate runs, pinned by digest: `name:tag@sha256:…` in a root npm
 * script, or a bare `name@sha256:…` with the version in a comment, as a runner
 * script may spell it.
 */
const PINNED_IMAGE = /[a-z0-9][\w./-]*(?::[\w.-]+)?@sha256:[0-9a-f]{64}/g;

/** The repository scripts an npm script runs by path (`node scripts/openapi-breaking.mjs`). */
const RUNNER_FILE = /scripts\/[\w./-]+\.(?:mjs|js|sh)\b/g;

/**
 * The pinned images a Docker gate runs, what has to be pulled before it can
 * say anything: those its npm scripts name, and those named in the runner
 * files the scripts run, where `api:breaking` keeps its oasdiff pin.
 */
export function imagesOf(gate, scripts = rootScripts(), read = rootFile) {
  if (gate.setup !== 'docker') return [];
  const texts = [...gateScripts(gate, scripts)].map((name) => String(scripts[name] ?? ''));
  const files = new Set(texts.flatMap((text) => text.match(RUNNER_FILE) ?? []));
  for (const file of files) texts.push(read(file));
  return [...new Set(texts.flatMap((text) => text.match(PINNED_IMAGE) ?? []))];
}

/**
 * What a registry or the network answers when it refuses a pull for no fault
 * of the change: Docker Hub's anonymous limit (`toomanyrequests`), a timeout,
 * a refused or reset connection, a name that does not resolve. A pin that
 * names no manifest is not among them: that is the repository's error, and
 * the gate runs and fails on it.
 */
const REGISTRY_REFUSAL = /toomanyrequests|rate limit|TLS handshake timeout|i\/o timeout|connection (?:refused|reset)|no such host|unexpected status|Client\.Timeout/i;

/** The exit a run ends with when the environment, not a gate, failed (EX_TEMPFAIL): run it again later. */
export const ENVIRONMENT_FAILED = 75;

/**
 * Pull the images a Docker gate runs before it runs (#1316), and answer the
 * refusal that is the environment's, if any. An image already on the host is
 * not pulled again; a host without Docker answers no refusal and the gate
 * reports that itself.
 */
function registryRefusal(gate, spawn) {
  for (const image of imagesOf(gate)) {
    if (spawn('docker', ['image', 'inspect', '--format', '.', image], { stdio: 'ignore' }).status === 0) continue;
    const pulled = spawn('docker', ['pull', '--quiet', image], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (pulled.status === 0) continue;
    const said = `${pulled.stderr ?? ''}${pulled.stdout ?? ''}`.trim();
    if (REGISTRY_REFUSAL.test(said)) return { image, said: said.split('\n').filter(Boolean).at(-1) };
  }
  return null;
}

/**
 * Run one tier's applicable gates, stopping at the first failure (impure).
 *
 * Returns the exit code rather than taking it: what a gate did is the caller's
 * to report, and a pure-ish return keeps this readable from a test. `spawn` is
 * injectable for the same reason — the shapes this prints are the whole point
 * of the runner, so a test drives them without spawning anything.
 *
 * A base given as `--base` reaches each gate as `GATES_BASE`, so `api:breaking`
 * compares the contract at that base's merge base with the branch: the base
 * itself while it is an ancestor, the fork from `main` once a fold rewrote the
 * branch past it, which reports the branch's contract changes and not only the
 * wave's.
 *
 * `cache` is what `openGateCache` returns, or null for a run that reuses
 * nothing (ADR-0091). A gate whose key has a recorded pass is not spawned; it
 * is printed as reused, with when and where it passed, and named on a line of
 * its own in the summary — a reuse that read as a fresh pass would be the
 * silence this runner exists to break.
 *
 * `select(gate)` is the affected selection of a unit lane (`--affected`,
 * scripts/affected-specs.mjs), or null for a whole run: it returns
 * `{ whole, why, env }`, or `{ none: true, why }` when no spec of the lane
 * reaches the change, which starts nothing and is named in the summary. The lane says which it ran and why. A selected run is
 * not the lane's pass, so it is never recorded; a whole pass already recorded
 * answers for it.
 */
export function runTier(decision, tier, { all = false, spawn = spawnSync, base, cache = null, select = null } = {}) {
  const gates = decision.gates.filter((gate) => gate.tier === tier);

  // "Everything applies" owes its sentence here as much as in the listing: a
  // run that spends fifteen gates on a shallow clone, or a stack listing whose
  // every line reads `(every gate applies)`, must say what made the change set
  // unknown — or that a change only every gate can answer for — rather than
  // leaving a reader to infer it from the length of the run (#783).
  if (decision.everything) console.log(`${decision.reason}\n`);
  if (decision.ciNote) console.log(`${decision.ciNote}\n`);

  if (tier === 'stack') {
    console.log('The stack tier, lane by lane — CI runs every lane this change asks for on every pushed head:\n');
    // Each line says whether the lane is owed here, left to CI, or not asked
    // for at all, and why (#1379). A local run of a lane CI also runs repeats
    // it; only a lane that measures what CI cannot hold is owed by hand.
    for (const gate of stackVerdicts(decision)) {
      console.log(`  ${gate.verdict.padEnd(10)} ${gate.id.padEnd(16)} ${gate.command.join(' ')}  (${gate.reason})`);
    }
    console.log('\nA lane marked "run here" is typed by hand; a lane CI reports red is reproduced here on its own.');
    return 2;
  }

  const selected = gates.filter((gate) => all || gate.applies);
  if (selected.length === 0) {
    console.log(
      `Nothing to run for tier ${tier}: no changed path is an input to `
      + `${gates.map((gate) => gate.id).join(', ')}. \`--all\` runs every gate.`,
    );
    return 0;
  }

  const ran = [];
  const reused = [];
  const unrecorded = [];
  const reachedNone = [];
  let failed = null;
  for (const gate of selected) {
    const lookup = cache && !gate.uncached ? cache.lookup(gate) : null;
    if (lookup?.pass) {
      const { passedAt, rev } = lookup.pass;
      console.log(`✓ ${gate.id}  reused: passed on these inputs at ${passedAt} (${rev})`);
      reused.push(`${gate.id} (${passedAt}, ${rev})`);
      continue;
    }
    const selection = select ? select(gate) : null;
    if (selection?.none) {
      console.log(`○ ${gate.id}  affected specs: ${selection.why}`);
      reachedNone.push(gate.id);
      continue;
    }
    console.log(`▶ ${gate.id}  ${gate.command.join(' ')}`);
    const refusal = registryRefusal(gate, spawn);
    if (refusal) {
      console.error(
        `${gate.id} could not run: the registry refused ${refusal.image} (${refusal.said}). `
        + 'That is the environment\'s failure, not the gate\'s verdict on the change: run it again once the registry answers.',
      );
      failed = { gate, code: ENVIRONMENT_FAILED, environment: true };
      break;
    }
    if (selection) {
      console.log(`  ${selection.whole ? 'whole lane' : 'affected specs'}: ${selection.why}`);
    }
    // A selection reaches the lane only through these two variables, so a
    // run that is not selected clears them: one inherited from a shell, or
    // from a selected run this one is nested in, would narrow the lane while
    // it reported itself whole.
    const { TEST_REPORT_RELATED, TEST_REPORT_SPEC_TOTAL, ...inherited } = process.env;
    const selecting = selection?.env !== undefined;
    const narrowed = selecting || TEST_REPORT_RELATED !== undefined || TEST_REPORT_SPEC_TOTAL !== undefined;
    let env = narrowed ? { ...inherited, ...(selection?.env ?? {}) } : process.env;
    // `null` is what `parseArgs` leaves where no `--base` was given; only a
    // string was given, and an empty one is given too (`resolveBase`).
    if (typeof base === 'string') env = { ...env, GATES_BASE: base };
    const result = spawn(gate.command[0], gate.command.slice(1), { stdio: 'inherit', env });
    ran.push(gate.id);
    // A gate killed by a signal, or one whose binary is not there, has no
    // status; neither of those is a pass. Both also produce no output of their
    // own under `stdio: 'inherit'` — the child never got far enough to write
    // any — so the reason has to be said here or it is said nowhere.
    if (result.error) console.error(`${gate.id} could not run: ${result.error.message}`);
    else if (result.signal) console.error(`${gate.id} was killed by ${result.signal}.`);
    const code = result.status ?? 1;
    if (code !== 0) {
      failed = { gate, code };
      break;
    }
    if (lookup && !(selection && !selection.whole) && !cache.settle(gate, lookup.key)) {
      unrecorded.push(gate.id);
    }
  }

  // Reading order: what ran, what was reused, what broke, what never got its
  // turn, and last what this change never asked for. The failure sits next to
  // the run rather than under a Skipped block thirteen gates long.
  console.log(`\nRan: ${ran.length ? ran.join(', ') : 'none'}`);
  if (reused.length) {
    console.log(`Reused (passed on the same inputs, not run again): ${reused.join(', ')}`);
  }
  if (unrecorded.length) {
    console.log(`Not recorded (files changed while the gate ran): ${unrecorded.join(', ')}`);
  }
  if (reachedNone.length) {
    console.log(`Not started (the change reaches no spec of the lane): ${reachedNone.join(', ')}`);
  }
  if (failed) {
    // Unconditionally: when the last gate of a tier is the one that failed
    // there is nothing left to not run, and `Ran: a, b, c` on its own is the
    // same text a clean run prints.
    console.log(failed.environment
      ? `Failed: ${failed.gate.id} (the environment: the registry refused an image it runs; exit ${failed.code})`
      : `Failed: ${failed.gate.id} (exit ${failed.code})`);
    const notRun = selected.slice(selected.indexOf(failed.gate) + 1).map((gate) => gate.id);
    if (notRun.length) {
      console.log(`Not run (stopped after ${failed.gate.id} failed): ${notRun.join(', ')}`);
    }
  }
  const skipped = gates.filter((gate) => !selected.includes(gate));
  if (skipped.length) {
    console.log('Skipped (inputs untouched):');
    for (const gate of skipped) console.log(`  ${gate.id.padEnd(20)} ${gate.why}`);
  }
  return failed ? failed.code : 0;
}

function printList(decision, changed, rev) {
  if (changed.paths === null) console.log(decision.reason);
  else {
    const scope = rev === 'HEAD' ? ' + working tree' : '';
    const against = changed.from === 'tree'
      ? 'no ancestor of the branch any more: what differs from its tree'
      : `merge-base ${changed.mergeBase.slice(0, 7)}`;
    console.log(`Change against ${changed.base} (${against})${scope}: ${changed.paths.length} paths`);
    console.log(
      decision.inputs.size
        ? `Inputs touched: ${[...decision.inputs].join(', ')}`
        : 'No changed path is an input to any gate.',
    );
    if (decision.everything) console.log(decision.reason);
    if (decision.ciNote) console.log(decision.ciNote);
  }

  console.log('');
  for (const gate of decision.gates) {
    const verdict = gate.applies ? 'runs' : 'skipped';
    console.log(`${gate.tier.padEnd(6)}${gate.id.padEnd(22)}${verdict.padEnd(9)}${gate.why}`);
  }
  if (decision.unclassified.length) {
    console.log(`\nNot an input to any gate: ${decision.unclassified.join(', ')}`);
  }
}

/**
 * The cache a run reuses passes from, or null (ADR-0091). `--all` forces every
 * gate, so it reuses nothing either; CI never reads a record, since a runner
 * that starts from a fresh checkout is what answers for a pushed head.
 */
export function cacheFor(args, env = process.env) {
  if (args.noCache || args.all || env.CI) return null;
  return openGateCache({ belongsTo: keyBelongs });
}

/**
 * The affected selection of each Node unit lane for these changed paths
 * (impure: it reads the specs and asks the disk which paths still exist). A
 * change set it cannot read runs every lane whole.
 */
function affectedSelector(paths) {
  const top = git('rev-parse', '--show-toplevel').trim();
  const tracked = git('ls-files').split('\n').filter(Boolean);
  return (gate) => {
    const lane = LANES[gate.id];
    if (!lane) return null;
    if (paths === null) return { whole: true, why: 'the change set is unknown' };
    const specs = tracked.filter((path) => lane.specs.test(path));
    const source = (path) => {
      try {
        return readFileSync(`${top}/${path}`, 'utf8');
      } catch {
        return '';
      }
    };
    const textReaders = specs.filter((path) => readsText(source(path)));
    const loaders = tracked
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !lane.specs.test(path))
      .filter((path) => lane.roots.some((root) => path.startsWith(root)))
      .filter((path) => loadsModules(source(path)));
    const chosen = selectSpecs({
      lane: gate.id,
      changed: paths,
      exists: (path) => existsSync(`${top}/${path}`),
      textReaders,
      loaders,
    });
    if (chosen.whole) return { whole: true, why: chosen.why };
    if (chosen.targets.length === 0) {
      // `vitest related` with no paths would run every spec, so the lane is
      // not started at all.
      return { whole: false, none: true, why: `${chosen.why}; no spec of the lane reaches the change` };
    }
    return {
      whole: false,
      why: `${chosen.why}; ${specs.length} spec files in the lane`,
      env: { TEST_REPORT_RELATED: JSON.stringify(chosen.targets), TEST_REPORT_SPEC_TOTAL: String(specs.length) },
    };
  };
}

/** A file of the checkout, as it is on disk; empty if it cannot be read. */
function rootFile(path) {
  try {
    return readFileSync(`${git('rev-parse', '--show-toplevel').trim()}/${path}`, 'utf8');
  } catch {
    return '';
  }
}

/** The root manifest's npm scripts, as the checkout holds them; none if it cannot be read. */
function rootScripts() {
  try {
    return JSON.parse(rootFile('package.json')).scripts ?? {};
  } catch {
    return {};
  }
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }

  // The table is the map itself, so it needs no change set to render.
  if (args.mode === 'table') {
    console.log(renderTable());
    return;
  }

  const changed = changedPaths({ base: args.base, rev: args.rev });
  const decision = decide({
    paths: changed.paths,
    reason: changed.reason,
    scripts: rootScripts(),
    ci: Boolean(process.env.CI),
    ciScripts: workflowScripts(rootFile('.github/workflows/ci.yml')),
  });

  if (args.mode === 'json') {
    // A Set does not survive JSON.stringify, and the ids are what a reader wants.
    console.log(JSON.stringify({ ...decision, inputs: [...decision.inputs] }, null, 2));
    return;
  }
  if (args.mode === 'github-output') {
    const lines = `${githubOutputs(decision).join('\n')}\n`;
    const file = process.env.GITHUB_OUTPUT;
    if (file) appendFileSync(file, lines);
    else process.stdout.write(lines);
    return;
  }
  if (args.mode === 'run') {
    process.exit(
      runTier(decision, args.tier, {
        all: args.all,
        base: args.base,
        cache: cacheFor(args),
        select: args.affected && !process.env.CI ? affectedSelector(changed.paths) : null,
      }),
    );
  }
  printList(decision, changed, args.rev);
}

// The tests import the pure functions; only a direct run asks git anything.
if (process.argv[1] && process.argv[1].endsWith('gates.mjs')) main(process.argv.slice(2));

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
import { appendFileSync } from 'node:fs';

import { openGateCache } from './gate-cache.mjs';
import { SCRIPT_PREFIX, changedPaths, oneLine, rootFile, rootScripts } from './gates-base.mjs';
import { affectedSelector, gateScripts, printList, runTier } from './gates-run.mjs';
import { READ_EXTENSIONS } from './lint-line-pointers.mjs';

/**
 * The scripts no unit or stack lane executes: the gate map and its cache, the
 * board, the review and coverage tools, the database shell, the tool guards and
 * the gates that run them by name (`config` on their entries below). Escaped
 * for the `runners` pattern.
 */
const TOOL_SCRIPTS = [
  'affected-specs.mjs', 'board.sh', 'catalogue-coverage.sh', 'check-shrunk-files.mjs', 'ci-graph-measure.mjs', 'db-cli.sh', 'db-migrate.sh',
  'db-types.sh', 'gate-cache.mjs', 'gates.mjs', 'gates-base.mjs', 'gates-run.mjs', 'lib/db-env.sh', 'lint-line-pointers.mjs',
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
      'The GADM loaders live in db/: the Python test lane runs their tests, and'
      + ' check:py and Bandit read them with db/’s own configuration (#1736).',
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
const BASE_SIZES = "it compares each file with its size at the base and reads the branch's commit messages, neither of which is in this tree";

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
  // The repository's own scripts, under the backend's presets from the root (#655).
  { id: 'lint:scripts', tier: 'check', inputs: ['scripts'], command: ['npm', 'run', 'lint:scripts'], job: 'check', setup: 'node', config: ['backend/eslint.config.mjs', 'backend/package-lock.json'] },
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
  // A tracked file the change leaves empty or below a quarter of its bytes,
  // unless a commit names it (#537): no other gate reads what a document holds.
  // Every class, since a truncating write can land on any file.
  { id: 'lint:shrunk', tier: 'check', inputs: INPUTS.map((input) => input.id), command: ['node', 'scripts/check-shrunk-files.mjs'], job: 'check', setup: 'docs', uncached: BASE_SIZES },
  { id: 'check:py', tier: 'check', inputs: ['python', 'db-python'], command: ['npm', 'run', 'check:py'], job: 'check', setup: 'python', config: ['scripts/require-py-tools.sh', 'scripts/require-python-312.sh'] },
  { id: 'security:py:bandit', tier: 'check', inputs: ['python', 'db-python'], command: ['npm', 'run', 'security:py:bandit'], job: 'check', setup: 'python', config: ['scripts/require-py-tools.sh', 'scripts/require-python-312.sh'] },
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


/** The tiers `run` accepts. `stack` is listed by it, never run by it. */
const TIERS = ['check', 'test', 'scan', 'stack'];

/**
 * The files that decide what CI runs at all (ADR-0092): the map, the two
 * modules it reads the change and runs its tiers through, and the workflow that
 * applies it. In CI a change to one runs every gate, because an
 * edit that narrows the map could otherwise skip the very gate it broke, and a
 * job's definition is tested only by running it. Locally they ask for their
 * readers alone — the map's and the workflow's specs, actionlint — and CI
 * answers for the rest before anything merges.
 */
export const CI_GLOBAL = ['.github/workflows/ci.yml', 'scripts/gates.mjs', 'scripts/gates-base.mjs', 'scripts/gates-run.mjs'];

/**
 * The files every gate's cache key covers (ADR-0091) without their change
 * asking for every gate: the map and its two modules, the cache, and the root
 * manifests whose scripts and tools the gates run through. A pass recorded under older gate
 * machinery is never reused, and that is all an edit to it costs.
 */
const KEY_GLOBALS = [
  'scripts/gates.mjs', 'scripts/gates-base.mjs', 'scripts/gates-run.mjs', 'scripts/gate-cache.mjs', 'package.json', 'package-lock.json',
];

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
  const gateRows = GATES.map((gate) => {
    const reads = gate.config ? '; reads ' + codes(gate.config) : '';
    return `| ${code(gate.id)} | ${gate.tier} | ${codes(gate.inputs)}${reads} |`
      + ` ${code(gate.command.join(' '))} | ${gate.job} | ${cell(reuse(gate))} |`;
  });
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
      args.tier = tierOf(argv[i + 1]);
      i += 1;
    } else if (Object.hasOwn(MODE_FLAGS, arg)) setMode(MODE_FLAGS[arg], arg);
    else if (Object.hasOwn(SWITCHES, arg)) args[SWITCHES[arg]] = true;
    else if (Object.hasOwn(VALUED, arg)) args[VALUED[arg]] = value(++i, arg);
    else throw new Error(`Unknown argument "${arg}".`);
  }
  refuseCombinations(args);
  return args;
}

/** The flags that pick an output mode, the switches, and the flags that take a value. */
const MODE_FLAGS = { '--json': 'json', '--github-output': 'github-output', '--table': 'table' };
const SWITCHES = { '--all': 'all', '--no-cache': 'noCache', '--affected': 'affected' };
const VALUED = { '--base': 'base', '--rev': 'rev' };

/** The tier `run` was given, refused when it is missing or not one of `TIERS`. */
function tierOf(tier) {
  if (tier === undefined || tier.startsWith('--')) {
    throw new Error(`run needs a tier: ${TIERS.join(', ')}.`);
  }
  if (!TIERS.includes(tier)) {
    throw new Error(`"${tier}" is not a tier. Pick one of: ${TIERS.join(', ')}.`);
  }
  return tier;
}

/** Refuse a flag given where it means nothing, rather than letting it read as obeyed. */
function refuseCombinations(args) {
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

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
import { execFileSync, spawnSync } from 'node:child_process';

import { READ_EXTENSIONS } from './lint-line-pointers.mjs';

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
    id: 'app',
    paths: [
      'backend/',
      'frontend/',
      'packages/',
      'db/',
      'martin/',
      'scripts/',
      'docker-compose.yml',
      'docker-compose.test.yml',
      '.env.example',
    ],
    note:
      'The product is one contract surface, not two stacks: both sides import'
      + ' packages/shared (ADR-0065), backend specs read db/, frontend/src, martin/'
      + ' and scripts/ through repoFile(), and the smoke lane is the only gate that'
      + ' sees the backend↔frontend contract at all, so a change to any of them'
      + ' asks for all of it.',
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
    id: 'tooling',
    paths: [
      // In two classes, and both are true of it: `workflows` is what actionlint
      // reads, and `tooling` is what makes an edit to the job filter re-ask
      // every gate the filter decides for.
      '.github/workflows/ci.yml',
      'package.json',
      'package-lock.json',
      'scripts/gates.mjs',
      'scripts/require-node-tools.sh',
      'scripts/require-py-tools.sh',
      'scripts/require-python-312.sh',
      // The image scan's own runner. Every other gate's script sits under an
      // input of that gate (scripts/ is app, and the test and perf lanes read
      // app); this one's gate reads python only, so without this line an edit
      // to the scan itself — its severity, its pin — would never run it.
      'scripts/scan-image.sh',
      '.semgrepignore',
      '.markdownlint-cli2.jsonc',
      'docs/tech/gates.md',
    ],
    note:
      'A root config reaches every stack — it decides what the gates are, not'
      + ' what they read — so a change to one runs everything. That is the'
      + ' conservative answer to the reach question #783 had to settle, and the'
      + ' only one that cannot skip a gate its own change just broke.',
  },
];

/**
 * Every gate, in the order a person would meet it: the fast checks, then the
 * unit tests, then the slow scans, then the before-push stack lanes.
 *
 * `command` is an argv array — the runner spawns argv[0] directly, with no
 * shell — except in the `stack` tier, which is listed and never run, where the
 * array is the line a person types. `setup` is the toolchain a runner has to
 * install before the command works; `docker` means nothing to install, because
 * every runner already has it. `job` is the CI job the gate belongs to.
 */
export const GATES = [
  { id: 'lint:backend', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'backend', 'run', 'lint'], job: 'check', setup: 'node' },
  { id: 'lint:frontend', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'frontend', 'run', 'lint'], job: 'check', setup: 'node' },
  { id: 'typecheck:backend', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'backend', 'run', 'typecheck'], job: 'check', setup: 'node' },
  { id: 'typecheck:frontend', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'frontend', 'run', 'typecheck'], job: 'check', setup: 'node' },
  { id: 'knip:backend', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'backend', 'run', 'knip'], job: 'check', setup: 'node' },
  { id: 'knip:frontend', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'frontend', 'run', 'knip'], job: 'check', setup: 'node' },
  // The third package (ADR-0065): its own lint, typecheck and knip, the way
  // the other two have theirs. Its specs run in test:backend, like the
  // tooling's, and both sides' typechecks read its source through the link.
  { id: 'lint:shared', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'packages/shared', 'run', 'lint'], job: 'check', setup: 'node' },
  { id: 'typecheck:shared', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'packages/shared', 'run', 'typecheck'], job: 'check', setup: 'node' },
  { id: 'knip:shared', tier: 'check', inputs: ['app'], command: ['npm', '--prefix', 'packages/shared', 'run', 'knip'], job: 'check', setup: 'node' },
  { id: 'lint:circular', tier: 'check', inputs: ['app'], command: ['npm', 'run', 'lint:circular'], job: 'check', setup: 'node' },
  // Stands a fresh Postgres up from db/init, regenerates the row types and
  // diffs them against the committed file (ADR-0064): a schema edit without
  // `npm run db:types` fails here. `node` because the generator runs from
  // backend/node_modules; the database is Docker, which every runner has.
  { id: 'db:types', tier: 'check', inputs: ['schema'], command: ['npm', 'run', 'db:types:check'], job: 'check', setup: 'node' },
  { id: 'security:deps', tier: 'check', inputs: ['node-deps'], command: ['npm', 'run', 'security:deps'], job: 'check', setup: 'node' },
  { id: 'lint:shell', tier: 'check', inputs: ['shell'], command: ['npm', 'run', 'lint:shell'], job: 'check', setup: 'docker' },
  { id: 'lint:docker', tier: 'check', inputs: ['docker'], command: ['npm', 'run', 'lint:docker'], job: 'check', setup: 'docker' },
  { id: 'lint:actions', tier: 'check', inputs: ['workflows'], command: ['npm', 'run', 'lint:actions'], job: 'check', setup: 'docker' },
  { id: 'lint:md', tier: 'check', inputs: ['docs'], command: ['npm', 'run', 'lint:md'], job: 'check', setup: 'docs' },
  { id: 'lint:links', tier: 'check', inputs: ['docs'], command: ['npm', 'run', 'lint:links'], job: 'check', setup: 'docker' },
  // A line pointer — a file name with a line number after it — is refused
  // wherever living prose lives: a Markdown page, a code comment, a workflow's
  // `#` line. Its input is the `prose` class, which is the pass's own
  // extension list (#579). `docs` rather than `node`: the script needs the
  // runtime and nothing installed, which is the docs pass's own setup — the
  // root install CI's check job runs unconditionally — so a prose-only change
  // still installs no package.
  { id: 'lint:pointers', tier: 'check', inputs: ['prose'], command: ['node', 'scripts/lint-line-pointers.mjs'], job: 'check', setup: 'docs' },
  { id: 'check:py', tier: 'check', inputs: ['python'], command: ['npm', 'run', 'check:py'], job: 'check', setup: 'python' },
  { id: 'security:py:bandit', tier: 'check', inputs: ['python'], command: ['npm', 'run', 'security:py:bandit'], job: 'check', setup: 'python' },
  { id: 'security:py:deps', tier: 'check', inputs: ['python'], command: ['npm', 'run', 'security:py:deps'], job: 'check', setup: 'python' },
  { id: 'test:backend', tier: 'test', inputs: ['app'], command: ['node', 'scripts/test-report.mjs', 'backend-unit'], job: 'test', setup: 'node' },
  { id: 'test:frontend', tier: 'test', inputs: ['app'], command: ['node', 'scripts/test-report.mjs', 'frontend-unit'], job: 'test', setup: 'node' },
  { id: 'test:py', tier: 'test', inputs: ['python', 'db-python'], command: ['npm', 'run', 'test:py'], job: 'python-tests', setup: 'python' },
  // The Node scan is pointed at the whole checkout, and its rule packs
  // (`p/default`, `p/owasp-top-ten`, `p/secrets`) carry Python rules, so
  // cv-python's files are its input too — not only the product's.
  { id: 'security:scan', tier: 'scan', inputs: ['app', 'python'], command: ['npm', 'run', 'security:scan'], job: 'security', setup: 'docker' },
  { id: 'security:py:semgrep', tier: 'scan', inputs: ['python'], command: ['npm', 'run', 'security:py:semgrep'], job: 'security', setup: 'docker' },
  { id: 'security:image', tier: 'scan', inputs: ['python'], command: ['npm', 'run', 'security:image'], job: 'trivy', setup: 'docker' },
  // The stack tier is printed and never spawned, so this one line is two
  // commands: it is what a person types, not an argv the runner passes on.
  { id: 'build', tier: 'stack', inputs: ['app'], command: ['npm', 'run', 'build', '&&', 'npm', '--prefix', 'frontend', 'run', 'size'], job: 'build', setup: 'node' },
  { id: 'test:e2e:smoke', tier: 'stack', inputs: ['app'], command: ['npm', 'run', 'test:e2e:smoke'], job: 'smoke', setup: 'docker' },
  // The database-backed backend specs (#522): the ones that need a real
  // Postgres, by the criterion in docs/tech/development-guide.md § Tests that
  // need a database. They run inside the same isolated stack the smoke lane
  // stands up, so they hang off that job and share its inputs.
  { id: 'test:db', tier: 'stack', inputs: ['app'], command: ['npm', 'run', 'test:db'], job: 'smoke', setup: 'docker' },
  { id: 'perf', tier: 'stack', inputs: ['app'], command: ['npm', 'run', 'perf:local'], job: 'perf', setup: 'docker' },
];

/** The tiers `run` accepts. `stack` is listed by it, never run by it. */
const TIERS = ['check', 'test', 'scan', 'stack'];

const TOOLING = INPUTS.find((input) => input.id === 'tooling');

function matches(pattern, path) {
  if (pattern instanceof RegExp) return pattern.test(path);
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  return path === pattern;
}

const belongsTo = (input, path) => input.paths.some((pattern) => matches(pattern, path));

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
 */
export function decide({ paths, reason }) {
  if (paths === null) {
    return everything(
      reason ?? 'The set of changed paths is unknown, so every gate applies.',
      new Set(),
      [],
    );
  }

  const { inputs, unclassified } = classifyPaths(paths);

  const reaching = paths.find((path) => belongsTo(TOOLING, path));
  if (reaching !== undefined) {
    return everything(
      `${reaching} is repository-wide tooling, so every gate applies.`,
      inputs,
      unclassified,
    );
  }

  const gates = GATES.map((gate) => {
    const touched = gate.inputs.filter((id) => inputs.has(id));
    return {
      ...gate,
      applies: touched.length > 0,
      why: touched.length
        ? `inputs touched: ${touched.join(', ')}`
        : `inputs untouched: ${gate.inputs.join(', ')}`,
    };
  });

  const count = `${paths.length} changed path${paths.length === 1 ? '' : 's'}`;
  return {
    everything: false,
    reason: inputs.size
      ? `${count} touching: ${[...inputs].join(', ')}`
      : `${count}, none of them an input to any gate.`,
    inputs,
    unclassified,
    gates,
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
    // step has something to read. Today both gates read `app`, so it can never
    // be true while `job_smoke` is false — and gates.test.mjs pins that, since
    // a smoke gate narrowed on its own would strand the step in a skipped job
    // that reports Success.
    job_test_db: hasGate('test:db'),
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
  const gateRows = GATES.map(
    (gate) =>
      `| ${code(gate.id)} | ${gate.tier} | ${codes(gate.inputs)} |`
      + ` ${code(gate.command.join(' '))} | ${gate.job} |`,
  );
  return [
    '### Inputs',
    '',
    '| Input | Paths | Why this is what it is |',
    '| --- | --- | --- |',
    ...inputRows,
    '',
    '### Gates',
    '',
    '| Gate | Tier | Inputs | Local command | CI job |',
    '| --- | --- | --- | --- | --- |',
    ...gateRows,
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
    return { base: named, reason: null };
  }

  for (const ref of ['main', 'origin/main']) {
    try {
      git('rev-parse', '--verify', '-q', ref);
      return { base: ref, reason: null };
    } catch {
      // Not in this clone — try the next one, and give up rather than guess.
    }
  }
  return {
    base: null,
    reason:
      'No base to compare against (no --base, no GATES_BASE, no main, no origin/main),'
      + ' so every gate applies.',
  };
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
  const { base: resolved, reason: noBase } = resolveBase(base);
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

  const lines = (text) => text.split('\n').filter(Boolean);
  const againstWorkingTree = rev === 'HEAD';
  let changed;
  let untracked;
  try {
    changed = lines(
      againstWorkingTree
        ? git('diff', '--name-only', '--no-renames', mergeBase)
        : git('diff', '--name-only', '--no-renames', mergeBase, rev),
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
        `git could not list the change against ${mergeBase.slice(0, 7)}`
        + ` (${oneLine(error.stderr || error.message)}), so every gate applies.`,
    };
  }

  return {
    paths: [...new Set([...changed, ...untracked])].sort(),
    base: resolved,
    mergeBase,
    reason: null,
  };
}

const USAGE = [
  'usage: gates.mjs [--base <ref>] [--rev <ref>] [--json | --github-output | --table]',
  '       gates.mjs run <check|test|scan|stack> [--all] [--base <ref>] [--rev <ref>]',
].join('\n');

/**
 * Read the command line, refusing anything it cannot read rather than carrying
 * on with a default. A misread argument here is the worst kind of wrong: it
 * degrades into "nothing to run", which looks exactly like a clean gate.
 */
export function parseArgs(argv) {
  const args = { mode: 'list', tier: null, all: false, base: null, rev: 'HEAD' };
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
    else if (arg === '--base') args.base = value(++i, '--base');
    else if (arg === '--rev') args.rev = value(++i, '--rev');
    else throw new Error(`Unknown argument "${arg}".`);
  }
  // `--all` widens what `run` runs and means nothing to the other modes. Taking
  // it silently would let `gates.mjs --all` read as "everything ran".
  if (args.all && args.mode !== 'run') {
    throw new Error('--all only means something with `run <tier>`.');
  }
  return args;
}

/**
 * Run one tier's applicable gates, stopping at the first failure (impure).
 *
 * Returns the exit code rather than taking it: what a gate did is the caller's
 * to report, and a pure-ish return keeps this readable from a test. `spawn` is
 * injectable for the same reason — the shapes this prints are the whole point
 * of the runner, so a test drives them without spawning anything.
 */
export function runTier(decision, tier, { all = false, spawn = spawnSync } = {}) {
  const gates = decision.gates.filter((gate) => gate.tier === tier);

  // "Everything applies" owes its sentence here as much as in the listing: a
  // run that spends fifteen gates on a shallow clone, or a stack listing whose
  // every line reads `(every gate applies)`, must say what made the change set
  // unknown — or that a repository-wide file reached every gate — rather than
  // leaving a reader to infer it from the length of the run (#783).
  if (decision.everything) console.log(`${decision.reason}\n`);

  if (tier === 'stack') {
    console.log('The before-push tier, in the order it is meant to be typed:\n');
    // Each line says whether this change asks for the lane and why. Without
    // that, a Markdown-only branch reads a flat list telling it to spend ten
    // minutes on the smoke lane and Lighthouse for prose neither can see.
    for (const gate of gates) {
      const verdict = gate.applies ? 'run ' : 'skip';
      console.log(`  ${verdict}  ${gate.id.padEnd(16)} ${gate.command.join(' ')}  (${gate.why})`);
    }
    console.log('\nThe stack tier is run by hand — see the commands above.');
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
  let failed = null;
  for (const gate of selected) {
    console.log(`▶ ${gate.id}  ${gate.command.join(' ')}`);
    const result = spawn(gate.command[0], gate.command.slice(1), {
      stdio: 'inherit',
      env: process.env,
    });
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
  }

  // Reading order: what ran, what broke, what never got its turn, and last
  // what this change never asked for. The failure sits next to the run rather
  // than under a Skipped block thirteen gates long.
  console.log(`\nRan: ${ran.join(', ')}`);
  if (failed) {
    // Unconditionally: when the last gate of a tier is the one that failed
    // there is nothing left to not run, and `Ran: a, b, c` on its own is the
    // same text a clean run prints.
    console.log(`Failed: ${failed.gate.id} (exit ${failed.code})`);
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
    console.log(
      `Change against ${changed.base} (merge-base ${changed.mergeBase.slice(0, 7)})`
      + `${scope}: ${changed.paths.length} paths`,
    );
    console.log(
      decision.inputs.size
        ? `Inputs touched: ${[...decision.inputs].join(', ')}`
        : 'No changed path is an input to any gate.',
    );
    if (decision.everything) console.log(decision.reason);
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
  const decision = decide({ paths: changed.paths, reason: changed.reason });

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
    process.exit(runTier(decision, args.tier, { all: args.all }));
  }
  printList(decision, changed, args.rev);
}

// The tests import the pure functions; only a direct run asks git anything.
if (process.argv[1] && process.argv[1].endsWith('gates.mjs')) main(process.argv.slice(2));

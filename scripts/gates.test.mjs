import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CI_GLOBAL,
  GATES,
  INPUTS,
  classifyPaths,
  decide,
  githubOutputs,
  workflowScripts,
  keyBelongs,
  parseArgs,
  renderTable,
  UNREAD,
} from './gates.mjs';
import { packageChanges } from './gates-base.mjs';
import { gateScripts } from './gates-run.mjs';
import { backendSrc, repoFile } from './repo-root.mjs';

/** Every tracked path, or null where there is no git (the container lane). */
function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: repoFile(), encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** The ids of the gates a change of these paths asks for, in the map's order. */
const applying = (paths) =>
  decide({ paths })
    .gates.filter((gate) => gate.applies)
    .map((gate) => gate.id);

/** The `key=value` lines as an object, so a test can name one job at a time. */
function outputs(paths) {
  const lines = githubOutputs(decide({ paths }));
  return Object.fromEntries(
    lines.map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );
}

describe('what a change asks for', () => {
  it('asks only the docs gates and the secrets scan for a change of prose', () => {
    expect(applying(['docs/tech/x.md'])).toEqual(['security:secrets', 'lint:md', 'lint:links', 'lint:pointers', 'lint:shrunk']);

    // This is the case #783 was filed for: a Markdown-only pull request asks
    // for the docs gates and the secrets scan, which reads every file. The check job still runs — it is
    // where the docs pass lives — and installs no package for it.
    const out = outputs(['docs/tech/x.md']);
    expect(out.job_check).toBe('true');
    expect(out.job_check_docs).toBe('true');
    for (const key of Object.keys(out)) {
      if (key === 'reason' || key === 'job_check' || key === 'job_check_docs') continue;
      expect(out[key], key).toBe('false');
    }
  });

  it('asks the workflow lint, the pointer pass and the secrets scan, and nothing else, for a workflow that is not ci.yml', () => {
    // Every workflow is in the class, the three `claude-*.yml` included: a
    // workflow is checked by nothing else, so a mistake in one is otherwise
    // found by the run that hits it, on the branch it is already merged to.
    // The pointer pass reads a workflow's `#` lines as it reads any prose.
    expect(applying(['.github/workflows/claude-review.yml'])).toEqual(['security:secrets', 'lint:actions', 'lint:pointers', 'lint:shrunk']);

    // Docker is the lint's whole toolchain and the pointer pass needs only the
    // root install the check job runs unconditionally, so the check job starts
    // and neither node nor python turns true with it.
    const out = outputs(['.github/workflows/claude-review.yml']);
    expect(out.job_check).toBe('true');
    expect(out.job_check_docs).toBe('true');
    for (const key of Object.keys(out)) {
      if (key === 'reason' || key === 'job_check' || key === 'job_check_docs') continue;
      expect(out[key], key).toBe('false');
    }
  });

  it('asks the backend side and the stack for a change of backend source, and nothing of the web', () => {
    // The web reads the backend only through the OpenAPI document in
    // packages/shared, so a backend change that leaves it as it was cannot
    // move a web type or a web spec. Lighthouse stays: the pages it weighs
    // load the API's answers, and perf:local probes the API's latency.
    expect(applying(['backend/src/a.ts'])).toEqual([
      'lint:backend',
      'typecheck:backend',
      'knip:backend',
      'lint:circular',
      'security:secrets',
      'lint:pointers',
      'lint:shrunk',
      'test:backend',
      'security:scan',
      'build',
      'test:e2e:smoke',
      'test:db',
      'test:api',
      'perf',
    ]);

    const out = outputs(['backend/src/a.ts']);
    expect(out.job_test_backend).toBe('true');
    expect(out.job_test_frontend).toBe('false');
    expect(out.job_trivy).toBe('false');
    expect(out.job_python_tests).toBe('false');
    expect(out.job_check_python).toBe('false');
  });

  it('asks the web side, the backend unit lane and the stack for a change of web source', () => {
    // The backend unit lane scans frontend/src through repoFile() — the URL
    // safety and antimeridian guards — so it runs; the backend's lint,
    // typecheck and knip and the database and API lanes read none of it.
    expect(applying(['frontend/src/a.tsx'])).toEqual([
      'lint:frontend',
      'typecheck:frontend',
      'knip:frontend',
      'lint:circular',
      'security:secrets',
      'api:client',
      'lint:pointers',
      'lint:shrunk',
      'test:backend',
      'test:frontend',
      'security:scan',
      'build',
      'test:e2e:smoke',
      'perf',
    ]);
    const out = outputs(['frontend/src/a.tsx']);
    expect(out.job_test_backend).toBe('true');
    expect(out.job_test_frontend).toBe('true');
    expect(out.job_test_db).toBe('false');
    expect(out.job_test_api).toBe('false');
  });

  it('asks both sides for a change to the package they share, the OpenAPI document included', () => {
    for (const path of ['packages/shared/src/labels.ts', 'packages/shared/src/openapi.generated.json']) {
      const asked = applying([path]);
      for (const id of [
        'lint:backend', 'typecheck:backend', 'lint:frontend', 'typecheck:frontend',
        'lint:shared', 'lint:openapi', 'api:client', 'test:backend', 'test:frontend',
        'build', 'test:e2e:smoke', 'test:db', 'test:api', 'perf',
      ]) {
        expect(asked, `${path} → ${id}`).toContain(id);
      }
    }
  });

  it('asks the lanes that stand on a database, and no linter, for a migration', () => {
    // No lint, typecheck or web gate reads db/; the backend unit lane reads
    // it as text and the stack lanes build on it.
    expect(applying(['db/migrations/060-x.sql'])).toEqual([
      'security:secrets',
      'lint:pointers',
      'lint:shrunk',
      'test:backend',
      'security:scan',
      'test:e2e:smoke',
      'test:db',
      'test:api',
      'perf',
    ]);
  });

  it('asks every lane that runs in a container for a change of the compose files', () => {
    const asked = applying(['docker-compose.test.yml']);
    for (const id of ['test:backend', 'test:frontend', 'test:e2e:smoke', 'test:db', 'test:api', 'perf']) {
      expect(asked, id).toContain(id);
    }
    expect(asked).not.toContain('lint:backend');
  });

  it('asks for the generated row types on a schema edit, and never on backend source alone', () => {
    // The generated file is a function of db/init/01-schema.sql (ADR-0064), so
    // an edit there, to the file itself, to the generator or to its runner asks
    // the check that diffs the two; a change elsewhere in backend/ cannot
    // alter what the generator reads, and the case above pins that it is not
    // asked. The gate runs from backend/node_modules, so it is a node setup:
    // the check job installs the backend before it.
    for (const path of [
      'db/init/01-schema.sql',
      'db/init/02-anything.sql',
      'docker-compose.yml',
      'backend/src/db/schema.generated.ts',
      'backend/src/db/generateSchemaTypes.ts',
      'backend/src/db/testDbName.ts',
      'scripts/db-types.sh',
    ]) {
      expect(applying([path]), path).toContain('db:types');
      expect(outputs([path]).job_check_node, path).toBe('true');
    }
    expect(applying(['db/migrations/060-x.sql'])).not.toContain('db:types');
    expect(applying(['backend/src/db/index.ts'])).not.toContain('db:types');
  });

  it('asks the Python gates, and the Node scan that reads cv-python too, for a change under cv-python', () => {
    // The Node Semgrep scan is pointed at the whole checkout with rule packs
    // that carry Python rules, and the pointer pass reads a Python comment as
    // it reads any prose: those two are the non-Python gates a cv-python
    // change asks for.
    expect(applying(['cv-python/app/a.py'])).toEqual([
      'security:secrets',
      'lint:pointers',
      'lint:shrunk',
      'check:py',
      'security:py:bandit',
      'security:py:deps',
      'test:py',
      'security:scan',
      'security:py:semgrep',
      'security:image',
    ]);
    expect(outputs(['cv-python/app/a.py']).job_test).toBe('false');
  });

  it('asks the database lanes and the Python gates for a loader in db/', () => {
    // `db/gadm_levels.py` is loaded by the schema's own tests, and the Python
    // gates read the loaders with db/'s own configuration (#1736). The audit of
    // cv-python's dependencies is not asked: the loaders' own waits on #1782.
    const gates = applying(['db/gadm_levels.py']);
    expect(gates).toContain('test:py');
    expect(gates).toContain('test:backend');
    expect(gates).toContain('check:py');
    expect(gates).toContain('security:py:bandit');
    expect(gates).not.toContain('security:py:deps');
  });

  it('asks only the backend unit lane and the secrets scan for a change of the coverage lists', () => {
    // files.test.ts is the one spec that reads the committed register, regions
    // and lists, and it runs in that lane; nothing of the stack tier reads them.
    // The Node Semgrep scan does: `.semgrepignore` leaves `.jsonl` in, and its
    // `p/secrets` pack is what would find a provider's key an agent copied in;
    // gitleaks reads every file for a generic one, so the check job starts.
    for (const path of [
      'db/catalogue-coverage/expectations/rome.jsonl',
      'db/catalogue-coverage/kinds.jsonl',
      'db/catalogue-coverage/regions.jsonl',
    ]) {
      expect(applying([path]), path).toEqual(['security:secrets', 'lint:shrunk', 'test:backend', 'security:scan']);
      const out = outputs([path]);
      expect(out.job_test, path).toBe('true');
      expect(out.job_security_node, path).toBe('true');
      expect(out.job_check, path).toBe('true');
      for (const job of ['job_build', 'job_security_python', 'job_trivy', 'job_smoke', 'job_perf']) {
        expect(out[job], `${path} ${job}`).toBe('false');
      }
    }
  });

  it('still asks every lane that stands on a database for the rest of db/', () => {
    // The schema and the migrations are what the backend specs and the stack
    // stand on; only the coverage lists left the class.
    for (const path of ['db/init/01-schema.sql', 'db/migrations/060-x.sql']) {
      const gates = applying([path]);
      for (const id of ['test:backend', 'security:scan', 'test:e2e:smoke', 'test:db', 'test:api', 'perf']) {
        expect(gates, `${path} ${id}`).toContain(id);
      }
    }
    // Only the lists left: a name that merely starts like the directory, or a
    // file of another kind put beside the lists, is still the product's.
    for (const path of ['db/catalogue-coverage-notes.sql', 'db/catalogue-coverage/load.sql']) {
      expect(applying([path]), path).toContain('test:e2e:smoke');
    }
  });

  it('asks the docs gates as well for a README inside a service', () => {
    const gates = applying(['martin/README.md']);
    expect(gates).toContain('lint:md');
    expect(gates).toContain('lint:links');
    expect(gates).toContain('test:e2e:smoke');
  });

  it('asks the dependency audit for a lockfile of either stack', () => {
    const gates = applying(['backend/package-lock.json']);
    expect(gates).toContain('security:deps');
    expect(gates).toContain('lint:backend');
  });

  it('reports a path that is an input to nothing, rather than dropping it', () => {
    const decision = decide({ paths: ['LICENSE'] });
    expect(decision.unclassified).toEqual(['LICENSE']);
    expect(decision.gates.some((gate) => gate.applies)).toBe(false);
  });

  it('asks a tool’s settings for the gate that reads them, and nothing else', () => {
    // ADR-0092: a config file is an input of its own gate, the way a target's
    // own settings are its input in Nx, not a reason to run every gate.
    expect(applying(['.madgerc'])).toEqual(['lint:circular']);
    expect(applying(['.markdownlint-cli2.jsonc'])).toEqual(['lint:md']);
    expect(applying(['.semgrepignore'])).toEqual(['security:scan', 'security:py:semgrep']);
    expect(applying(['package-lock.json'])).toEqual(['lint:circular', 'lint:md']);
    const scan = applying(['scripts/scan-image.sh']);
    expect(scan).toContain('security:image');
    expect(scan).not.toContain('test:e2e:smoke');
    expect(applying(['scripts/require-py-tools.sh'])).toEqual(expect.arrayContaining(['check:py', 'test:py']));
    // The map's own document: the docs gates, and the spec that pins its tables.
    expect(applying(['docs/tech/gates.md'])).toEqual(['security:secrets', 'lint:md', 'lint:links', 'lint:pointers', 'lint:shrunk', 'test:backend']);
  });

  it('asks a changed npm script of the root manifest for the gates that run it', () => {
    const scripts = {
      'lint:md': 'markdownlint-cli2',
      'lint:py': 'ruff check .',
      'check:py': './scripts/require-py-tools.sh ruff && npm run lint:py && npm run -s format:py',
      'format:py': 'ruff format --check .',
    };
    const asked = (paths) =>
      decide({ paths, scripts }).gates.filter((gate) => gate.applies).map((gate) => gate.id);
    // The manifest itself is read by test:backend's specs; the script by its gate.
    expect(asked(['package.json', 'package.json#scripts/lint:md'])).toEqual(['lint:md', 'test:backend']);
    // A script another one runs reaches the gate that runs the outer one.
    expect(asked(['package.json', 'package.json#scripts/format:py'])).toEqual(['check:py', 'test:backend']);
    const why = decide({ paths: ['package.json#scripts/format:py'], scripts })
      .gates.find((gate) => gate.id === 'check:py').why;
    expect(why).toBe('runs the changed npm script format:py');
    // A field no gate reads on its own cannot be placed, so everything runs.
    const other = decide({ paths: ['package.json', 'package.json#other'], scripts });
    expect(other.everything).toBe(true);
    expect(other.reason).toContain('outside its scripts and dependencies');
  });

  it('reads the root manifest by script, and anything else in it as unplaceable', () => {
    const manifest = (fields) => JSON.stringify({ name: 'x', scripts: { a: '1', b: '2' }, ...fields });
    expect(packageChanges(manifest({}), manifest({ scripts: { a: '1', b: '3', c: '4' } }))).toEqual([
      'package.json#scripts/b',
      'package.json#scripts/c',
    ]);
    expect(packageChanges(manifest({}), manifest({ devDependencies: { madge: '9' } }))).toEqual([]);
    expect(packageChanges(manifest({}), manifest({ engines: { node: '24' } }))).toEqual(['package.json#other']);
    expect(packageChanges('{', manifest({}))).toEqual(['package.json#other']);
  });

  it('runs everything in CI for a change to the map or the workflow, and only their readers locally', () => {
    // An edit that narrows the map could otherwise skip the gate it broke, and
    // a job's definition is tested only by running it (ADR-0092).
    for (const path of CI_GLOBAL) {
      const inCi = decide({ paths: [path], ci: true });
      expect(inCi.everything, path).toBe(true);
      expect(inCi.reason, path).toContain('decides what CI runs');

      const local = decide({ paths: [path] });
      expect(local.everything, path).toBe(false);
      expect(local.ciNote, path).toContain('CI runs every gate');
      const asked = local.gates.filter((gate) => gate.applies).map((gate) => gate.id);
      expect(asked, path).toContain('test:backend');
      expect(asked, path).not.toContain('test:e2e:smoke');
    }
    expect(decide({ paths: ['scripts/gate-cache.mjs'], ci: true }).everything).toBe(false);

    // A root npm script the workflow runs by name is part of a job's
    // definition too: `perf` is what the Lighthouse job runs, and no gate's
    // command names it.
    const ciScripts = workflowScripts(readFileSync(repoFile('.github', 'workflows', 'ci.yml'), 'utf8'));
    for (const name of ['check', 'perf', 'setup:py:dev', 'test:e2e:smoke']) {
      expect(ciScripts.has(name), name).toBe(true);
    }
    expect(ciScripts.has('build')).toBe(false); // `npm --prefix backend run build` is the backend's
    const perf = ['package.json', 'package.json#scripts/perf'];
    expect(decide({ paths: perf, ci: true, ciScripts }).everything).toBe(true);
    const local = decide({ paths: perf, ciScripts });
    expect(local.everything).toBe(false);
    expect(local.ciNote).toContain('package.json#scripts/perf');
    expect(decide({ paths: ['backend/src/a.ts'] }).ciNote).toBeNull();
  });

  it('runs everything when the change set is unknown, and says why', () => {
    // A runner that cannot see what changed must not decide it changed nothing.
    const told = decide({ paths: null, reason: 'the clone is shallow' });
    expect(told.everything).toBe(true);
    expect(told.reason).toContain('the clone is shallow');
    expect(told.gates.every((gate) => gate.applies)).toBe(true);

    const untold = decide({ paths: null });
    expect(untold.everything).toBe(true);
    expect(untold.reason.length).toBeGreaterThan(0);
  });

  it('says of every gate why it runs or does not', () => {
    const decision = decide({ paths: ['cv-python/app/a.py'] });
    const why = Object.fromEntries(decision.gates.map((gate) => [gate.id, gate.why]));
    expect(why['check:py']).toBe('inputs touched: python');
    expect(why['lint:backend']).toBe('inputs untouched: backend, shared');
  });
});

describe('the map itself', () => {
  it('decides the gates in the order the map declares them', () => {
    const decided = decide({ paths: ['backend/src/a.ts'] }).gates.map((gate) => gate.id);
    expect(decided).toEqual(GATES.map((gate) => gate.id));
  });

  it('names only inputs the map declares', () => {
    const declared = new Set(INPUTS.map((input) => input.id));
    for (const gate of GATES) {
      for (const id of gate.inputs) expect(declared.has(id), `${gate.id} → ${id}`).toBe(true);
    }
  });

  it('names only jobs the CI outputs carry', () => {
    const keys = githubOutputs(decide({ paths: [] })).map((line) => line.split('=')[0]);
    for (const gate of GATES) {
      expect(keys, gate.id).toContain(`job_${gate.job.replace(/-/g, '_')}`);
    }
  });

  it('gives a runnable gate a command that needs no shell', () => {
    // `runTier` spawns argv[0] directly, so a `&&` in a command would be passed
    // to npm as an argument and silently do something else.
    for (const gate of GATES) {
      if (gate.tier === 'stack') continue;
      const shellish = gate.command.filter((arg) => ['&&', '||', '|', ';'].includes(arg));
      expect(shellish, gate.id).toEqual([]);
    }
  });

  it('says of every input why it is what it is', () => {
    for (const input of INPUTS) {
      expect(input.note.trim().length, input.id).toBeGreaterThan(20);
    }
  });

  it('puts a path in every input it belongs to, not just the first', () => {
    const inputsOf = (path) => [...classifyPaths([path]).inputs].sort();
    expect(inputsOf('backend/package.json')).toEqual(['backend', 'node-deps']);
    // The third package (ADR-0065) is a class of its own that both sides read.
    // A source file is prose too: its comments are what the pointer pass reads.
    expect(inputsOf('packages/shared/src/labels.ts')).toEqual(['prose', 'shared']);
    expect(inputsOf('packages/shared/package-lock.json')).toEqual(['node-deps', 'shared']);
    expect(inputsOf('db/gadm_levels.py')).toEqual(['database', 'db-python', 'prose']);
    expect(inputsOf('db/catalogue-coverage/kinds.jsonl')).toEqual(['coverage']);
    expect(inputsOf('backend/Dockerfile')).toEqual(['backend', 'docker']);
    expect(inputsOf('docker-compose.yml')).toEqual(['compose', 'prose', 'schema']);
    expect(inputsOf('scripts/db-cli.sh')).toEqual(['prose', 'scripts', 'shell']);
    // Prose in no other class: an issue template, the ASVS checklist. The
    // pointer pass reads them, so a pointer added there runs the gate that
    // refuses it rather than surfacing on some unrelated branch.
    expect(inputsOf('.github/ISSUE_TEMPLATE/task.yml')).toEqual(['prose']);
    expect(inputsOf('docs/security/asvs-checklist.yaml')).toEqual(['prose']);
    // A lane's runner is a runner; a tool no lane executes is not.
    expect(inputsOf('scripts/test-stack.sh')).toEqual(['prose', 'runners', 'scripts', 'shell']);
    expect(inputsOf('scripts/gates.mjs')).toEqual(['prose', 'scripts']);
    expect(inputsOf('.github/workflows/ci.yml')).toEqual(['prose', 'workflows']);
    // A README beside the code is prose, not code; the one a spec reads stays.
    expect(inputsOf('backend/README.md')).toEqual(['docs', 'prose']);
    expect(inputsOf('martin/README.md')).toEqual(['docs', 'prose', 'tiles']);
  });
});

describe('the CI outputs', () => {
  const KEYS = [
    'job_check',
    'job_check_node',
    'job_check_python',
    'job_check_docs',
    'job_test',
    'job_test_backend',
    'job_test_frontend',
    'job_python_tests',
    'job_build',
    'job_security',
    'job_security_node',
    'job_security_python',
    'job_trivy',
    'job_smoke',
    'job_test_db',
    'job_test_api',
    'job_perf',
    'reason',
  ];

  it('prints the same eighteen lines in the same order, whatever changed', () => {
    // CI reads these by name from a job-level `if:`. A key that appears only
    // sometimes is an `if:` that silently reads the empty string as false.
    const keysOf = (paths) =>
      githubOutputs(decide({ paths })).map((line) => line.slice(0, line.indexOf('=')));
    for (const paths of [['docs/tech/x.md'], ['cv-python/app/a.py'], [], null]) {
      expect(keysOf(paths), JSON.stringify(paths)).toEqual(KEYS);
    }
  });

  it('keeps the reason on one line, which is all a GitHub output can hold', () => {
    const lines = githubOutputs(decide({ paths: null, reason: 'one\ntwo   three' }));
    expect(lines.at(-1)).toBe('reason=one two three');
  });

  it('never asks for a step inside a job it does not start', () => {
    // A guarded step's key can only decide something inside a job that
    // started. A job gate narrowed to fewer inputs than one of its steps
    // reads would strand the step in a skipped job — one that reports
    // Success having run nothing, which is the failure this whole map exists
    // to prevent. No job waits on the lint job any more (#965, pinned in
    // ci-failsafe.test.mjs), so the steps are the only nesting left.
    const sample = {
      backend: 'backend/src/a.ts',
      web: 'frontend/src/a.tsx',
      shared: 'packages/shared/src/labels.ts',
      database: 'db/migrations/060-x.sql',
      tiles: 'martin/config.yaml',
      scripts: 'scripts/perf-api.mjs',
      compose: '.env.example',
      python: 'cv-python/app/a.py',
      'db-python': 'db/gadm_levels.py',
      coverage: 'db/catalogue-coverage/expectations/rome.jsonl',
      schema: 'db/init/01-schema.sql',
      'node-deps': 'backend/package-lock.json',
      docs: 'docs/tech/x.md',
      shell: 'tools/release.sh',
      docker: 'Dockerfile',
      workflows: '.github/workflows/claude-review.yml',
      prose: '.github/ISSUE_TEMPLATE/task.yml',
      runners: 'scripts/test-stack.sh',
      'api-contract': 'packages/shared/src/openapi.generated.json',
    };
    // A new input class with no sample would otherwise sit untested here.
    expect(Object.keys(sample).sort()).toEqual(INPUTS.map((input) => input.id).sort());

    const steps = {
      job_smoke: ['job_test_db', 'job_test_api'],
      job_test: ['job_test_backend', 'job_test_frontend'],
      job_security: ['job_security_node', 'job_security_python'],
    };
    for (const [id, path] of Object.entries(sample)) {
      expect(classifyPaths([path]).inputs.has(id), `${path} is not ${id}`).toBe(true);
      const out = outputs([path]);
      for (const [job, keys] of Object.entries(steps)) {
        for (const key of keys) {
          if (out[key] === 'true') {
            expect(out[job], `${id} asks for ${key} inside a ${job} it does not start`).toBe('true');
          }
        }
      }
    }
  });

  it('asks each Semgrep scan separately, since the two read different sources', () => {
    // The security job runs both scans. The Python scan reads cv-python only,
    // so a backend change does not pay for it; the Node scan reads the whole
    // checkout, so a cv-python change pays for both.
    const python = outputs(['cv-python/app/a.py']);
    expect(python.job_security).toBe('true');
    expect(python.job_security_python).toBe('true');
    expect(python.job_security_node).toBe('true');

    const node = outputs(['backend/src/a.ts']);
    expect(node.job_security).toBe('true');
    expect(node.job_security_node).toBe('true');
    expect(node.job_security_python).toBe('false');
  });
});


describe('the command line', () => {
  it('reads the branch against the working tree by default', () => {
    expect(parseArgs([])).toEqual({ mode: 'list', tier: null, all: false, noCache: false, affected: false, base: null, rev: 'HEAD' });
  });

  it('refuses a flag whose value is missing, rather than reading the next flag as it', () => {
    expect(() => parseArgs(['--base'])).toThrow(/--base needs a value/);
    expect(() => parseArgs(['--base', '--json'])).toThrow(/--base needs a value/);
    expect(() => parseArgs(['--rev', ''])).toThrow(/--rev needs a value/);
  });

  it('refuses an argument it does not know', () => {
    expect(() => parseArgs(['--onto', 'main'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['walk'])).toThrow(/Unknown argument/);
  });

  it('refuses a run with no tier, or with a tier that is not one of the four', () => {
    // "Nothing to run" must never be what a mistyped tier degrades into.
    expect(() => parseArgs(['run'])).toThrow(/tier/);
    expect(() => parseArgs(['run', 'nope'])).toThrow(/nope/);
    expect(() => parseArgs(['run', '--all'])).toThrow(/tier/);
    expect(parseArgs(['run', 'check', '--all'])).toEqual({
      mode: 'run',
      tier: 'check',
      all: true,
      noCache: false,
      affected: false,
      base: null,
      rev: 'HEAD',
    });
  });

  it('refuses two modes at once, rather than obeying one of them', () => {
    expect(() => parseArgs(['run', 'check', '--json'])).toThrow(/one mode/);
  });

  it('refuses --all where there is no tier for it to widen', () => {
    // `gates.mjs --all` lists; taking the flag silently would let that read as
    // "everything ran".
    expect(() => parseArgs(['--all'])).toThrow(/--all only means something with/);
    expect(() => parseArgs(['--json', '--all'])).toThrow(/--all/);
    expect(parseArgs(['--all', 'run', 'scan']).all).toBe(true);
  });

  it('takes --affected for the unit tier only, and never beside --all', () => {
    expect(parseArgs(['run', 'test', '--affected']).affected).toBe(true);
    expect(() => parseArgs(['run', 'check', '--affected'])).toThrow(/--affected only means something with `run test`/);
    expect(() => parseArgs(['--affected'])).toThrow(/--affected/);
    expect(() => parseArgs(['run', 'test', '--affected', '--all'])).toThrow(/Pick one/);
  });

  it('refuses --no-cache where there is no run for it to change', () => {
    expect(() => parseArgs(['--no-cache'])).toThrow(/--no-cache only means something with/);
    expect(parseArgs(['run', 'test', '--no-cache']).noCache).toBe(true);
  });
});


describe('the table the doc carries', () => {
  it('names every gate and every input', () => {
    const table = renderTable();
    for (const gate of GATES) expect(table, gate.id).toContain(gate.id);
    for (const input of INPUTS) expect(table, input.id).toContain(input.id);
  });

  it('escapes the pipe a cell carries and leaves its backslashes alone', () => {
    // GFM removes the backslash before a pipe at the table level and shows
    // every other backslash in a code span as it is, so the Dockerfile
    // pattern must reach the page with its pipe escaped and its `\/` intact.
    const table = renderTable();
    expect(table).toContain('`/(^\\|\\/)Dockerfile[^/]*$/`');
    expect(table).toContain('`/^db\\/.*\\.py$/`');
    expect(table).not.toContain('\\\\');
  });
});

/**
 * Every spec the `test:backend` gate runs, whichever root it runs from.
 *
 * Two trees, because `backend/vitest.config.ts` includes two: the package's own
 * `.test.ts` files under `src`, and the repository's tooling specs, the
 * `.test.mjs` files under `scripts`. Both are scanned below: scanning the
 * package's own specs alone leaves the claim this file makes — that a spec
 * reading a path in no input class turns it red — false for exactly the specs
 * that read the workflow and the gates document (#952).
 */
function specFiles(dir, extension) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...specFiles(path, extension));
    else if (entry.name.endsWith(extension)) found.push(path);
  }
  return found;
}

const gateSpecs = () => [
  ...specFiles(backendSrc, '.test.ts'),
  ...specFiles(repoFile('scripts'), '.test.mjs'),
];

/**
 * Only calls whose every argument is a string literal are read: a computed
 * segment cannot be resolved without running the spec, and a guess at one would
 * assert against a path that is not the one the spec opens.
 */
const REPO_FILE_CALL = /repoFile\(\s*('[^']*'(?:\s*,\s*'[^']*')*)\s*\)/g;

/** Every file under a directory, repository-relative; installed packages are not the repository's. */
function filesBelow(full, path) {
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const rel = `${path}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(join(full, entry.name), rel) : [rel];
  });
}

describe('the map against the repository', () => {
  it('covers every repository file the specs of its own gate read', () => {
    const read = new Set();
    for (const file of gateSpecs()) {
      const source = readFileSync(file, 'utf8');
      for (const [, args] of source.matchAll(REPO_FILE_CALL)) {
        const segments = args.split(',').map((arg) => arg.trim().slice(1, -1));
        const path = segments.join('/');
        // A segment list naming a directory is that directory's whole subtree:
        // `repoFile('db')` is the input `db/`, not a file called `db`. Each file
        // under it is classified, not the directory's name, since a class may
        // take part of a directory: the coverage lists are `.jsonl` files under
        // a `db/` whose other files are `database`.
        const full = repoFile(path);
        const isDir = existsSync(full) && statSync(full).isDirectory();
        read.add(isDir ? `${path}/` : path);
        if (isDir) for (const under of filesBelow(full, path)) read.add(under);
      }
    }
    expect(read.size).toBeGreaterThan(0);

    // `test:backend` is the gate every one of those specs runs under, so
    // whatever they read must be one of its input classes or config files.
    const testBackend = GATES.find((gate) => gate.id === 'test:backend');
    for (const path of [...read].sort()) {
      const { inputs } = classifyPaths([path]);
      const covered = testBackend.config.includes(path) || testBackend.inputs.some((id) => inputs.has(id));
      expect(
        covered,
        `${path} is read by a spec of the test:backend gate and is an input to no gate that `
        + 'runs it. A change to that file alone therefore touches no input, the unit lane is '
        + 'skipped and reports Success, and the spec written to guard that very file does not '
        + 'run. Add the path to an input class in this map, or stop reading it',
      ).toBe(true);
    }
  });

  it('places every tracked file: in a class, in a gate’s config, or as read by no gate', () => {
    // ADR-0092: no class runs everything any more, so a file a gate reads but
    // the map never names is checked by nothing, locally or in CI. A new file
    // fails here until the map says who reads it.
    const tracked = trackedFiles();
    if (tracked === null) return; // no git here: the host lane and CI answer for it
    const configured = new Set(GATES.flatMap((gate) => gate.config ?? []));
    const unread = (path) => UNREAD.some((entry) =>
      entry.path.endsWith('/') ? path.startsWith(entry.path) : path === entry.path);
    const unplaced = tracked.filter((path) =>
      classifyPaths([path]).unclassified.length > 0 && !configured.has(path) && !unread(path));
    expect(
      unplaced,
      'these tracked files are an input to no gate and are not listed as read by none. Give each a '
      + 'class or a gate’s config in scripts/gates.mjs, or add it to UNREAD with the reason',
    ).toEqual([]);
    // And the list holds nothing a class or a config already places.
    for (const entry of UNREAD) {
      const sample = tracked.find((path) => (entry.path.endsWith('/') ? path.startsWith(entry.path) : path === entry.path));
      expect(sample, `${entry.path} is in UNREAD and is not tracked`).toBeDefined();
      expect(classifyPaths([sample]).unclassified, entry.path).toEqual([sample]);
    }
  });

  it('gives a gate every script file and root config its npm script names', () => {
    // A guard or runner a gate's script calls by path is that gate's input,
    // as is any root file the script names; the ones it reads implicitly
    // (`.madgerc`) are in its `config`, which this cannot see.
    const manifest = repoFile('package.json');
    if (!existsSync(manifest)) return; // the container lane mounts no root manifest
    const { scripts } = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const gate of GATES) {
      const text = [...gateScripts(gate, scripts)].map((name) => scripts[name] ?? '').join('\n');
      const named = [...text.matchAll(/(?:\.\/)?(scripts\/[\w./-]+\.(?:sh|mjs)|\.[\w.-]+rc[\w.]*)/g)]
        .map(([, path]) => path);
      const reads = keyBelongs(gate);
      const matches = (pattern, path) => {
        if (pattern instanceof RegExp) return pattern.test(path);
        return pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern;
      };
      const placed = (path) => (gate.config ?? []).includes(path)
        || gate.inputs.some((id) => INPUTS.find((input) => input.id === id).paths.some((pattern) => matches(pattern, path)));
      for (const path of named) {
        expect(placed(path), `${gate.id} runs ${path} and does not read it`).toBe(true);
        expect(reads(path), `${gate.id}'s cache key leaves out ${path}`).toBe(true);
      }
    }
  });

  it('is the table the doc carries', () => {
    // One map: the doc embeds the generated tables rather than restating them.
    const doc = readFileSync(repoFile('docs', 'tech', 'gates.md'), 'utf8');
    expect(doc).toContain(renderTable());
  });
});

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GATES,
  INPUTS,
  changedPaths,
  classifyPaths,
  decide,
  githubOutputs,
  parseArgs,
  renderTable,
  runTier,
} from './gates.mjs';
import { backendSrc, repoFile } from './repo-root.mjs';

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
  it('asks only the docs gates for a change of prose', () => {
    expect(applying(['docs/tech/x.md'])).toEqual(['lint:md', 'lint:links']);

    // This is the case #783 was filed for: a Markdown-only pull request used to
    // burn every lane. The check job still runs — it is where the docs pass
    // lives — but nothing else does.
    const out = outputs(['docs/tech/x.md']);
    expect(out.job_check).toBe('true');
    expect(out.job_check_docs).toBe('true');
    for (const key of Object.keys(out)) {
      if (key === 'reason' || key === 'job_check' || key === 'job_check_docs') continue;
      expect(out[key], key).toBe('false');
    }
  });

  it('asks the workflow lint, and only it, for a change to a workflow that is not ci.yml', () => {
    // Before this class the three `claude-*.yml` workflows were in no input
    // class at all: `npm run check` answered "Nothing to run" and a mistake in
    // one was found by the run that hit it, on the branch it was merged to.
    expect(applying(['.github/workflows/claude-review.yml'])).toEqual(['lint:actions']);

    // Docker is the gate's whole toolchain, and a Docker-only check has no
    // setup key of its own, so the check job starts and not one of the three
    // setup keys — node, python, docs — turns true with it.
    const out = outputs(['.github/workflows/claude-review.yml']);
    expect(out.job_check).toBe('true');
    for (const key of Object.keys(out)) {
      if (key === 'reason' || key === 'job_check') continue;
      expect(out[key], key).toBe('false');
    }
  });

  it('asks every gate of the product for a change of backend source', () => {
    // Both stacks, because the product is one contract surface: a backend spec
    // reads `frontend/src` through repoFile(), and the smoke lane is the only
    // gate that sees the two sides agree.
    expect(applying(['backend/src/a.ts'])).toEqual([
      'lint:backend',
      'lint:frontend',
      'typecheck:backend',
      'typecheck:frontend',
      'knip:backend',
      'knip:frontend',
      'lint:shared',
      'typecheck:shared',
      'knip:shared',
      'lint:circular',
      'test:backend',
      'test:frontend',
      'security:scan',
      'build',
      'test:e2e:smoke',
      'test:db',
      'perf',
    ]);

    const out = outputs(['backend/src/a.ts']);
    expect(out.job_trivy).toBe('false');
    expect(out.job_python_tests).toBe('false');
    expect(out.job_check_python).toBe('false');
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
    // that carry Python rules, so it is the one non-Python gate a cv-python
    // change asks for.
    expect(applying(['cv-python/app/a.py'])).toEqual([
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

  it('asks the product gates and the Python tests for a loader in db/', () => {
    // `db/gadm_levels.py` is loaded by the schema's own tests and by nothing in
    // cv-python, so it asks for `test:py` without asking for cv-python's lint.
    const gates = applying(['db/gadm_levels.py']);
    expect(gates).toContain('test:py');
    expect(gates).toContain('lint:backend');
    expect(gates).not.toContain('check:py');
  });

  it('asks the docs gates as well for a README inside a service', () => {
    const gates = applying(['martin/README.md']);
    expect(gates).toContain('lint:md');
    expect(gates).toContain('lint:links');
    expect(gates).toContain('lint:backend');
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

  it('runs everything for repository-wide tooling, and names the file', () => {
    const decision = decide({ paths: ['package.json'] });
    expect(decision.everything).toBe(true);
    expect(decision.reason).toContain('package.json');
    expect(decision.gates.every((gate) => gate.applies)).toBe(true);
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
    expect(why['lint:backend']).toBe('inputs untouched: app');
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
    expect(inputsOf('backend/package.json')).toEqual(['app', 'node-deps']);
    // The third package (ADR-0065) is product like the other two: a rule both
    // sides import is a change to both sides.
    expect(inputsOf('packages/shared/src/labels.ts')).toEqual(['app']);
    expect(inputsOf('packages/shared/package-lock.json')).toEqual(['app', 'node-deps']);
    expect(inputsOf('db/gadm_levels.py')).toEqual(['app', 'db-python']);
    expect(inputsOf('backend/Dockerfile')).toEqual(['app', 'docker']);
    expect(inputsOf('scripts/db-cli.sh')).toEqual(['app', 'shell']);
    expect(inputsOf('scripts/gates.mjs')).toEqual(['app', 'tooling']);
    // `ci.yml` is read by actionlint like any workflow *and* decides which
    // gates run at all, so it is both: linted as a file, and tooling that
    // re-asks every gate. Losing the second membership would let an edit to
    // the job filter run nothing but the workflow lint.
    expect(inputsOf('.github/workflows/ci.yml')).toEqual(['tooling', 'workflows']);
    expect(decide({ paths: ['.github/workflows/ci.yml'] }).everything).toBe(true);
    // The one gate whose runner is outside its inputs: `security:image` reads
    // python, and its script sits under scripts/. Tooling is what makes an
    // edit to the scan run the scan.
    expect(inputsOf('scripts/scan-image.sh')).toEqual(['app', 'shell', 'tooling']);
    expect(decide({ paths: ['scripts/scan-image.sh'] }).everything).toBe(true);
  });
});

describe('the CI outputs', () => {
  const KEYS = [
    'job_check',
    'job_check_node',
    'job_check_python',
    'job_check_docs',
    'job_test',
    'job_python_tests',
    'job_build',
    'job_security',
    'job_security_node',
    'job_security_python',
    'job_trivy',
    'job_smoke',
    'job_test_db',
    'job_perf',
    'reason',
  ];

  it('prints the same fifteen lines in the same order, whatever changed', () => {
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

  it('never asks for a build, a smoke run or Lighthouse without the lint gates', () => {
    // In CI those three `needs: check`, and a skipped job skips its dependents:
    // a change that asked for a build while `job_check` was false would strand
    // the build behind a check that never ran — and a stranded job reports
    // Success. The invariant holds because all four key off `app`; this is
    // what turns red if an input is ever added to one of them alone.
    const sample = {
      app: 'backend/src/a.ts',
      python: 'cv-python/app/a.py',
      'db-python': 'db/gadm_levels.py',
      schema: 'db/init/01-schema.sql',
      'node-deps': 'backend/package-lock.json',
      docs: 'docs/tech/x.md',
      shell: 'tools/release.sh',
      docker: 'Dockerfile',
      workflows: '.github/workflows/claude-qa.yml',
      tooling: 'package.json',
    };
    // A new input class with no sample would otherwise sit untested here.
    expect(Object.keys(sample).sort()).toEqual(INPUTS.map((input) => input.id).sort());

    for (const [id, path] of Object.entries(sample)) {
      expect(classifyPaths([path]).inputs.has(id), `${path} is not ${id}`).toBe(true);
      const out = outputs([path]);
      const stack = ['job_build', 'job_smoke', 'job_perf'].filter((key) => out[key] === 'true');
      if (stack.length > 0) {
        expect(out.job_check, `${id} asks for ${stack.join(', ')} without job_check`).toBe('true');
      }
      // The database lane is a step of the smoke job, not a job of its own, so
      // its key can only ever decide something inside a job that started. A
      // smoke gate narrowed to fewer inputs than `test:db` reads would strand
      // the step in a skipped job — one that reports Success having run
      // nothing, which is the failure this whole map exists to prevent.
      if (out.job_test_db === 'true') {
        expect(out.job_smoke, `${id} asks for test:db inside a smoke job it does not start`).toBe('true');
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

/**
 * Run `body` with GATES_BASE set to `value`, or absent when `value` is
 * undefined, and put the environment back whatever happens.
 *
 * What the block below does not pin, deliberately: that an *unset* GATES_BASE
 * falls through to `main` and then `origin/main`. That arm asks git, and this
 * spec asks git nothing — it also runs in the container lane, where there is
 * no checkout around it. Nor is `--base ''` pinned: `parseArgs` refuses an
 * empty flag value before the resolver is ever reached (asserted under "the
 * command line"), so the resolver's `--base is empty` arm is reachable only by
 * calling `changedPaths` directly.
 */
function withGatesBase(value, body) {
  const had = 'GATES_BASE' in process.env;
  const before = process.env.GATES_BASE;
  if (value === undefined) delete process.env.GATES_BASE;
  else process.env.GATES_BASE = value;
  try {
    return body();
  } finally {
    if (had) process.env.GATES_BASE = before;
    else delete process.env.GATES_BASE;
  }
}

describe('the base the change is measured against', () => {
  // Both cases answer before git is asked anything, which is what lets them
  // run in the container lane, where this spec has no checkout around it.
  it('reads a GATES_BASE that is present but empty as no base at all', () => {
    // The resolver's contract: a `GATES_BASE` that is merely present settles
    // the question, and one present but empty names no commit. Falling back to
    // `main` there would compare the checked-out tip with itself, see nothing
    // changed and skip every gate: a green run that checked nothing. CI sends
    // the zero sha where an event carries no base, so an empty value is one a
    // person typed or a later edit of the workflow left behind.
    const changed = withGatesBase('', () => changedPaths({ base: null, rev: 'HEAD' }));

    expect(changed.paths).toBeNull();
    expect(changed.base).toBeNull();
    expect(changed.reason).toContain('GATES_BASE is empty');

    const decision = decide({ paths: changed.paths, reason: changed.reason });
    expect(decision.everything).toBe(true);
    expect(decision.gates.every((gate) => gate.applies)).toBe(true);
  });

  it('reads the zero sha as no base, from the environment or the command line', () => {
    const zero = '0'.repeat(40);

    const fromEnv = withGatesBase(zero, () => changedPaths({ base: null, rev: 'HEAD' }));
    expect(fromEnv.paths).toBeNull();
    expect(fromEnv.reason).toContain('GATES_BASE is the zero sha');

    // `--base` obeys the same rule, and wins over the environment: a base
    // typed on the command line is the most explicit answer there is.
    const fromFlag = withGatesBase('main', () => changedPaths({ base: zero, rev: 'HEAD' }));
    expect(fromFlag.paths).toBeNull();
    expect(fromFlag.reason).toContain('--base is the zero sha');

    for (const changed of [fromEnv, fromFlag]) {
      expect(decide({ paths: changed.paths, reason: changed.reason }).everything).toBe(true);
    }
  });
});

describe('the command line', () => {
  it('reads the branch against the working tree by default', () => {
    expect(parseArgs([])).toEqual({ mode: 'list', tier: null, all: false, base: null, rev: 'HEAD' });
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
});

/**
 * A spawner that runs nothing, so the runner's output shapes can be driven
 * without a Docker image or three minutes of vitest. `results` answers call by
 * call; anything past its end passes.
 */
function fakeSpawn(results = []) {
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args].join(' '));
    return results[calls.length - 1] ?? { status: 0 };
  };
  spawn.calls = calls;
  return spawn;
}

/** Run a tier with both console streams captured, since a failure uses stderr. */
function capture(decision, tier, options) {
  const lines = [];
  const record = (...args) => lines.push(args.join(' '));
  const out = vi.spyOn(console, 'log').mockImplementation(record);
  const err = vi.spyOn(console, 'error').mockImplementation(record);
  try {
    return { code: runTier(decision, tier, options), printed: lines.join('\n') };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe('what the runner says it did', () => {
  const backend = () => decide({ paths: ['backend/src/a.ts'] });

  it('names the gate that failed, its code, and what never ran', () => {
    const spawn = fakeSpawn([{ status: 3 }]);
    const { code, printed } = capture(backend(), 'test', { spawn });

    expect(code).toBe(3);
    expect(spawn.calls).toEqual(['node scripts/test-report.mjs backend-unit']);
    expect(printed).toContain('Failed: test:backend (exit 3)');
    expect(printed).toContain('Not run (stopped after test:backend failed): test:frontend');
    expect(printed).toContain('test:py              inputs untouched: python, db-python');
  });

  it('still names the failure when it is the last gate of the tier', () => {
    // `Ran: test:backend, test:frontend` on its own is the text a clean run
    // prints, so without the Failed line the only difference is the exit code.
    const spawn = fakeSpawn([{ status: 0 }, { status: 4 }]);
    const { code, printed } = capture(backend(), 'test', { spawn });

    expect(code).toBe(4);
    expect(printed).toContain('Failed: test:frontend (exit 4)');
    expect(printed).not.toContain('Not run');
  });

  it('says why a gate that could not be spawned produced no output', () => {
    // Under `stdio: 'inherit'` the child wrote nothing because it never
    // started; the reason lives only on the result object.
    const spawn = fakeSpawn([{ error: new Error('spawn npm ENOENT'), status: null }]);
    const { code, printed } = capture(backend(), 'test', { spawn });

    expect(code).toBe(1);
    expect(printed).toContain('test:backend could not run: spawn npm ENOENT');
    expect(printed).toContain('Failed: test:backend (exit 1)');
  });

  it('says so loudly when the tier has nothing to run', () => {
    const spawn = fakeSpawn();
    const { code, printed } = capture(decide({ paths: ['docs/tech/x.md'] }), 'test', { spawn });

    expect(code).toBe(0);
    expect(spawn.calls).toEqual([]);
    expect(printed).toContain('Nothing to run for tier test');
    expect(printed).toContain('`--all` runs every gate.');
  });

  it('runs every gate of the tier with --all, whatever the decision says', () => {
    const spawn = fakeSpawn();
    const { code } = capture(decide({ paths: ['docs/tech/x.md'] }), 'test', { spawn, all: true });

    expect(code).toBe(0);
    expect(spawn.calls).toHaveLength(3);
  });

  it('says why everything applies, rather than running the lot in silence', () => {
    // The global rule is that an unknown change set runs everything *and says
    // why*. `printList` prints the reason; before #783's review the runner did
    // not, so `run` spent fifteen gates and the stack listing repeated `(every
    // gate applies)` with nothing naming the shallow clone behind it.
    const unknown = decide({ paths: null, reason: 'the clone is shallow' });

    const run = capture(unknown, 'test', { spawn: fakeSpawn() });
    expect(run.printed).toContain('the clone is shallow');

    const listed = capture(unknown, 'stack', { spawn: fakeSpawn() });
    expect(listed.printed).toContain('the clone is shallow');

    // And it is said only where there is something to say: a change set the
    // map read gate by gate has its reason per line already.
    const backendRun = capture(backend(), 'test', { spawn: fakeSpawn() });
    expect(backendRun.printed).not.toContain('every gate applies');
  });

  it('lists the stack tier without running it, and marks what this change asks for', () => {
    const spawn = fakeSpawn();
    const docs = capture(decide({ paths: ['docs/tech/x.md'] }), 'stack', { spawn });

    expect(docs.code).toBe(2);
    expect(spawn.calls).toEqual([]);
    expect(docs.printed).toContain('The stack tier is run by hand');
    // A Markdown-only branch must not be told to spend ten minutes on the
    // smoke lane and Lighthouse for prose neither of them can see.
    for (const id of ['build', 'test:e2e:smoke', 'perf']) {
      expect(docs.printed, id).toContain(`skip  ${id.padEnd(16)}`);
    }
    expect(docs.printed).toContain('(inputs untouched: app)');

    const app = capture(backend(), 'stack', { spawn: fakeSpawn() });
    expect(app.printed).toContain(`run   ${'test:e2e:smoke'.padEnd(16)}`);
    expect(app.printed).toContain('(inputs touched: app)');
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
 * `.test.mjs` files under `scripts`. Only the first used to be scanned below,
 * which left the claim this file makes — that a spec reading a path in no input
 * class turns it red — false for exactly the specs that read the workflow and
 * the gates document (#952).
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

describe('the map against the repository', () => {
  it('covers every repository file the specs of its own gate read', () => {
    const read = new Set();
    for (const file of gateSpecs()) {
      const source = readFileSync(file, 'utf8');
      for (const [, args] of source.matchAll(REPO_FILE_CALL)) {
        const segments = args.split(',').map((arg) => arg.trim().slice(1, -1));
        const path = segments.join('/');
        // A segment list naming a directory is that directory's whole subtree:
        // `repoFile('db')` is the input `db/`, not a file called `db`.
        const full = repoFile(path);
        const isDir = existsSync(full) && statSync(full).isDirectory();
        read.add(isDir ? `${path}/` : path);
      }
    }
    expect(read.size).toBeGreaterThan(0);

    // `test:backend` is the gate every one of those specs runs under, so
    // whatever they read must be one of its inputs — or repository-wide
    // tooling, which runs everything anyway.
    const testBackend = GATES.find((gate) => gate.id === 'test:backend');
    for (const path of [...read].sort()) {
      const { inputs } = classifyPaths([path]);
      const covered = inputs.has('tooling') || testBackend.inputs.some((id) => inputs.has(id));
      expect(
        covered,
        `${path} is read by a spec of the test:backend gate and is an input to no gate that `
        + 'runs it. A change to that file alone therefore touches no input, the unit lane is '
        + 'skipped and reports Success, and the spec written to guard that very file does not '
        + 'run. Add the path to an input class in this map, or stop reading it',
      ).toBe(true);
    }
  });

  it('is the table the doc carries', () => {
    // One map: the doc embeds the generated tables rather than restating them.
    const doc = readFileSync(repoFile('docs', 'tech', 'gates.md'), 'utf8');
    expect(doc).toContain(renderTable());
  });
});

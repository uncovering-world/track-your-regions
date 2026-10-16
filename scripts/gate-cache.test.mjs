import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gateKey, hashWorkingTree, readPass, recordPass, runtimeOf } from './gate-cache.mjs';
import { GATES, cacheFor, decide, keyBelongs, runTier } from './gates.mjs';

const gate = (id) => GATES.find((g) => g.id === id);

/** A checkout's content hashes, as `hashWorkingTree` would hand them over. */
const tree = (entries) => new Map(Object.entries(entries));

const RUNTIME = { node: 'v22.0.0' };

const keyOf = (id, hashes, runtime = RUNTIME) =>
  gateKey({ gate: gate(id), hashes, belongs: keyBelongs(gate(id)), runtime });

const BASE_TREE = {
  'backend/src/services/sync/componentItemMatching.ts': 'a1',
  'frontend/src/components/curation/ReviewPage.tsx': 'b1',
  'docs/tech/experiences.md': 'c1',
  'scripts/gates.mjs': 'd1',
  'backend/package-lock.json': 'e1',
};

describe('the key a pass is kept under', () => {
  it('is the same for the same inputs, whatever the history that led to them', () => {
    expect(keyOf('test:backend', tree(BASE_TREE))).toBe(keyOf('test:backend', tree({ ...BASE_TREE })));
  });

  it('moves when one byte of a file the gate reads moves', () => {
    const edited = tree({ ...BASE_TREE, 'backend/src/services/sync/componentItemMatching.ts': 'a2' });
    expect(keyOf('test:backend', edited)).not.toBe(keyOf('test:backend', tree(BASE_TREE)));
  });

  it('moves when a file the gate reads is deleted', () => {
    const rest = { ...BASE_TREE };
    delete rest['frontend/src/components/curation/ReviewPage.tsx'];
    expect(keyOf('test:frontend', tree(rest))).not.toBe(keyOf('test:frontend', tree(BASE_TREE)));
  });

  it('stays put when only a file the gate cannot read moves', () => {
    // A Markdown-only review wave: the unit lane reads no prose.
    const prose = tree({ ...BASE_TREE, 'docs/tech/experiences.md': 'c2' });
    expect(keyOf('test:backend', prose)).toBe(keyOf('test:backend', tree(BASE_TREE)));
    // …and the docs pass, which does read it, does not reuse its pass.
    expect(keyOf('lint:md', prose)).not.toBe(keyOf('lint:md', tree(BASE_TREE)));
  });

  it('moves for every gate when the gate machinery moves', () => {
    const machinery = tree({ ...BASE_TREE, 'scripts/gates.mjs': 'd2' });
    for (const id of ['lint:md', 'test:backend', 'check:py']) {
      expect(keyOf(id, machinery), id).not.toBe(keyOf(id, tree(BASE_TREE)));
    }
  });

  it('moves with a lockfile, which decides the tools a Node gate runs', () => {
    const bumped = tree({ ...BASE_TREE, 'backend/package-lock.json': 'e2' });
    expect(keyOf('lint:frontend', bumped)).not.toBe(keyOf('lint:frontend', tree(BASE_TREE)));
  });

  it('tells a unit lane run on the host from one run in the container', () => {
    const lane = gate('test:backend');
    expect(runtimeOf(lane, { TEST_REPORT_LOCAL: '1' }).lane).toBe('host');
    expect(runtimeOf(lane, {}).lane).toBe('container');
    expect(keyOf('test:backend', tree(BASE_TREE), runtimeOf(lane, { TEST_REPORT_LOCAL: '1' })))
      .not.toBe(keyOf('test:backend', tree(BASE_TREE), runtimeOf(lane, {})));
    // A gate that is not a unit lane runs the same way under either.
    expect(runtimeOf(gate('lint:backend'), {}).lane).toBeUndefined();
  });

  it('moves with the interpreter the gate ran under', () => {
    expect(keyOf('test:backend', tree(BASE_TREE), { node: 'v24.0.0' }))
      .not.toBe(keyOf('test:backend', tree(BASE_TREE)));
  });

  it('is never shared between two gates', () => {
    expect(keyOf('lint:backend', tree(BASE_TREE))).not.toBe(keyOf('typecheck:backend', tree(BASE_TREE)));
  });
});

/**
 * The backend unit lane runs these specs in its container by default, which has
 * no git binary and mounts only part of the tree (#948). The hashing is a
 * question put to git, so it is asked of a repository the spec builds, and
 * only where git is installed: the host lane and CI answer for it.
 */
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('the content hash of the checkout', () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const inRepo = (...args) => {
    const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...env } = process.env;
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args], {
      cwd: dir, encoding: 'utf8', env,
    }).trim();
  };

  it.skipIf(!hasGit)('is git’s own blob hash, over what is on disk and not ignored', () => {
    dir = mkdtempSync(join(tmpdir(), 'gate-cache-repo-'));
    inRepo('init', '-q');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'docs', 'b.md'), '# b\n');
    writeFileSync(join(dir, 'gone.ts'), 'deleted on disk\n');
    writeFileSync(join(dir, '.gitignore'), 'ignored.ts\n');
    inRepo('add', '.');
    inRepo('commit', '-q', '-m', 'base');
    unlinkSync(join(dir, 'gone.ts'));
    writeFileSync(join(dir, 'new.ts'), 'untracked, not ignored\n');
    writeFileSync(join(dir, 'ignored.ts'), 'ignored\n');
    symlinkSync('a.ts', join(dir, 'link.ts'));

    const hashes = hashWorkingTree((path) => path.endsWith('.ts') || path.endsWith('.md'), dir);

    expect([...hashes.keys()].sort()).toEqual(['a.ts', 'docs/b.md', 'link.ts', 'new.ts']);
    expect(hashes.get('a.ts')).toBe(inRepo('hash-object', 'a.ts'));
    expect(hashes.get('link.ts')).toMatch(/^\?link:/);
    expect(hashWorkingTree((path) => path === 'docs/b.md', dir).size).toBe(1);
  });

  it.skipIf(!hasGit)('moves when an untracked file is staged, since some gates read only what git tracks', () => {
    // `lint:shell` takes its files from `git ls-files`: an untracked script
    // it never opened must not leave a pass that answers for it once added.
    dir = mkdtempSync(join(tmpdir(), 'gate-cache-repo-'));
    inRepo('init', '-q');
    writeFileSync(join(dir, 'run.sh'), 'echo hi\n');

    const before = hashWorkingTree((path) => path === 'run.sh', dir).get('run.sh');
    inRepo('add', 'run.sh');
    const after = hashWorkingTree((path) => path === 'run.sh', dir).get('run.sh');

    expect(before).toBe(`?${after}`);
    expect(after).toBe(inRepo('hash-object', 'run.sh'));
  });
});

describe('the record of a pass', () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('is read back under its key, and under no other', () => {
    dir = mkdtempSync(join(tmpdir(), 'gate-cache-'));
    const at = new Date('2026-10-11T15:00:00Z');
    recordPass(dir, gate('test:frontend'), 'k1', { rev: 'abc1234', at });

    expect(readPass(dir, gate('test:frontend'), 'k1')).toMatchObject({
      gate: 'test:frontend', key: 'k1', rev: 'abc1234', passedAt: '2026-10-11T15:00:00.000Z',
    });
    expect(readPass(dir, gate('test:frontend'), 'k2')).toBeNull();
    expect(readPass(dir, gate('test:backend'), 'k1')).toBeNull();
  });

  it('is no record when it cannot be read', () => {
    dir = mkdtempSync(join(tmpdir(), 'gate-cache-'));
    recordPass(dir, gate('lint:md'), 'k1', { rev: 'abc1234' });
    writeFileSync(join(dir, 'lint_md', 'k1.json'), '{"version":1,');
    expect(readPass(dir, gate('lint:md'), 'k1')).toBeNull();
  });
});

/**
 * A cache whose answers a test sets: `passes` holds the ids with a recorded
 * pass, `moved` the ids whose files change while the gate runs.
 */
function fakeCache({ passes = [], moved = [] } = {}) {
  const looked = [];
  const settled = [];
  return {
    looked,
    settled,
    lookup(g) {
      looked.push(g.id);
      return {
        key: `key-${g.id}`,
        pass: passes.includes(g.id) ? { passedAt: '2026-10-11T15:00:00.000Z', rev: 'abc1234' } : null,
      };
    },
    settle(g, key) {
      if (moved.includes(g.id)) return false;
      settled.push(`${g.id}@${key}`);
      return true;
    },
  };
}

function run(decision, tier, options) {
  const lines = [];
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args].join(' '));
    return (options.results ?? [])[calls.length - 1] ?? { status: 0 };
  };
  const record = (...args) => lines.push(args.join(' '));
  const out = vi.spyOn(console, 'log').mockImplementation(record);
  const err = vi.spyOn(console, 'error').mockImplementation(record);
  try {
    const code = runTier(decision, tier, { ...options, spawn });
    return { code, calls, printed: lines.join('\n') };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe('a run that reuses passes', () => {
  // The shared package asks for both Node unit lanes, which these shapes need.
  const backend = () => decide({ paths: ['packages/shared/src/a.ts'] });

  it('does not run a gate whose inputs already passed, and says so on a line of its own', () => {
    const cache = fakeCache({ passes: ['test:frontend'] });
    const { code, calls, printed } = run(backend(), 'test', { cache });

    expect(code).toBe(0);
    expect(calls).toEqual(['node scripts/test-report.mjs backend-unit']);
    expect(printed).toContain('✓ test:frontend  reused: passed on these inputs at 2026-10-11T15:00:00.000Z (abc1234)');
    expect(printed).toContain('Ran: test:backend');
    expect(printed).toContain('Reused (passed on the same inputs, not run again): test:frontend');
    expect(cache.settled).toEqual(['test:backend@key-test:backend']);
  });

  it('says that nothing ran when every gate was reused', () => {
    const cache = fakeCache({ passes: ['test:backend', 'test:frontend'] });
    const { calls, printed } = run(backend(), 'test', { cache });

    expect(calls).toEqual([]);
    expect(printed).toContain('Ran: none');
  });

  it('records no failure, so the next run runs the gate again', () => {
    const cache = fakeCache();
    const { code, printed } = run(backend(), 'test', { cache, results: [{ status: 3 }] });

    expect(code).toBe(3);
    expect(cache.settled).toEqual([]);
    expect(printed).toContain('Failed: test:backend (exit 3)');
  });

  it('records no pass for a selected lane, which ran only some of its specs', () => {
    const cache = fakeCache({ passes: [] });
    const select = (gate) => (gate.id === 'test:backend'
      ? { whole: false, why: '1 changed module', env: {} }
      : { whole: true, why: 'the change set is unknown' });
    run(backend(), 'test', { cache, select });
    // The whole web lane is a pass of that lane; the selected backend run is not.
    expect(cache.settled).toEqual(['test:frontend@key-test:frontend']);
  });

  it('records no pass when the files moved while the gate ran', () => {
    const cache = fakeCache({ moved: ['test:backend'] });
    const { printed } = run(backend(), 'test', { cache });

    expect(cache.settled).toEqual(['test:frontend@key-test:frontend']);
    expect(printed).toContain('Not recorded (files changed while the gate ran): test:backend');
  });

  it('never asks the cache about a gate whose answer reads something outside the tree', () => {
    const cache = fakeCache({ passes: GATES.map((g) => g.id) });
    const lockfile = decide({ paths: ['backend/package-lock.json'] });
    const { calls } = run(lockfile, 'check', { cache });

    expect(cache.looked).not.toContain('security:deps');
    expect(calls).toContain('npm run security:deps');
  });
});

describe('when a run reuses nothing', () => {
  it('is the case for --no-cache, for --all and on CI', () => {
    const args = { noCache: false, all: false };
    expect(cacheFor({ ...args, noCache: true }, {})).toBeNull();
    expect(cacheFor({ ...args, all: true }, {})).toBeNull();
    expect(cacheFor(args, { CI: 'true' })).toBeNull();
  });

  it('names a reason for every gate that is never reused', () => {
    for (const g of GATES.filter((entry) => entry.uncached)) {
      expect(g.uncached, g.id).toMatch(/\w{3,}.* /);
    }
    expect(GATES.filter((g) => g.uncached).map((g) => g.id)).toEqual([
      'security:deps', 'lint:links', 'api:breaking', 'lint:shrunk', 'security:py:deps',
      'security:scan', 'security:py:semgrep', 'security:image',
    ]);
  });
});

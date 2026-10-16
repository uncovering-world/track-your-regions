/**
 * A gate's pass, kept by the content it read, so the same inputs are not
 * checked twice (ADR-0091).
 *
 * The key of a gate is a hash over every file in its input classes as it sits
 * on disk, its own config files, the gate machinery and the root manifests, the
 * Node manifests and lockfiles, the command, and the runtime that ran it. A pass recorded under that key answers for the
 * next run whose key is the same: folding review fixes into earlier commits, a
 * clean rebase and a Markdown-only wave all leave the tree a gate reads as it
 * was, and only the history moved.
 *
 * Only a pass is recorded, and only when the files did not move while the gate
 * ran. A failure, a gate the host could not run, a gate whose answer reads
 * something outside the tree (`uncached` on its entry in `scripts/gates.mjs`)
 * and every run on CI start from scratch. The records sit under the git common
 * directory, so the worktrees of one clone share them and nothing is tracked.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** The record format; a change of what a record means bumps it. */
const VERSION = 1;

/**
 * Git, asked about the checkout the command was run in (as in gates.mjs). `cwd`
 * matters to `ls-files`, which answers relative to it: the backend lane runs
 * its specs from backend/.
 */
const git = (args, { input, cwd } = {}) => {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...env } = process.env;
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, env, input, cwd });
};

const topLevel = () => git(['rev-parse', '--show-toplevel']).trim();

/**
 * The key of one gate. Pure: the caller hands it the content hash of every
 * file on disk, so the same function serves the runner and the tests.
 *
 * `hashes` maps a repository-relative path to the hash of its content;
 * `belongs(path)` says whether the path enters this gate's key. A path that is
 * absent from `hashes` is absent from the key, so a deleted file changes it as
 * surely as an edited one.
 */
export function gateKey({ gate, hashes, belongs, runtime }) {
  const hash = createHash('sha256');
  hash.update(`v${VERSION}\ngate ${gate.id}\ncommand ${gate.command.join(' ')}\n`);
  for (const [name, version] of Object.entries(runtime).sort()) {
    hash.update(`runtime ${name} ${version}\n`);
  }
  for (const file of [...hashes.keys()].sort()) {
    if (belongs(file)) hash.update(`${file} ${hashes.get(file)}\n`);
  }
  return hash.digest('hex');
}

/**
 * The content hash of every file git would show on disk: tracked and not
 * ignored, deleted ones left out. Regular files are hashed by git in one pass;
 * a symbolic link by its target, which is what git stores for one. Only paths
 * `wanted` keeps are read, so a large untracked file no gate reads is never
 * opened.
 *
 * An untracked file's hash carries a `?` in front. Some gates read only what
 * git tracks (`lint:shell`, `lint:docker` and `lint:pointers` take their list
 * from `git ls-files`), so the same bytes before and after `git add` are two
 * different inputs to them, and the key has to move when the file is staged.
 */
export function hashWorkingTree(wanted, top = topLevel()) {
  const list = (...args) =>
    git(['ls-files', ...args, '-z'], { cwd: top }).split('\0').filter(Boolean).filter(wanted);
  const untracked = new Set(list('--others', '--exclude-standard'));
  const listed = new Set([...list('--cached'), ...untracked]);
  const hashes = new Map();
  const regular = [];
  for (const file of listed) {
    let stat;
    try {
      stat = lstatSync(path.join(top, file));
    } catch {
      continue; // deleted on disk: absent from the key
    }
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path.join(top, file));
      hashes.set(file, `link:${createHash('sha256').update(target).digest('hex')}`);
    } else if (stat.isFile()) regular.push(file);
  }
  if (regular.length) {
    const shas = git(['hash-object', '--stdin-paths'], { input: `${regular.join('\n')}\n`, cwd: top })
      .split('\n')
      .filter(Boolean);
    regular.forEach((file, i) => hashes.set(file, shas[i]));
  }
  for (const file of untracked) {
    if (hashes.has(file)) hashes.set(file, `?${hashes.get(file)}`);
  }
  return hashes;
}

/** Where records are kept: under the clone's common git directory. */
export function defaultCacheDir() {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  return path.join(common, 'tyr-gates');
}

const recordPath = (dir, gate, key) => path.join(dir, gate.id.replace(/[^\w.-]/g, '_'), `${key}.json`);

/** The pass recorded under this key, or null. A record that cannot be read is no record. */
export function readPass(dir, gate, key) {
  try {
    const record = JSON.parse(readFileSync(recordPath(dir, gate, key), 'utf8'));
    return record.version === VERSION && record.gate === gate.id && record.key === key ? record : null;
  } catch {
    return null;
  }
}

/**
 * Record a pass. Written to a temporary name and renamed, so a session reading
 * the same record never sees half of one.
 */
export function recordPass(dir, gate, key, { rev, at = new Date() }) {
  const file = recordPath(dir, gate, key);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: VERSION, gate: gate.id, key, rev, passedAt: at.toISOString() })}\n`,
  );
  renameSync(temporary, file);
}

/** The commit the working tree sits on, for the record's "passed at". */
function headRev() {
  try {
    const sha = git(['rev-parse', '--short', 'HEAD']).trim();
    // Untracked files too: the key hashes every file git does not ignore, so a
    // new input that passed before it was added is not in the named commit.
    const dirty = git(['status', '--porcelain']).trim() !== '';
    return dirty ? `${sha}+working tree` : sha;
  } catch {
    return 'unknown';
  }
}

/**
 * What a gate runs under beyond its files: the interpreters, and for a unit
 * lane whether it runs on the host or in the backend container
 * (`scripts/test-report.mjs`). The two read the repository differently — the
 * container has no git and mounts only part of the tree — so a pass in one
 * says nothing about the other.
 */
export function runtimeOf(gate, env = process.env) {
  const runtime = { node: process.version };
  if (gate.command.includes('scripts/test-report.mjs')) {
    runtime.lane = env.TEST_REPORT_LOCAL === '1' ? 'host' : 'container';
  }
  if (gate.setup === 'python') {
    try {
      const python = path.join(topLevel(), 'cv-python/.venv/bin/python');
      runtime.python = execFileSync(python, ['--version'], { encoding: 'utf8' }).trim();
    } catch {
      runtime.python = 'none';
    }
  }
  return runtime;
}

/**
 * The cache a run consults: `lookup(gate)` before a gate, `settle(gate, key)`
 * after its pass. `belongsTo(gate)` gives the predicate of the paths that enter
 * a gate's key; the working tree is hashed once per lookup and once per settle,
 * and a pass is recorded only if the two keys agree — a file edited while the
 * lane ran means the pass answers for neither tree.
 */
export function openGateCache({ dir = defaultCacheDir(), belongsTo }) {
  const keyNow = (gate) =>
    gateKey({
      gate,
      hashes: hashWorkingTree(belongsTo(gate)),
      belongs: belongsTo(gate),
      runtime: runtimeOf(gate),
    });
  return {
    lookup(gate) {
      const key = keyNow(gate);
      return { key, pass: readPass(dir, gate, key) };
    },
    settle(gate, keyBefore) {
      if (keyNow(gate) !== keyBefore) return false;
      recordPass(dir, gate, keyBefore, { rev: headRev() });
      return true;
    },
  };
}

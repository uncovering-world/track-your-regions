#!/usr/bin/env node
/**
 * How much review a branch asks for, measured before the first review round.
 *
 * Raw `git diff --stat` does not answer that question: of the branches merged
 * between #779 and #946, the one that drew the most review comments changed 736
 * lines of prose and no code at all (#869), while one that changed 2 931 lines
 * across 50 files drew two, because every line of it was a file being split
 * (#935). What separates the two is not size but how much of the diff is text a
 * reviewer has to *decide* about.
 *
 * So four kinds of churn are discounted, each because the history says reviewers
 * pass over it: generated output, lines that merely moved, one token renamed
 * across many files, and migrations. Prose is discounted by half rather than
 * ignored — #869 is the counter-example that keeps it in.
 *
 * The full baseline, the evidence for the budget and the rule for moving it are
 * in `docs/tech/review-surface.md` (#923).
 */
import { execFileSync } from 'node:child_process';

/** Output nothing asked a reviewer to write, so nothing asks one to read it. */
const GENERATED = [/(^|\/)package-lock\.json$/, /\.snap$/, /(^|\/)[^/]*\.lock$/];
const MIGRATION = [/^db\/migrations\//];
const DOCS = [/^docs\//, /\.md$/];

/**
 * A line that opens a comment in the languages this repository writes code in:
 * JS/TS, shell and Python, SQL. Matching the opener alone is enough — a
 * continuation line inside a block comment starts with `*`, and prose after `#`
 * is the comment itself.
 *
 * Markdown is deliberately not held to this: there `#` opens a heading and `*`
 * opens a bullet or a `**lead-in**`, all of which are the text itself. Prose
 * drops only when it is blank or an HTML comment.
 */
const CODE_COMMENT_OPENER = /^(\/\/|\/\*|\*\/|\*|#|--|<!--)/;
const PROSE_COMMENT_OPENER = /^<!--/;

/** Weight per kind of file. Code is the unit; everything else is read faster. */
const WEIGHT = { code: 1, docs: 1 / 2, migration: 1 / 4, generated: 0 };

/** A mechanical line still gets a glance, so it is discounted, not dropped. */
const MECHANICAL_WEIGHT = 1 / 8;

/**
 * How often one token substitution must recur on a branch before it reads as a
 * sweep rather than as a thought. Five is low enough to catch the small sweeps
 * (#816 renamed a field in 76 places, #865 moved one import in 13) and high
 * enough that no behavioural branch in the baseline set triggered it at all.
 */
const MECHANICAL_MIN_OCCURRENCES = 5;

/**
 * The budget, in counted lines. This is the one place the number is written:
 * the prose around it points here, so that re-reading the history changes the
 * budget in one file and not in five (#923).
 */
export const SURFACE_BUDGET = 800;

export function classifyFile(path) {
  if (GENERATED.some((r) => r.test(path))) return 'generated';
  if (MIGRATION.some((r) => r.test(path))) return 'migration';
  if (DOCS.some((r) => r.test(path))) return 'docs';
  return 'code';
}

/** The area a path belongs to — the seam a split would most likely follow. */
export function areaOf(path) {
  const [first, second] = path.split('/');
  if (first === 'backend' || first === 'frontend' || first === 'cv-python') return first;
  if (first === 'db') return 'db';
  if (first === 'docs') return second === 'decisions' ? 'docs/decisions' : 'docs';
  if (first === '.claude' || first === '.github' || first === 'scripts') return 'tooling';
  return first.includes('.') ? 'root' : first;
}

function isMeaningful(trimmed, kind) {
  if (trimmed === '') return false;
  return kind === 'docs' ? !PROSE_COMMENT_OPENER.test(trimmed) : !CODE_COMMENT_OPENER.test(trimmed);
}

const tokenize = (line) => line.match(/[A-Za-z0-9_]+|\S/g) ?? [];

/**
 * The one substitution that turns `before` into `after`, or null when the two
 * lines differ by anything else. Equal token counts and a single distinct
 * (from → to) pair is the whole test: `categoryId` → `sourceId` repeated down a
 * line still reads as one substitution, while a line that also gained an
 * argument does not.
 */
export function substitutionOf(before, after) {
  const from = tokenize(before);
  const to = tokenize(after);
  if (from.length !== to.length) return null;
  const pairs = new Set();
  for (let i = 0; i < from.length; i += 1) {
    if (from[i] !== to[i]) pairs.add(`${from[i]}\u0000${to[i]}`);
  }
  return pairs.size === 1 ? [...pairs][0] : null;
}

/**
 * Split a unified diff into files, each holding its hunks of changed lines.
 *
 * The `---` / `+++` headers are read **only** between a `diff --git` line and
 * the first `@@` of that file. Outside that window they are content: a deleted
 * SQL comment `-- Regions table` reaches the diff as `--- Regions table`, and
 * `db/init/01-schema.sql` alone holds 978 lines that would otherwise each be
 * read as the start of a new file.
 *
 * A file is named once, from the `+++` side, so that a rename with edits — two
 * headers naming two paths — is one file and not two; a pure rename, which
 * carries no `---`/`+++` at all, is named by its `rename to` line.
 */
function parseFiles(diff) {
  const files = [];
  let current = null;
  let inHeader = false;

  /** Whichever of the header's names the file should be counted under. */
  const resolve = (file) => {
    const path = file.plus ?? file.minus ?? file.renameTo ?? file.fromCommand;
    file.path = path;
    file.kind = classifyFile(path);
    file.area = areaOf(path);
  };

  const open = (line) => {
    // `diff --git a/<path> b/<path>` — the fallback name, used when the file has
    // no `+++` header of its own (a pure rename, a mode change, a binary file).
    const named = line.slice('diff --git '.length);
    const half = Math.floor(named.length / 2);
    const fromCommand =
      named[half] === ' ' ? named.slice(half + 1).replace(/^b\//, '') : named.split(' b/').pop();
    current = { fromCommand, plus: null, minus: null, renameTo: null, hunks: [] };
    files.push(current);
    inHeader = true;
  };

  let deleted = [];
  let added = [];
  const flush = () => {
    if (deleted.length || added.length) current.hunks.push({ deleted, added });
    deleted = [];
    added = [];
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) {
        flush();
        resolve(current);
      }
      open(line);
    } else if (!current) {
      continue;
    } else if (inHeader && line.startsWith('+++ ')) {
      const named = line.slice(4).trim();
      if (named !== '/dev/null') current.plus = named.replace(/^b\//, '');
    } else if (inHeader && line.startsWith('--- ')) {
      const named = line.slice(4).trim();
      if (named !== '/dev/null') current.minus = named.replace(/^a\//, '');
    } else if (inHeader && line.startsWith('rename to ')) {
      current.renameTo = line.slice('rename to '.length).trim();
    } else if (line.startsWith('@@')) {
      if (inHeader) {
        resolve(current);
        inHeader = false;
      }
      flush();
    } else if (!inHeader && (line[0] === '+' || line[0] === '-')) {
      const raw = line.slice(1);
      if (isMeaningful(raw.trim(), current.kind)) (line[0] === '+' ? added : deleted).push(raw);
    } else if (!inHeader) {
      flush();
    }
  }
  if (current) {
    flush();
    if (inHeader) resolve(current);
  }
  return files;
}

/**
 * Pair the lines that only moved, and hand back the ones that did not.
 *
 * Two passes, because indentation means two different things. A line whose text
 * matches **exactly** moved, wherever it went. A line that matches only once
 * trimmed moved only if it crossed into another file — that is a block lifted
 * into a new module and re-indented, the case this whole discount exists for.
 * Within one file the same match is a re-indentation, which in Python is a
 * change of behaviour and in review is a line to read.
 */
function pairMoves(added, deleted) {
  const takenAdded = new Array(added.length).fill(false);
  const takenDeleted = new Array(deleted.length).fill(false);
  let moved = 0;

  const index = (lines, key) => {
    const map = new Map();
    lines.forEach((line, i) => {
      const k = key(line);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    });
    return map;
  };

  const byRaw = index(deleted, (l) => l.raw);
  added.forEach((line, i) => {
    const queue = byRaw.get(line.raw);
    while (queue?.length) {
      const j = queue.shift();
      if (takenDeleted[j]) continue;
      takenAdded[i] = true;
      takenDeleted[j] = true;
      moved += 2;
      return;
    }
  });

  const byTrimmed = index(deleted, (l) => l.trimmed);
  added.forEach((line, i) => {
    if (takenAdded[i]) return;
    const queue = byTrimmed.get(line.trimmed) ?? [];
    for (let q = 0; q < queue.length; q += 1) {
      const j = queue[q];
      if (takenDeleted[j] || deleted[j].path === line.path) continue;
      takenAdded[i] = true;
      takenDeleted[j] = true;
      moved += 2;
      return;
    }
  });

  return {
    moved,
    survivors: [
      ...added.filter((_, i) => !takenAdded[i]),
      ...deleted.filter((_, i) => !takenDeleted[i]),
    ],
  };
}

/**
 * Round the per-area totals so they still add up to the surface.
 *
 * Half a line of prose here and half there is one line of review, not two:
 * rounding each area on its own would print columns that sum past the figure
 * they are meant to break down, and the breakdown is what an author reads to
 * decide what a split would save. Largest remainder first, which is the
 * ordinary way to hand out the difference.
 */
function roundAreas(entries, total) {
  const floors = entries.map(([area, lines]) => ({ area, lines: Math.floor(lines), rest: lines % 1 }));
  let left = total - floors.reduce((sum, a) => sum + a.lines, 0);
  for (const area of [...floors].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    area.lines += 1;
    left -= 1;
  }
  return floors.filter((a) => a.lines > 0).map(({ area, lines }) => ({ area, lines }));
}

/**
 * Measure one unified diff. Pure: the caller supplies the text, so the same
 * function serves the CLI, the tests and any replay of an old branch.
 */
export function measureSurface(diff) {
  const files = parseFiles(diff);

  // Pass one: which substitutions recur often enough to read as a sweep. Only
  // code counts here — a phrase reworded in ten paragraphs of prose is ten
  // decisions, not one.
  const occurrences = new Map();
  for (const file of files) {
    if (file.kind !== 'code') continue;
    for (const hunk of file.hunks) {
      const paired = Math.min(hunk.deleted.length, hunk.added.length);
      for (let i = 0; i < paired; i += 1) {
        const substitution = substitutionOf(hunk.deleted[i], hunk.added[i]);
        if (substitution) occurrences.set(substitution, (occurrences.get(substitution) ?? 0) + 1);
      }
    }
  }
  const sweeping = new Set(
    [...occurrences].filter(([, n]) => n >= MECHANICAL_MIN_OCCURRENCES).map(([s]) => s),
  );

  // Pass two: set the mechanical lines aside, then collect what is left as
  // line records, so the move pairing can tell a re-indentation from a block
  // that crossed into another file.
  const sides = {};
  const mechanicalLines = [];
  let mechanical = 0;
  let generated = 0;

  for (const file of files) {
    const { kind, path, area } = file;
    for (const hunk of file.hunks) {
      if (kind === 'generated') {
        generated += hunk.deleted.length + hunk.added.length;
        continue;
      }
      const mechanicalAt = new Set();
      if (kind === 'code') {
        const paired = Math.min(hunk.deleted.length, hunk.added.length);
        for (let i = 0; i < paired; i += 1) {
          const substitution = substitutionOf(hunk.deleted[i], hunk.added[i]);
          if (substitution && sweeping.has(substitution)) {
            mechanicalAt.add(i);
            mechanical += 2;
            mechanicalLines.push({ area }, { area });
          }
        }
      }
      sides[kind] ??= { added: [], deleted: [] };
      const record = (raw) => ({ raw, trimmed: raw.trim(), path, area });
      hunk.added.forEach((raw, i) => {
        if (!mechanicalAt.has(i)) sides[kind].added.push(record(raw));
      });
      hunk.deleted.forEach((raw, i) => {
        if (!mechanicalAt.has(i)) sides[kind].deleted.push(record(raw));
      });
    }
  }

  const counted = {};
  const byArea = new Map();
  let moved = 0;
  // Areas are attributed **after** the pairing and at the weight the line
  // carries, so the breakdown is in the surface's own unit and sums to it. It
  // is what /pr-create offers as a seam: an area that is all moved lines is not
  // work and must not read as the widest one, and 200 lines of prose must not
  // outrank 150 of code when they cost the same review.
  const attribute = (area, weight) => byArea.set(area, (byArea.get(area) ?? 0) + weight);
  for (const line of mechanicalLines) attribute(line.area, MECHANICAL_WEIGHT);
  for (const [kind, side] of Object.entries(sides)) {
    const paired = pairMoves(side.added, side.deleted);
    moved += paired.moved;
    counted[kind] = paired.survivors.length;
    for (const line of paired.survivors) attribute(line.area, WEIGHT[kind]);
  }

  const code = counted.code ?? 0;
  const docs = counted.docs ?? 0;
  const migration = counted.migration ?? 0;
  const surface = Math.round(
    code * WEIGHT.code +
      mechanical * MECHANICAL_WEIGHT +
      docs * WEIGHT.docs +
      migration * WEIGHT.migration,
  );

  return {
    surface,
    files: files.length,
    codeFiles: files.filter((f) => f.kind === 'code').length,
    code,
    docs,
    migration,
    moved,
    mechanical,
    generated,
    // Areas the change touched, largest first: the seams a split follows.
    areas: roundAreas([...byArea].sort((a, b) => b[1] - a[1]), surface),
    sweeps: [...occurrences]
      .filter(([, n]) => n >= MECHANICAL_MIN_OCCURRENCES)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => ({ from: s.split('\u0000')[0], to: s.split('\u0000')[1], lines: n })),
  };
}

/**
 * Git, asked about the repository the command was run in.
 *
 * The three location variables are dropped from the environment: git sets them
 * for a hook, and a hook that ran this would otherwise have it measure against
 * a temporary index or another worktree entirely.
 */
const git = (...args) => {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...env } = process.env;
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, env });
};

/** The diff a reviewer will be shown: the branch against its merge base. */
export function diffOf(base, rev) {
  return git('diff', '-M', '--unified=0', `${base}...${rev}`);
}

function report({ base, rev, json, budget }) {
  const measured = measureSurface(diffOf(base, rev));
  const commits = git('log', '--format=%h\t%s', `${base}..${rev}`)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split('\t');
      return {
        sha,
        subject,
        surface: measureSurface(git('diff', '-M', '--unified=0', `${sha}^`, sha)).surface,
      };
    });

  const over = measured.surface > budget;
  if (json) {
    console.log(JSON.stringify({ ...measured, budget, over, commits }, null, 2));
    return over;
  }

  console.log(`Review surface ${base}...${rev}: ${measured.surface} counted lines (budget ${budget})`);
  console.log(
    `  ${measured.files} files (${measured.codeFiles} code) · code ${measured.code}` +
      ` · docs ${measured.docs} · migrations ${measured.migration}`,
  );
  console.log(
    `  discounted: ${measured.moved} moved · ${measured.mechanical} mechanical · ${measured.generated} generated`,
  );
  if (measured.sweeps.length) {
    const shown = measured.sweeps.slice(0, 3).map((s) => `${s.from} → ${s.to} (${s.lines})`);
    console.log(`  sweeps: ${shown.join(', ')}`);
  }
  console.log('\n  By area, after the discounts:');
  for (const { area, lines } of measured.areas) console.log(`    ${String(lines).padStart(6)}  ${area}`);
  console.log('\n  By commit, each measured on its own:');
  for (const c of commits) console.log(`    ${String(c.surface).padStart(6)}  ${c.sha} ${c.subject}`);

  console.log(
    over
      ? `\nOver budget by ${measured.surface - budget}. Split along a seam above, or record why the` +
          ' surface is inherently one change — see docs/tech/review-surface.md.'
      : '\nWithin budget.',
  );
  return over;
}

const USAGE = 'usage: review-surface.mjs [--base <ref>] [--rev <ref>] [--budget <n>] [--json]';

/**
 * Read the command line, refusing anything it cannot read rather than carrying
 * on with a default. A wrong argument here is the worst kind of wrong: an
 * unreadable `--budget` becomes NaN, every comparison against it is false, and
 * the card reports "Within budget." for a branch of any size.
 */
export function parseArgs(argv) {
  const args = { base: 'main', rev: 'HEAD', json: false, budget: SURFACE_BUDGET };
  const value = (i, flag) => {
    const given = argv[i];
    // `--base --json` would otherwise measure against a ref called `--json`,
    // and `--budget ''` would become a budget of zero, which flags everything.
    if (given === undefined || given.trim() === '' || given.startsWith('--')) {
      throw new Error(`${flag} needs a value.`);
    }
    return given;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--base') args.base = value(++i, '--base');
    else if (arg === '--rev') args.rev = value(++i, '--rev');
    else if (arg === '--budget') {
      const given = value(++i, '--budget');
      const budget = Number(given);
      if (!Number.isFinite(budget) || budget < 0) {
        throw new Error(`--budget must be a number, not "${given}".`);
      }
      args.budget = budget;
    } else throw new Error(`Unknown argument "${arg}".`);
  }
  return args;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  // Exit 0 either way: this measures, it does not gate (#923).
  report(args);
}

// The tests import the pure functions; only a direct run measures a branch.
if (process.argv[1] && process.argv[1].endsWith('review-surface.mjs')) main(process.argv.slice(2));

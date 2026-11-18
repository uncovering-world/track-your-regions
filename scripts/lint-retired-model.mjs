#!/usr/bin/env node
/**
 * Refuses a name the catalogue model has retired, wherever living text holds
 * it: the fresh schema, the source and its specs, the lint rules, the scripts,
 * the living docs and the skills (#2131, ADR-0225).
 *
 * The model lands slice by slice (ADR-0225 § From today's database to the
 * model), and each slice deletes what it replaces: the column, the code path,
 * the helper, the comment and the doc sentence. Review alone misses a
 * leftover, so the ledger, scripts/retired-model.json, lists every table,
 * column, trigger, function, constant, type, API field and term the model
 * retires, with the slice and the issue that retire it and its state. A
 * retired entry named outside its allow lines fails the gate; a pending one
 * is the debt its slice still owes, printed as a count per entry and never
 * failed. A slice flips its entries to retired in the pull request that
 * retires them, and the gate holds the tree to that from then on.
 *
 * What is not read: the point-in-time records (an ADR, a research report, a
 * migration, an audit), which name what they decided or what a database went
 * through, and the gate's own files. A retired name on a schema-file line that
 * drops it (DROP ... IF EXISTS) is the step that retires it on a database the
 * file is re-applied to; it is counted as owed to the switch slice, which
 * folds the migrations into one baseline (B17, #2129), and is not a failure.
 *
 * Exit 1 with every hit as path, line and entry; exit 0 with the debt table.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The ledger, relative to the repository root. */
export const LEDGER_PATH = 'scripts/retired-model.json';

/** Where living text lives: a path prefix, or an exact path. */
export const READ = [
  'db/init/', 'backend/', 'frontend/', 'packages/', 'scripts/',
  'docs/tech/', 'docs/vision/', 'docs/security/SECURITY.md', 'docs/README.md',
  'CLAUDE.md', '.claude/skills/',
];

/** Inside what is read, what is not, each with its reason. */
export const NOT_READ = [
  [LEDGER_PATH, 'the ledger names every retired entry by definition'],
  ['scripts/lint-retired-model.mjs', 'this gate: its examples are the names it refuses'],
  ['scripts/lint-retired-model.test.mjs', 'its spec: the fixtures are the names it refuses'],
];

export const STATES = ['retired', 'pending'];

/** A schema-file line that drops an object if it is there: a retirement step, not a use. */
export const DROP_STEP = /\bDROP\s+(?:TRIGGER|FUNCTION|TABLE|INDEX|VIEW|CONSTRAINT|COLUMN)\s+IF\s+EXISTS\b/;

const escape = (text) => text.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');

/** One regular expression for an entry: each name as a whole identifier, then its pattern. */
export function entryPattern(entry) {
  const parts = (entry.names ?? []).map((name) => '(?<![\\w$])' + escape(name) + '(?![\\w$])');
  if (entry.pattern) parts.push('(?:' + entry.pattern + ')');
  return new RegExp(parts.join('|'));
}

/** What is wrong with one entry, as sentences. */
function entryFaults(entry) {
  const at = 'entry ' + (entry.id ?? '(no id)');
  const faults = [];
  if (!entry.id) faults.push(at + ': no id');
  if (!entry.what) faults.push(at + ': no what');
  if (!STATES.includes(entry.state)) faults.push(at + ': state is ' + entry.state + ', not one of ' + STATES.join(', '));
  if (!entry.slice) faults.push(at + ': no slice');
  if (entry.issue !== null && !Number.isInteger(entry.issue)) faults.push(at + ': issue is a number or null');
  if (!(entry.names?.length) && !entry.pattern) faults.push(at + ': neither names nor a pattern');
  if (entry.floor !== undefined && typeof entry.floor !== 'boolean') faults.push(at + ': floor is true or false');
  try {
    entryPattern(entry);
  } catch (error) {
    faults.push(at + ': ' + error.message);
  }
  return faults;
}

/** What is wrong with one allow line, as sentences. */
function allowFaults(allow, ids) {
  const at = 'allow ' + allow.path + ' (' + allow.entry + ')';
  const faults = [];
  if (!ids.has(allow.entry)) faults.push(at + ': names no entry');
  if (!allow.path) faults.push(at + ': names no path');
  if (!allow.why) faults.push(at + ': gives no reason');
  return faults;
}

/** What is wrong with a ledger, as sentences; empty when it is well formed. */
export function ledgerFaults(ledger) {
  const entries = ledger.entries ?? [];
  const ids = new Set(entries.map((entry) => entry.id));
  const twice = entries.filter((entry, index) => entries.findIndex((other) => other.id === entry.id) !== index);
  return [
    ...twice.map((entry) => 'entry ' + entry.id + ': id used twice'),
    ...entries.flatMap(entryFaults),
    ...(ledger.allow ?? []).flatMap((allow) => allowFaults(allow, ids)),
  ];
}

const isRead = (path) => READ.some((prefix) => path === prefix || (prefix.endsWith('/') && path.startsWith(prefix)))
  && !NOT_READ.some(([skip]) => path === skip);

/** Every mention of an entry in one file's text: { entry, line, text }. */
export function mentionsIn(text, entries) {
  const found = [];
  let lines;
  for (const { entry, pattern } of entries) {
    if (!pattern.test(text)) continue;
    lines ??= text.split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push({ entry, line: index + 1, text: line });
    });
  }
  return found;
}

/**
 * Sorts the mentions: a retired entry's is a failure unless an allow line or a
 * schema drop step covers it; a pending entry's is debt. An allow line that
 * covers nothing is stale, and stale is a failure too.
 */
export function judge(mentions, ledger) {
  const allows = (ledger.allow ?? []).map((allow) => ({ ...allow, used: 0 }));
  const failures = [];
  const allowed = [];
  const dropSteps = [];
  const debt = new Map();
  for (const mention of mentions) {
    const allow = allows.find((a) => a.entry === mention.entry.id && a.path === mention.path && (a.text === undefined || mention.text.includes(a.text)));
    if (allow) {
      allow.used += 1;
      allowed.push(mention);
    } else if (mention.entry.state === 'pending') {
      const owed = debt.get(mention.entry.id) ?? { mentions: 0, files: new Set() };
      owed.mentions += 1;
      owed.files.add(mention.path);
      debt.set(mention.entry.id, owed);
    } else if (mention.path.startsWith('db/init/') && DROP_STEP.test(mention.text)) {
      dropSteps.push(mention);
    } else {
      failures.push(mention);
    }
  }
  const stale = allows.filter((a) => a.used === 0);
  return { failures, allowed, dropSteps, debt, stale };
}

/** The symbolic links and submodules aside, every tracked file this gate reads. */
export function readFiles(root) {
  const listed = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 27 });
  return listed.split('\0').filter(Boolean)
    .map((line) => ({ mode: line.slice(0, 6), path: line.slice(line.indexOf('\t') + 1) }))
    .filter(({ mode, path }) => mode.startsWith('100') && isRead(path))
    .map(({ path }) => path);
}

/** Runs the gate over the tree at root. */
export function lintRetiredModel(root) {
  const ledger = JSON.parse(readFileSync(root + '/' + LEDGER_PATH, 'utf8'));
  const faults = ledgerFaults(ledger);
  if (faults.length > 0) return { ledger, faults };
  const entries = ledger.entries.map((entry) => ({ entry, pattern: entryPattern(entry) }));
  const mentions = [];
  const files = readFiles(root);
  for (const path of files) {
    const text = readFileSync(root + '/' + path, 'utf8');
    if (text.includes('\0')) continue;
    for (const mention of mentionsIn(text, entries)) mentions.push({ path, ...mention });
  }
  return { ledger, faults, files: files.length, ...judge(mentions, ledger) };
}

/** The debt table: one line per pending entry, in the ledger's order. */
export function debtLines(ledger, debt) {
  return ledger.entries.filter((entry) => entry.state === 'pending').map((entry) => {
    const owed = debt.get(entry.id);
    const issue = entry.issue === null ? 'no issue yet' : '#' + entry.issue;
    const count = owed ? owed.mentions + ' in ' + owed.files.size + ' files' : 'none found';
    return '  ' + entry.slice.padEnd(12) + issue.padEnd(14) + entry.id.padEnd(30) + count + (entry.floor ? ' (a floor)' : '');
  });
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const result = lintRetiredModel(root);
  if (result.faults.length > 0) {
    for (const fault of result.faults) console.error('lint:retired: ' + LEDGER_PATH + ': ' + fault);
    process.exit(1);
  }
  const { ledger, failures, allowed, dropSteps, debt, stale } = result;
  const retired = ledger.entries.filter((entry) => entry.state === 'retired').length;
  console.log('lint:retired: ' + result.files + ' files read, ' + retired + ' retired entries, '
    + (ledger.entries.length - retired) + ' pending');
  console.log('Pending, the mentions each slice still owes:');
  for (const line of debtLines(ledger, debt)) console.log(line);
  if (dropSteps.length > 0) {
    console.log('Schema-file steps that drop a retired name, owed to the switch (B17, #2129): ' + dropSteps.length);
  }
  if (allowed.length > 0) console.log('Allowed mentions of an entry, each with its reason in the ledger: ' + allowed.length);
  for (const { entry, path, line, text } of failures) {
    console.error(path + ':' + line + ': [' + entry.id + ', retired by ' + entry.slice + '] ' + text.trim().slice(0, 160));
  }
  for (const allow of stale) {
    console.error(LEDGER_PATH + ': allow line for ' + allow.entry + ' in ' + allow.path + ' matches no mention' + (allow.text === undefined ? '' : ': "' + allow.text + '"'));
  }
  if (failures.length > 0 || stale.length > 0) {
    console.error('\nlint:retired: ' + failures.length + ' mention(s) of a retired entry, ' + stale.length + ' stale allow line(s). '
      + 'Delete what the slice replaced, or, for a deliberate mention, add an allow line with its reason to ' + LEDGER_PATH
      + ' (docs/tech/gates.md § The retired model).');
    process.exit(1);
  }
}

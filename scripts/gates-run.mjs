/**
 * Running the gate map's tiers and printing what it decided (`scripts/gates.mjs`
 * decides; this runs and reports). The map reads it and it reads nothing of the
 * map's. A change here changes how every CI job runs, so it is one of
 * `CI_GLOBAL` and of the cache key's globals.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { LANES, loadsModules, readsText, selectSpecs } from './affected-specs.mjs';
import { git, rootFile, rootScripts } from './gates-base.mjs';

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
// eslint-disable-next-line sonarjs/cognitive-complexity -- the gate tooling as it stood when scripts/ was first linted (#655); splitting it changes the runner's control flow and is #1552, pinned by its specs
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

// eslint-disable-next-line sonarjs/cognitive-complexity -- the gate tooling as it stood when scripts/ was first linted (#655); splitting it changes the runner's control flow and is #1552, pinned by its specs
export function printList(decision, changed, rev) {
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
 * The affected selection of each Node unit lane for these changed paths
 * (impure: it reads the specs and asks the disk which paths still exist). A
 * change set it cannot read runs every lane whole.
 */
export function affectedSelector(paths) {
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

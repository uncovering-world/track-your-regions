import { describe, expect, it } from 'vitest';
import { changedPaths, freshestBase, listFrom } from './gates-base.mjs';
import { decide } from './gates.mjs';

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
  it('takes origin/main over a local main it has moved past, and keeps a main with work of its own', () => {
    const behind = (older, newer) => older === 'main' && newer === 'origin/main';
    expect(freshestBase(['main', 'origin/main'], behind)).toBe('origin/main');
    expect(freshestBase(['main', 'origin/main'], () => false)).toBe('main');
    expect(freshestBase(['origin/main'], behind)).toBe('origin/main');
    expect(freshestBase(['main'], behind)).toBe('main');
  });

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

describe('a change set git cannot list', () => {
  it('runs every gate and says why, when the base shares no history with the revision', () => {
    // No commit has this id, so git finds no merge base — in a checkout and in
    // the container lane alike, where there is no repository at all.
    const changed = changedPaths({ base: '0123456789abcdef0123456789abcdef01234567', rev: 'HEAD' });
    expect(changed.paths).toBeNull();
    expect(changed.reason).toMatch(/^No merge base between 0123456789abcdef0123456789abcdef01234567 and HEAD \(.+\), so every gate applies\.$/);
    expect(changed.reason).not.toContain('\n');
  });
});

describe('the commit a change set is listed from', () => {
  const merge = 'f0rk';
  it('lists a review wave from the pushed head the fold rewrote past, not from the fork', () => {
    // A wave folded into the branch's commits leaves the pushed head no ancestor
    // of it; its merge base is the fork from main, which reads as the whole
    // branch. What differs from the head's tree is the wave (#1391).
    expect(listFrom({ base: 'pushed', flag: true, isAncestor: false, onMainLine: false, mergeBase: merge }))
      .toEqual({ from: 'pushed', how: 'tree' });
  });

  it('keeps the merge base for an ancestor, a main that moved on, and a base CI or the runner set', () => {
    // An ancestor is its own merge base; listing from it is the same either way.
    expect(listFrom({ base: 'main', flag: true, isAncestor: true, onMainLine: true, mergeBase: 'main' }).how)
      .toBe('merge-base');
    // `--base origin/main` after a merge on GitHub is no ancestor of the branch,
    // but what it gained since the fork is main's, not the branch's.
    expect(listFrom({ base: 'origin/main', flag: true, isAncestor: false, onMainLine: true, mergeBase: merge }))
      .toEqual({ from: merge, how: 'merge-base' });
    // GATES_BASE is CI's, set from the event: main's own commits since the
    // fork stay out of the change set there.
    expect(listFrom({ base: 'main', flag: false, isAncestor: false, onMainLine: true, mergeBase: merge }))
      .toEqual({ from: merge, how: 'merge-base' });
  });
});

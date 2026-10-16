import { describe, expect, it, vi } from 'vitest';
import { ENVIRONMENT_FAILED, imagesOf, runTier, stackVerdicts } from './gates-run.mjs';
import { decide, parseArgs } from './gates.mjs';

/**
 * A spawner that runs nothing, so the runner's output shapes can be driven
 * without a Docker image or three minutes of vitest. `results` answers call by
 * call; anything past its end passes.
 */
function fakeSpawn(results = []) {
  const calls = [];
  const envs = [];
  const spawn = (command, args, options) => {
    calls.push([command, ...args].join(' '));
    envs.push(options?.env);
    return results[calls.length - 1] ?? { status: 0 };
  };
  spawn.calls = calls;
  spawn.envs = envs;
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
  // The shared package asks for both Node unit lanes, which these shapes need.
  const backend = () => decide({ paths: ['packages/shared/src/a.ts'] });

  it('hands a base given as --base to every gate it runs, as GATES_BASE', () => {
    const spawn = fakeSpawn();
    capture(backend(), 'test', { spawn, base: 'origin/release' });
    expect(spawn.envs.map((env) => env.GATES_BASE)).toEqual(['origin/release', 'origin/release']);

    const plain = fakeSpawn();
    capture(backend(), 'test', { spawn: plain });
    expect(plain.envs.every((env) => env.GATES_BASE === process.env.GATES_BASE)).toBe(true);

    // What `parseArgs` leaves where no --base was given: CI's own GATES_BASE
    // must reach the gate, not the text "null".
    const unset = fakeSpawn();
    capture(backend(), 'test', { spawn: unset, base: parseArgs(['run', 'test']).base });
    expect(unset.envs.every((env) => env.GATES_BASE === process.env.GATES_BASE)).toBe(true);
  });

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

  it('says which specs a selected lane runs, and hands the selection to it', () => {
    const select = (gate) => (gate.id === 'test:backend'
      ? { whole: false, why: '1 changed module', env: { TEST_REPORT_RELATED: '["src/a.ts"]' } }
      : { whole: true, why: 'frontend/vite.config.ts configures every spec of the lane' });
    const spawn = fakeSpawn();
    const { printed } = capture(backend(), 'test', { spawn, select });
    expect(printed).toContain('affected specs: 1 changed module');
    expect(printed).toContain('whole lane: frontend/vite.config.ts configures every spec of the lane');
    expect(spawn.envs[0].TEST_REPORT_RELATED).toBe('["src/a.ts"]');
    expect(spawn.envs[1].TEST_REPORT_RELATED).toBeUndefined();

    // A selection that reaches no spec starts nothing, and says so.
    const none = fakeSpawn();
    const quiet = capture(backend(), 'test', {
      spawn: none,
      select: () => ({ none: true, why: '0 changed modules; no spec of the lane reaches the change' }),
    });
    expect(none.calls).toEqual([]);
    expect(quiet.code).toBe(0);
    expect(quiet.printed).toContain('○ test:backend  affected specs: 0 changed modules; no spec of the lane reaches the change');
    expect(quiet.printed).toContain('Not started (the change reaches no spec of the lane): test:backend, test:frontend');

    // An inherited selection never narrows a whole lane.
    const before = process.env.TEST_REPORT_RELATED;
    process.env.TEST_REPORT_RELATED = '["src/stale.ts"]';
    try {
      const whole = fakeSpawn();
      capture(backend(), 'test', { spawn: whole });
      expect(whole.envs.every((env) => env.TEST_REPORT_RELATED === undefined)).toBe(true);
    } finally {
      if (before === undefined) delete process.env.TEST_REPORT_RELATED;
      else process.env.TEST_REPORT_RELATED = before;
    }
  });

  it('pulls a Docker gate\'s pinned images first, and names a registry\'s refusal as the environment\'s (#1316)', () => {
    const docs = decide({ paths: ['docs/tech/x.md'] });
    const links = docs.gates.find((gate) => gate.id === 'lint:links');
    expect(imagesOf(links)).toEqual([expect.stringMatching(/^lycheeverse\/lychee:[\w.-]+@sha256:[0-9a-f]{64}$/)]);
    expect(imagesOf(docs.gates.find((gate) => gate.id === 'lint:md'))).toEqual([]);
    // A pin a runner script keeps rather than its npm script: oasdiff, and the scanner spelled without a tag.
    const docker = (script) => ({ setup: 'docker', command: ['npm', 'run', script] });
    expect(imagesOf(docker('api:breaking'))).toEqual([expect.stringMatching(/^tufin\/oasdiff:v[\d.]+@sha256:[0-9a-f]{64}$/)]);
    expect(imagesOf(docker('security:image'))).toEqual([expect.stringMatching(/^aquasec\/trivy@sha256:[0-9a-f]{64}$/)]);

    // The tier runs security:secrets (its image on the host, then the scan),
    // lint:md, then lint:links: inspect (absent), pull (refused).
    const refused = fakeSpawn([
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 1 },
      { status: 1, stderr: 'Error response from daemon: toomanyrequests: You have reached your unauthenticated pull rate limit' },
    ]);
    const run = capture(docs, 'check', { spawn: refused });
    expect(run.code).toBe(ENVIRONMENT_FAILED);
    expect(run.printed).toContain('lint:links could not run: the registry refused lycheeverse/lychee');
    expect(run.printed).toContain('the environment: the registry refused an image it runs');
    expect(refused.calls.some((call) => call.startsWith('npm run lint:links'))).toBe(false);

    // A pin that names no manifest is the repository's error: the gate runs and fails on it.
    const unknown = fakeSpawn([{ status: 0 }, { status: 0 }, { status: 0 }, { status: 1 }, { status: 1, stderr: 'manifest unknown' }, { status: 125 }]);
    const pinned = capture(docs, 'check', { spawn: unknown });
    expect(pinned.code).toBe(125);
    expect(pinned.printed).toContain('Failed: lint:links (exit 125)');
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
    // why*. `printList` prints the reason, so a fifteen-gate run names the
    // shallow clone behind it instead of a stack listing that repeats `(every
    // gate applies)` on every line (#783).
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

  it('lists the stack tier without running it, and says where each lane is owed', () => {
    const spawn = fakeSpawn();
    const docs = capture(decide({ paths: ['docs/tech/x.md'] }), 'stack', { spawn });

    expect(docs.code).toBe(2);
    expect(spawn.calls).toEqual([]);
    // A Markdown-only branch must not be told to spend ten minutes on the
    // smoke lane and Lighthouse for prose neither of them can see.
    for (const id of ['build', 'test:e2e:smoke', 'perf']) {
      expect(docs.printed, id).toContain(`skip       ${id.padEnd(16)}`);
    }

    // CI runs every stack lane it asks for; only what CI cannot measure is
    // owed here too (#1379).
    const verdict = (paths) =>
      Object.fromEntries(stackVerdicts(decide({ paths })).map((gate) => [gate.id, gate.verdict]));
    const owed = (paths) => stackVerdicts(decide({ paths }))
      .filter((gate) => gate.verdict === 'run here')
      .map((gate) => gate.command.join(' '));
    expect(verdict(['backend/src/a.ts'])['test:e2e:smoke']).toBe('CI runs it');
    // A backend change owes the latency probe, which no CI job runs, and not
    // Lighthouse; a web change owes Lighthouse on the real catalogue.
    expect(owed(['backend/src/a.ts'])).toEqual(['npm run perf:api']);
    expect(owed(['db/migrations/060-x.sql'])).toEqual(['npm run perf:api']);
    expect(owed(['frontend/src/a.tsx'])).toEqual(['npm run perf:local']);
    // perf:local runs the probe as its last step, so it is not owed beside it.
    expect(owed(['packages/shared/src/a.ts'])).toEqual(['npm run perf:local']);
    expect(owed(['frontend/src/a.tsx', 'backend/src/a.ts'])).toEqual(['npm run perf:local']);
    expect(owed(['scripts/test-stack.sh'])).toEqual([]);
    // A change to a measurement's own runner, which no CI job runs, owes it.
    expect(owed(['scripts/perf-api.mjs'])).toEqual(['npm run perf:api']);
    expect(owed(['scripts/perf-local.sh'])).toEqual(['npm run perf:local']);
    // A change only every gate can answer for owes everything once.
    expect(stackVerdicts(decide({ paths: null })).filter((gate) => gate.verdict === 'run here')
      .map((gate) => gate.command.join(' '))).toEqual(['npm run perf:local']);
    const listed = capture(decide({ paths: ['frontend/src/a.tsx'] }), 'stack', { spawn: fakeSpawn() });
    expect(listed.printed).toContain("where CI's lane weighs a fixture");
  });
});

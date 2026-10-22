import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseEnv, runTool, sideBySide } from './tools.js';

/** Running the OpenStreetMap tools as child processes, shown with the shell as a stand-in tool. */

const SH = '/bin/sh';

describe('runTool', () => {
  it("answers the tool's stdout, with the environment it was given", async () => {
    expect(await runTool(SH, ['-c', 'printf "%s" "$OSM_LAYER_TABLE"'], { signal: new AbortController().signal, env: { OSM_LAYER_TABLE: 'osm_objects_next' } }))
      .toEqual({ stdout: 'osm_objects_next', stderr: '', code: 0 });
  });

  it('answers an exit code its caller said it expects, with the stderr to read', async () => {
    expect(await runTool(SH, ['-c', 'echo "Did not find 1 object(s)." >&2; exit 1'], { signal: new AbortController().signal, exitCodes: [0, 1] }))
      .toEqual({ stdout: '', stderr: 'Did not find 1 object(s).\n', code: 1 });
  });

  it('fails with the end of what a failed tool wrote to stderr', async () => {
    await expect(runTool(SH, ['-c', 'echo "Objects out of order" >&2; exit 1'], { signal: new AbortController().signal }))
      .rejects.toThrow(/sh -c failed \(1\): Objects out of order/);
  });

  it('kills the tool when the build is cancelled', async () => {
    const cancel = new AbortController();
    const running = runTool(SH, ['-c', 'sleep 30'], { signal: cancel.signal });
    cancel.abort();
    await expect(running).rejects.toThrow();
  });

  it('settles a cancel only once the tool has ended, not when the kill is sent', async () => {
    const ended = join(mkdtempSync(join(tmpdir(), 'tools-')), 'ended');
    const cancel = new AbortController();
    // The stand-in takes a moment to end after the kill, as osmium flushing its output would.
    const running = runTool(SH, ['-c', `trap 'sleep 0.3; touch "${ended}"; exit 1' TERM; sleep 30 >/dev/null 2>&1 & wait`], { signal: cancel.signal });
    await new Promise(resolve => setTimeout(resolve, 200));
    cancel.abort();
    await expect(running).rejects.toThrow();
    expect(existsSync(ended)).toBe(true);
  });
});

describe('databaseEnv', () => {
  it("hands osm2pgsql the backend's database settings through libpq's environment", () => {
    expect(Object.keys(databaseEnv()).sort()).toEqual(['PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGUSER']);
  });
});

describe('sideBySide', () => {
  it('answers every tool, in order', async () => {
    const answers = await sideBySide(new AbortController().signal, [
      (signal) => runTool(SH, ['-c', 'printf a'], { signal }),
      (signal) => runTool(SH, ['-c', 'printf b'], { signal }),
    ]);
    expect(answers.map(answer => answer.stdout)).toEqual(['a', 'b']);
  });

  it('kills the others when one fails, waits for them, and fails with the first failure', async () => {
    let sleeperEnded = false;
    const started = Date.now();
    await expect(sideBySide(new AbortController().signal, [
      (signal) => runTool(SH, ['-c', 'sleep 30'], { signal }).finally(() => { sleeperEnded = true; }),
      (signal) => runTool(SH, ['-c', 'echo "Objects out of order" >&2; exit 1'], { signal }),
    ])).rejects.toThrow(/Objects out of order/);
    expect(sleeperEnded).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('kills every tool when the build is cancelled', async () => {
    const cancel = new AbortController();
    const running = sideBySide(cancel.signal, [
      (signal) => runTool(SH, ['-c', 'sleep 30'], { signal }),
      (signal) => runTool(SH, ['-c', 'sleep 30'], { signal }),
    ]);
    cancel.abort();
    await expect(running).rejects.toThrow();
  });
});

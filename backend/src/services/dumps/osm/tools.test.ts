import { describe, expect, it } from 'vitest';
import { databaseEnv, runTool } from './tools.js';

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
});

describe('databaseEnv', () => {
  it("hands osm2pgsql the backend's database settings through libpq's environment", () => {
    expect(Object.keys(databaseEnv()).sort()).toEqual(['PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGUSER']);
  });
});

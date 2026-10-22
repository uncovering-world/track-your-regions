/**
 * The OpenStreetMap tools the layer's build runs in the dump worker (ADR-0134):
 * osmium, which cuts the planet, and osm2pgsql, which loads the cut. The
 * worker's image installs both (backend/Dockerfile, `BASE=node-osm`).
 *
 * Each runs as a child process with its arguments as a list, never through a
 * shell, by its absolute path, as the dump reader runs bzip2 (`read.ts`). A
 * cancel kills it. A tool that fails fails the build with the end of what it
 * wrote to stderr; a caller that knows what an exit code other than 0 means
 * names it (`exitCodes`) and reads the stderr itself.
 */

import { spawn } from 'node:child_process';

export const OSMIUM = '/usr/bin/osmium';
/**
 * How osmium writes the files a build makes for osmium to read again (the
 * current planet, the two cuts before they are merged): PBF compressed with
 * lz4 rather than zlib, which writes and reads several times faster for files
 * about a quarter larger. Rewriting the 95 GB planet with zlib took 21.5
 * minutes on the first build (2026-10-22), most of it compressing. The weekly
 * planet is the host's and stays as it came.
 */
export const OSMIUM_OUTPUT = '--output-format=pbf,pbf_compression=lz4';

/**
 * How osmium writes the cut osm2pgsql loads: PBF with its blocks left
 * uncompressed. The Debian build of osm2pgsql 2.1.1 refuses lz4 ("lz4 blobs
 * not supported"), and a cut it reads once is not worth compressing.
 */
export const OSM2PGSQL_INPUT = '--output-format=pbf,pbf_compression=none';
export const OSM2PGSQL = '/usr/bin/osm2pgsql';

/** How much of a failed tool's stderr its error carries. */
const STDERR_SHOWN = 2000;
/** How much of a tool's stderr is kept for its caller: the end, where osmium sums up what it did. */
const STDERR_KEPT = 64 * 1024;

export interface ToolResult {
  stdout: string;
  /** The end of what the tool wrote to stderr. */
  stderr: string;
  code: number;
}

/** Run `command` with `args` to its end; answers its output, and fails on an exit code it was not told to expect. */
export function runTool(
  command: string, args: readonly string[],
  options: { signal: AbortSignal; env?: NodeJS.ProcessEnv; exitCodes?: readonly number[] },
): Promise<ToolResult> {
  const accepted = options.exitCodes ?? [0];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal, env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-STDERR_KEPT); });
    // A cancel is reported as soon as the kill is sent, before the process has
    // ended: it settles when the process exits, so no caller removes a
    // directory the tool is still writing into. Its exit rather than its pipes
    // closing, which a process it started may hold open after it. A tool that
    // never started has no end to wait for.
    let failure: Error | null = null;
    child.on('error', (error) => {
      if (child.pid === undefined) reject(error);
      else failure = error;
    });
    child.on('exit', () => { if (failure) reject(failure); });
    child.on('close', (code, signal) => {
      if (failure) reject(failure);
      else if (code !== null && accepted.includes(code)) resolve({ stdout, stderr, code });
      else reject(new Error(`${command.split('/').pop()} ${args[0] ?? ''} failed (${code ?? signal}): ${stderr.slice(-STDERR_SHOWN).trim()}`));
    });
  });
}

/**
 * Run steps side by side to the end of all of them: tools, or statements on
 * connections of their own. The first that fails, or a cancel, aborts the
 * rest, and the answer waits until each has settled — a tool once its process
 * has ended (`runTool`), a statement once its query is cancelled — so a cut
 * still reading the planet never writes into a directory the build removed,
 * and an index still being built never holds up the drop of its table. Fails
 * with the first failure.
 */
export async function sideBySide<T>(signal: AbortSignal, runs: Array<(signal: AbortSignal) => Promise<T>>): Promise<T[]> {
  const pair = new AbortController();
  const stop = () => pair.abort(signal.reason);
  if (signal.aborted) stop();
  signal.addEventListener('abort', stop, { once: true });
  let first: { error: unknown } | null = null;
  try {
    const settled = await Promise.allSettled(runs.map(run => run(pair.signal).catch((error: unknown) => {
      first ??= { error };
      pair.abort(error);
      throw error;
    })));
    if (first) throw (first as { error: unknown }).error;
    return settled.map(result => (result as PromiseFulfilledResult<T>).value);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

/**
 * The libpq settings osm2pgsql connects with: the backend's own database
 * settings (`db/index.ts`). The password goes in the environment, never on
 * the command line, where any process could read it.
 */
export function databaseEnv(): NodeJS.ProcessEnv {
  return {
    PGHOST: process.env.DB_HOST || 'localhost',
    PGPORT: process.env.DB_PORT || '5432',
    PGDATABASE: process.env.DB_NAME || 'track_regions',
    PGUSER: process.env.DB_USER || 'postgres',
    PGPASSWORD: process.env.DB_PASSWORD || 'postgres',
  };
}

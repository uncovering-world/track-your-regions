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
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== null && accepted.includes(code)) resolve({ stdout, stderr, code });
      else reject(new Error(`${command.split('/').pop()} ${args[0] ?? ''} failed (${code ?? signal}): ${stderr.slice(-STDERR_SHOWN).trim()}`));
    });
  });
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

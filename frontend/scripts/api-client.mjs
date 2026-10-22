#!/usr/bin/env node
/**
 * Generate the web's API client from the OpenAPI document (ADR-0073).
 *
 *   node scripts/api-client.mjs           write src/api/client.generated.ts and adminClient.generated.ts
 *   node scripts/api-client.mjs --check   exit 1 when a committed file is not what the document generates
 *
 * Orval renders one plain `fetch` function per operation, with its path and
 * query parameters, body and answer typed from the document, and a URL builder
 * beside it; every function calls `apiFetch` (`src/api/fetchUtils.ts`), the one
 * place the token is handled. No TanStack Query hooks are generated:
 * `queryKeys.ts` owns the keys.
 *
 * The admin operations (the `admin` tag) are generated into a module of their
 * own, `adminClient.generated.ts`, which only the admin screens' modules
 * import (`src/api/admin/`): Rollup keeps every export something imports in
 * the chunk of the module that defines it, so in one module every admin
 * endpoint would load on every visitor's page (#1850).
 *
 * Orval writes the mutator's import relative to the file it generates, so the
 * check generates beside each committed file, under a scratch name, compares,
 * and removes it.
 */
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from 'orval';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Each generated module: the file, its scratch name for the check, and the operations it holds. */
export const CLIENTS = [
  { file: 'src/api/client.generated.ts', scratch: 'src/api/client.check.generated.ts', filters: { mode: 'exclude', tags: ['admin'] } },
  { file: 'src/api/adminClient.generated.ts', scratch: 'src/api/adminClient.check.generated.ts', filters: { mode: 'include', tags: ['admin'] } },
];

/** Orval logs a failed generation and resolves; this makes it fail the command. */
const THROW = { throwOnError: true };

function options(target, filters) {
  return {
    input: { target: '../packages/shared/src/openapi.generated.json', filters },
    output: {
      target,
      mode: 'single',
      client: 'fetch',
      // A path parameter is a string where the document says so (a cache's
      // name, a review's id), and one holding `/` or `?` would otherwise break
      // the path it is written into.
      urlEncodeParameters: true,
      override: {
        mutator: { path: './src/api/fetchUtils.ts', name: 'apiFetch' },
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  };
}

async function main() {
  if (!process.argv.includes('--check')) {
    for (const client of CLIENTS) await generate(options(client.file, client.filters), frontend, THROW);
    return 0;
  }
  let stale = 0;
  for (const client of CLIENTS) {
    // An interrupted check leaves its scratch file behind (.gitignore names it);
    // it goes before a new one is written.
    rmSync(join(frontend, client.scratch), { force: true });
    try {
      await generate(options(client.scratch, client.filters), frontend, THROW);
      const generated = readFileSync(join(frontend, client.scratch), 'utf8');
      let committed = '';
      try { committed = readFileSync(join(frontend, client.file), 'utf8'); } catch { /* reported below */ }
      if (generated !== committed) {
        console.error(`${client.file} is not what the OpenAPI document generates: run \`npm --prefix frontend run api:client\` and commit the result.`);
        stale += 1;
      }
    } finally {
      rmSync(join(frontend, client.scratch), { force: true });
    }
  }
  return stale === 0 ? 0 : 1;
}

process.exit(await main());

#!/usr/bin/env node
/**
 * Generate the web's API client from the OpenAPI document (ADR-0073).
 *
 *   node scripts/api-client.mjs           write src/api/client.generated.ts
 *   node scripts/api-client.mjs --check   exit 1 when the committed file is not what the document generates
 *
 * Orval renders one plain `fetch` function per operation, with its path and
 * query parameters, body and answer typed from the document, and a URL builder
 * beside it; every function calls `apiFetch` (`src/api/fetchUtils.ts`), the one
 * place the token is handled. No TanStack Query hooks are generated:
 * `queryKeys.ts` owns the keys.
 *
 * Orval writes the mutator's import relative to the file it generates, so the
 * check generates beside the committed file, under a scratch name, compares,
 * and removes it.
 */
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from 'orval';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLIENT = 'src/api/client.generated.ts';
const SCRATCH = 'src/api/client.check.generated.ts';

/** Orval logs a failed generation and resolves; this makes it fail the command. */
const THROW = { throwOnError: true };

function options(target) {
  return {
    input: { target: '../packages/shared/src/openapi.generated.json' },
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
    await generate(options(CLIENT), frontend, THROW);
    return 0;
  }
  // An interrupted check leaves its scratch file behind (.gitignore names it);
  // it goes before a new one is written.
  rmSync(join(frontend, SCRATCH), { force: true });
  try {
    await generate(options(SCRATCH), frontend, THROW);
    const generated = readFileSync(join(frontend, SCRATCH), 'utf8');
    let committed = '';
    try { committed = readFileSync(join(frontend, CLIENT), 'utf8'); } catch { /* reported below */ }
    if (generated === committed) return 0;
    console.error(`${CLIENT} is not what the OpenAPI document generates: run \`npm --prefix frontend run api:client\` and commit the result.`);
    return 1;
  } finally {
    rmSync(join(frontend, SCRATCH), { force: true });
  }
}

process.exit(await main());

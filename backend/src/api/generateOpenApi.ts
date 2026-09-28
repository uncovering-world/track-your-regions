/**
 * Write the OpenAPI 3.1 document (ADR-0072).
 *
 *   npm --prefix backend run api:openapi     write packages/shared/src/openapi.generated.json
 *
 * The routes come from `routes/mounts.ts`, the response components from
 * `responses/` (`responseModules.ts`), and the request bodies' names from
 * what the modules in `types/` export. `openApi.test.ts` renders the same way and
 * fails while the committed document differs.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import { MOUNTS } from '../routes/mounts.js';
import { importResponseModules, responseSchemasOf, type ResponseModule } from './responseModules.js';
import { openApiDocumentOf } from './openApi.js';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = join(BACKEND, 'src', 'types');

/**
 * Every request schema the modules in `types/` export, by export name. The
 * barrel re-exports most of them, so one schema can arrive twice under one
 * name and counts once; one name holding two different schemas is refused,
 * since only one of them could be the component.
 */
export function requestSchemasOf(modules: readonly ResponseModule[]): Array<[string, z.ZodType]> {
  const byName = new Map<string, [string, z.ZodType]>();
  for (const [file, exports] of modules) {
    for (const [name, value] of Object.entries(exports)) {
      if (!(value instanceof z.ZodType)) continue;
      const earlier = byName.get(name);
      if (earlier && earlier[1] !== value) throw new Error(`${name} is two different schemas, in types/${earlier[0]} and types/${file}`);
      if (!earlier) byName.set(name, [file, value]);
    }
  }
  return [...byName.entries()].map(([name, [, schema]]) => [name, schema]);
}

async function importTypeModules(): Promise<ResponseModule[]> {
  const files = readdirSync(TYPES)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort((a, b) => a.localeCompare(b));
  const modules: ResponseModule[] = [];
  for (const file of files) {
    modules.push([file, (await import(pathToFileURL(join(TYPES, file)).href)) as Record<string, unknown>]);
  }
  return modules;
}

/**
 * Where the document is committed: where `@tyr/shared/openapi` resolves, so the
 * generator and the container lane, which mounts that directory, agree on the
 * file.
 */
const OPENAPI_FILE = fileURLToPath(import.meta.resolve('@tyr/shared/openapi'));

/** The text of `openapi.generated.json`, from the declarations as they stand. */
export async function renderOpenApi(): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the backend's own package.json
  const { version } = JSON.parse(readFileSync(join(BACKEND, 'package.json'), 'utf8')) as { version: string };
  const document = openApiDocumentOf(MOUNTS, {
    responses: responseSchemasOf(await importResponseModules()),
    requests: requestSchemasOf(await importTypeModules()),
  }, version);
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function main(): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path inside the repository
  writeFileSync(OPENAPI_FILE, await renderOpenApi());
  console.log(`Wrote ${OPENAPI_FILE}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

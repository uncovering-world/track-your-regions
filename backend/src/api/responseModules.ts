/**
 * The response schemas, by the names they are exported under (ADR-0066).
 *
 * Every module in `responses/` is imported, in sorted order, and every schema
 * it exports is registered under its export name for the OpenAPI document
 * (`generateOpenApi.ts`, ADR-0072), which the web's client is generated from
 * (ADR-0073). So a schema a route answers with is a type of that name on every
 * client; one no route references is pruned from the document.
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod/v4';

const RESPONSES = join(dirname(fileURLToPath(import.meta.url)), 'responses');

/** A response module as the generator sees it: its file name and its runtime exports. */
export type ResponseModule = readonly [file: string, exports: Readonly<Record<string, unknown>>];

/**
 * Every exported response schema, by the name it is exported under.
 *
 * Three cases are refused rather than resolved quietly:
 * - two modules exporting one name;
 * - one schema exported under two names, since the registry would keep the
 *   last and a type would vanish;
 * - an export that is not a schema at all.
 */
export function responseSchemasOf(modules: readonly ResponseModule[]): Array<[string, z.ZodType]> {
  const byName = new Map<string, string>();
  const bySchema = new Map<z.ZodType, string>();
  const schemas: Array<[string, z.ZodType]> = [];
  for (const [file, exports] of modules) {
    for (const [name, value] of Object.entries(exports)) {
      if (!(value instanceof z.ZodType)) {
        throw new Error(`responses/${file} exports ${name}, which is not a Zod schema; a response module exports schemas only`);
      }
      const earlierFile = byName.get(name);
      if (earlierFile) throw new Error(`${name} is exported by both responses/${earlierFile} and responses/${file}`);
      const earlierName = bySchema.get(value);
      if (earlierName) throw new Error(`responses/${file} exports one schema as both ${earlierName} and ${name}`);
      byName.set(name, file);
      bySchema.set(value, name);
      schemas.push([name, value]);
    }
  }
  return schemas;
}

export async function importResponseModules(): Promise<ResponseModule[]> {
  const files = readdirSync(RESPONSES)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort((a, b) => a.localeCompare(b));
  const modules: ResponseModule[] = [];
  for (const file of files) {
    modules.push([file, (await import(pathToFileURL(join(RESPONSES, file)).href)) as Record<string, unknown>]);
  }
  return modules;
}

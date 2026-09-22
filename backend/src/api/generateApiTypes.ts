/**
 * Render the response schemas into the web's types (ADR-0066).
 *
 *   npm --prefix backend run api:types     write packages/shared/src/api.generated.ts
 *
 * Every module in `responses/` is imported, in sorted order, and every schema
 * it exports is registered under its export name. `z.toJSONSchema` turns the
 * registry into JSON Schema 2020-12, with a `$ref` wherever one exported schema
 * holds another, and `apiTypesRender.ts` renders that. `input` mode is what
 * makes a plain `z.object` visible: output mode would give it the
 * `additionalProperties: false` of a strict one, although its parse strips an
 * undeclared key and passes.
 *
 * The file is written where `@tyr/shared/api` resolves, so the generator and
 * every consumer agree on which file that is. `apiTypes.test.ts` renders the
 * same way and fails while the committed file differs.
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import { REF_PREFIX, renderApiTypes, type JsonSchema } from './apiTypesRender.js';

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

async function importResponseModules(): Promise<ResponseModule[]> {
  const files = readdirSync(RESPONSES)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort((a, b) => a.localeCompare(b));
  const modules: ResponseModule[] = [];
  for (const file of files) {
    modules.push([file, (await import(pathToFileURL(join(RESPONSES, file)).href)) as Record<string, unknown>]);
  }
  return modules;
}

/** The text of `api.generated.ts`, from the schemas as they stand. */
export async function renderResponseTypes(): Promise<string> {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of responseSchemasOf(await importResponseModules())) registry.add(schema, { id: name });
  const { schemas } = z.toJSONSchema(registry, { io: 'input', uri: (id) => `${REF_PREFIX}${id}` });
  return renderApiTypes(schemas as Record<string, JsonSchema>);
}

async function main(): Promise<void> {
  const output = fileURLToPath(import.meta.resolve('@tyr/shared/api'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- where the package's own export resolves
  writeFileSync(output, await renderResponseTypes());
  console.log(`Wrote ${output}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { codeHash, importsOf } from './codeGraph.js';

describe('the modules a source imports at run time (#2424)', () => {
  it('reads every relative import and re-export, across lines, and leaves out the type-only ones and the packages', () => {
    const source = [
      "import { pool } from '../../db/index.js';",
      'import {',
      '  gatherPlaces,',
      '  type GatheredPlaces,',
      "} from './gather.js';",
      "import type { SurroundingsPool } from './surroundingsPool.js';",
      "export type { Row } from './rows.js';",
      "export { keepPlaces } from './keptGather.js';",
      "export * from './codeGraph.js';",
      "import './sideEffect.js';",
      "const later = await import('./later.js');",
      "import { createHash } from 'node:crypto';",
      "import { typeValues } from '@tyr/shared/placeTypes';",
    ].join('\n');
    expect(importsOf(source).sort()).toEqual([
      '../../db/index.js', './codeGraph.js', './gather.js', './keptGather.js', './later.js', './sideEffect.js',
      '@tyr/shared/placeTypes',
    ]);
  });

  it('reads no import a comment shows, and still reads one after a string that holds a comment marker', () => {
    const source = [
      "/** `… from './x.js'`: an import or a re-export. */",
      '/**',
      " * `import './y.js'` and `import('./z.js')`, the same.",
      ' */',
      "// import { old } from './old.js';",
      '/*',
      "  export * from './block.js';",
      '*/',
      "const host = 'https://example.org/*'; // not a comment opener inside the string",
      "const QUOTE = /['\"]/g;",
      "import { kept } from './kept.js'; // and a trailing note from './note.js'",
    ].join('\n');
    expect(importsOf(source)).toEqual(['./kept.js']);
  });
});

describe('the hash of the code a step is made by (#2424)', () => {
  let dir: string;
  const write = (name: string, source: string) => writeFile(join(dir, name), source);
  const hashOfEntry = async () => (await codeHash([pathToFileURL(join(dir, 'entry.js'))])).hash;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'code-graph-'));
    await write('entry.ts', "import { b } from './b.js';\nimport type { C } from './c.js';\nexport const a = b;\n");
    await write('b.ts', 'export const b = 1;\n');
    await write('c.ts', 'export type C = number;\n');
    await write('elsewhere.ts', 'export const d = 2;\n');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads the entry and every module it imports, by the TypeScript file its .js name stands for', async () => {
    expect((await codeHash([pathToFileURL(join(dir, 'entry.js'))])).files).toHaveLength(2);
  });

  it('changes when a module the entry imports changes', async () => {
    const before = await hashOfEntry();
    await write('b.ts', 'export const b = 2;\n');
    expect(await hashOfEntry()).not.toBe(before);
  });

  it('stays when only a module it imports for a type, or one it never imports, changes', async () => {
    const before = await hashOfEntry();
    await write('c.ts', 'export type C = string;\n');
    await write('elsewhere.ts', 'export const d = 3;\n');
    expect(await hashOfEntry()).toBe(before);
  });

  it('refuses a module it cannot find, rather than leaving it out of the hash', async () => {
    await write('b.ts', "export { e } from './gone.js';\n");
    await expect(hashOfEntry()).rejects.toThrow(/imports \.\/gone\.js/);
  });

  it('reads the entry by its .js name where no .ts stands beside it, as in a compiled backend', async () => {
    await rm(join(dir, 'b.ts'));
    await write('b.js', 'export const b = 1;\n');
    expect((await codeHash([pathToFileURL(join(dir, 'entry.js'))])).files).toHaveLength(2);
  });
});

describe("the code key of the place pass's shared steps (#2424)", () => {
  it("follows a kind's type vocabulary into @tyr/shared", async () => {
    const { files } = await codeHash([new URL('../squares/kind.js', import.meta.url)]);
    expect(files).toContain('services/sync/squares/classes.ts');
    expect(files).toContain('../../packages/shared/src/placeTypes.ts');
  });
});


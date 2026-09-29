/**
 * The lint rule that keeps services/ below controllers/ (#1130).
 *
 * No module under services/ imports from controllers/ today, so a pattern
 * that matches nothing and one that works look identical to CI. Both
 * directions are asserted against the repo's own `eslint.config.mjs` rather
 * than a copy of SERVICE_LAYER_IMPORTS, which would agree with itself while
 * the gate let anything through.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/** What the import rule says about one snippet linted as `filePath`. */
async function lint(code: string, filePath = 'src/services/lint-fixture.ts'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

describe('services/ reaching up into controllers/ fails the lint', () => {
  // ESLint's first run in a worker loads the whole config and its plugins,
  // which costs more than a test's default 5s under a full parallel suite.
  beforeAll(async () => {
    await lint('export {};');
  }, 60000);

  it.each([
    ['a named import', "import { x } from '../controllers/admin/y.js';\nexport { x };\n", undefined],
    ['a type import', "import type { X } from '../controllers/admin/y.js';\nexport type { X };\n", undefined],
    ['a re-export', "export { x } from '../controllers/admin/y.js';\n", undefined],
    ['a star re-export', "export * from '../controllers/admin/y.js';\n", undefined],
    ['an import from deeper down', "import { x } from '../../controllers/admin/y.js';\nexport { x };\n",
      'src/services/worldViewImport/lint-fixture.ts'],
  ])('%s', async (_name, code, filePath) => {
    const messages = await lint(code, filePath);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/services\/ sits below controllers\//);
  });

  it('a value import of OpenCV', async () => {
    const messages = await lint("import cv from '@techstark/opencv-js';\nexport { cv };\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/OpenCV is loaded once/);
  });
});

describe('what the layering allows is left alone', () => {
  it.each([
    ['the same import outside services/', "import { x } from '../controllers/admin/y.js';\nexport { x };\n",
      'src/routes/lint-fixture.ts'],
    ['a controller importing services/', "import { x } from '../../services/sync/y.js';\nexport { x };\n",
      'src/controllers/admin/lint-fixture.ts'],
    ['services/ importing services/ and db/', "import { x } from './sync/y.js';\nimport { pool } from '../db/index.js';\nexport { x, pool };\n",
      undefined],
    ['a type import of OpenCV', "import type { Mat } from '@techstark/opencv-js';\nexport type { Mat };\n", undefined],
  ])('%s', async (_name, code, filePath) => {
    expect(await lint(code, filePath)).toEqual([]);
  });
});

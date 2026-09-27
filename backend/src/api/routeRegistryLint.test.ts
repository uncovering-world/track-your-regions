/**
 * The lint rule that keeps every route declared (ADR-0071, #793).
 *
 * No route in `backend/src` is written by hand, so a selector that reports
 * nothing and one that works look identical to CI. Both directions are
 * asserted against the repo's own `eslint.config.mjs` rather than a copy of
 * the selector, which would agree with itself while the gate let anything
 * through.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

const OWN_ROUTE = /Declare the route with defineRoute/;

/** What the route rule says about one snippet, if anything. */
async function lint(statement: string): Promise<string[]> {
  const code = 'declare const router: any;\ndeclare const app: any;\ndeclare const adminRouter: any;\ndeclare const Router: any;\n'
    + `declare const cache: Map<string, number>;\ndeclare const handler: any;\nfunction f() { ${statement} }\n`;
  const [result] = await eslint.lintText(code, { filePath: 'src/lint-fixture.ts' });
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-syntax' && OWN_ROUTE.test(message.message))
    .map((message) => message.message);
}

describe('a route added by hand fails the lint', () => {
  // ESLint's first run in a worker loads the whole config and its plugins,
  // which costs more than a test's default 5s under a full parallel suite.
  beforeAll(async () => {
    await lint('handler();');
  }, 60000);

  it.each([
    ['router.get', "router.get('/x', handler);"],
    ['router.post', "router.post('/x', handler);"],
    ['router.delete', "router.delete('/x/:id', handler);"],
    ['app.put', "app.put('/x', handler);"],
    ['a router named after its area', "adminRouter.patch('/x', handler);"],
    ['router.all', "router.all('/x', handler);"],
    ['a router named anything', "const routes = Router(); routes.get('/x', handler);"],
    ['a path built from a template', "router.get(`/x/${1}`, handler);"],
    ['a chain on route()', "router.route('/x').get(handler);"],
  ])('%s', async (_name, statement) => {
    expect(await lint(statement)).toHaveLength(1);
  });
});

describe('what is not a route is left alone', () => {
  it.each([
    ['a Map read', "cache.get('x');"],
    ['a read with a fallback', "cache.get('x', 1);"],
    ['mounting a router', "router.use('/api/x', handler);"],
    ['the registry adding a declared route', "router[handler.method](handler.path, handler);"],
  ])('%s', async (_name, statement) => {
    expect(await lint(statement)).toEqual([]);
  });
});

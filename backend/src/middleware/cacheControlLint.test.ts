/**
 * The lint rule that keeps `private` on every cache header — #710.
 *
 * Same reason `pooledTransactionLint.test.ts` gives for its own selector, and
 * more pressing here: this rule is the whole of the value check, and every
 * `Cache-Control` in `backend/src` already says `private`, so a selector that
 * reports nothing and a selector that works look identical to CI. Both
 * directions are asserted, against the repo's own `eslint.config.mjs` rather
 * than a copy of the pattern — a test that restated the selector would agree
 * with itself while the gate let anything through.
 *
 * The rows worth having are the ones a reader has to derive rather than see:
 * that a header name written in backticks is the same header (the shape that
 * walked past the first version of this rule), that a value the selector
 * cannot read is reported rather than assumed innocent, that the object-entry
 * form fires on what `writeHead` and `res.set({…})` take — through a chain and
 * whatever the response is named — and that an outbound `fetch`'s request
 * headers are none of this rule's business.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/** What the cache rule says about one snippet, if anything. */
async function reported(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/lint-fixture.ts' });
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message);
}

const HEADER = 'declare const res: any;\ndeclare const response: any;\n'
  + 'declare const computed: string;\ndeclare const x: string;\ndeclare const u: string;\n';

async function lint(statement: string): Promise<string[]> {
  return reported(`${HEADER}async function f() { ${statement} }\n`);
}

describe('a cache header that drops private fails the lint', () => {
  // ESLint's first run in a worker loads the whole config and its plugins,
  // which costs more than a test's default 5s under a full parallel suite —
  // the first row would time out where the rest pass in milliseconds. Pay it
  // once, with a timeout of its own, so a failure here means the rule.
  beforeAll(async () => {
    await lint("res.setHeader('Content-Type', 'text/plain');");
  }, 60000);

  it.each([
    ['a bare no-cache', "res.setHeader('Cache-Control', 'no-cache');"],
    ['no-store without private', "res.setHeader('Cache-Control', 'no-store');"],
    ['a public value', "res.setHeader('Cache-Control', 'public, max-age=60');"],
    ['the header name in backticks', "res.setHeader(`Cache-Control`, 'no-cache');"],
    ['a name the selector cannot read', "res.setHeader('Cache-Control', computed);"],
    ['a template that is all hole', 'res.setHeader(`Cache-Control`, `${x}`);'],
    ['res.set with two arguments', "res.set('Cache-Control', 'no-cache');"],
    ['the writeHead object shape', "res.writeHead(200, { 'Cache-Control': 'no-cache' });"],
    ['an object entry behind a chain', "res.status(200).set({ 'Cache-Control': 'no-cache' });"],
    ['a response parameter named otherwise', "response.writeHead(200, { 'Cache-Control': 'no-cache' });"],
  ])('reports %s', async (_name, statement) => {
    const messages = await lint(statement);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('private');
  });

  it.each([
    ['private, no-store', "res.setHeader('Cache-Control', 'private, no-store');"],
    ['private, no-cache', "res.setHeader('Cache-Control', 'private, no-cache');"],
    ['private with a max-age', "res.setHeader('Cache-Control', 'private, max-age=300');"],
    ['a template that says private itself', 'res.setHeader(`Cache-Control`, `private, no-cache`);'],
    // The literal part puts `private` in the header whatever the hole is.
    ['a template whose literal part says it', 'res.setHeader(`Cache-Control`, `private, ${x}`);'],
    ['the object entry saying private', "res.set({ 'Cache-Control': 'private, no-cache' });"],
    ['another header entirely', "res.setHeader('Content-Type', 'text/event-stream');"],
    // A request header, which this rule has nothing to say about.
    ['an outbound fetch header', "await fetch(u, { headers: { 'Cache-Control': 'no-cache' } });"],
  ])('leaves %s alone', async (_name, statement) => {
    expect(await lint(statement)).toEqual([]);
  });
});

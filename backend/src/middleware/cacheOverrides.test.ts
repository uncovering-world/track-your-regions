import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The half of the cache-header rule a linter cannot state.
 *
 * What a `Cache-Control` written in this codebase must *say* is enforced where
 * it is written: `no-restricted-syntax` in `backend/eslint.config.mjs` fails
 * any value that drops `private`, and any it cannot find `private` in at all —
 * a name, a call, a template that is all holes — since none of those can be
 * checked there; and the one deliberate exception — the admin image proxy's `public` —
 * carries its reason as a suppression on its own line. That rule is the right
 * shape for a linter: it fires on code that exists.
 *
 * A linter cannot fire on code that stopped existing, and that is the failure
 * this file is for. `requireAuth` marks every response it lets through
 * `private, no-store` (#710), which three classes of response cannot rely on —
 * for different reasons, and none of them because the middleware is wrong
 * about the rest:
 *
 * - the reads whose body is public reference data (GADM's boundaries at full
 *   resolution, Wikimedia's geoshape) sit behind the middleware and need a
 *   different value, so `markPublicReferenceBody` replaces it afterwards —
 *   `setHeader` replaces, which is what makes that work;
 * - the streams `EventSource` opens sit behind it too and must replace the
 *   header, which is how `private` was lost until #710; `markStreamBody` puts
 *   it back, and for a caller whose token is a query parameter it is the whole
 *   of the guarantee;
 * - the responses that hand back an access token mostly sit *ahead* of it —
 *   four of the five run before `requireAuth` reaches them — and need the same
 *   value it would have written, plus the `Pragma` RFC 6749 § 5.1 asks for, so
 *   `markTokenResponse` states it where the middleware cannot.
 *
 * What they share is not a value but a call: something has to be there, and
 * nothing but this file notices when it is not.
 *
 * Drop one of those calls, or add a handler without it, and every test in this
 * repository still passes while the response quietly ships something else. So
 * the calls are counted, and the token responses are found in the source and
 * paired with their mark rather than counted into a number here — a number
 * catches a call that goes missing and not a handler added without one.
 *
 * It reads the source as a syntax tree rather than as text: a regex over these
 * files matches the header named in a comment or a string, misses a call split
 * across lines, and cannot tell a literal from an expression.
 */

/**
 * The files that write the value inline, and how many times. The lint rule
 * says what a value must be; nothing but this says one is still there. Losing
 * `adminRoutes.ts`'s `public, max-age=86400` is the case that costs something
 * real — the image proxy would fall back to `no-store` and re-proxy the same
 * Commons picture on every render, against Wikimedia's politeness rules, while
 * three documents went on describing a 24-hour value.
 */
const MUST_WRITE: Array<{ file: string; writes: number }> = [
  // markPublicReferenceBody, markTokenResponse and markStreamBody.
  { file: 'middleware/cacheHeaders.ts', writes: 3 },
  // requireAuth and optionalAuth, the two that carry the rule itself.
  { file: 'middleware/auth.ts', writes: 2 },
  // The two admin image values and the proxy's public one.
  { file: 'routes/adminRoutes.ts', writes: 3 },
];

/**
 * The handlers that say something other than `no-store` through a helper, and
 * how many in each file must say it: the four public-reference reads under
 * `markPublicReferenceBody`, and the three streams under `markStreamBody`,
 * which are marked for the opposite reason — not because they need a different
 * value but because replacing the header is how `private` was lost.
 *
 * Counted per handler rather than per file, which is what the count buys where
 * a file holds several: one of the three geometry reads losing the call would
 * otherwise leave the other two to carry the file. The stream files hold one
 * handler each, so for them the two counts agree.
 */
const MUST_CALL_HELPER: Array<{ file: string; helper: string; handlers: number }> = [
  { file: 'controllers/division/divisionGeometry.ts', helper: 'markPublicReferenceBody', handlers: 3 },
  { file: 'controllers/admin/wvImportLifecycleController.ts', helper: 'markPublicReferenceBody', handlers: 1 },
  // The three streams, which say the same thing for the same reason and said
  // it in eight identical comment lines apiece until the helper took it.
  { file: 'controllers/worldView/geometryComputeSSE.ts', helper: 'markStreamBody', handlers: 1 },
  { file: 'controllers/admin/wvImportMatchPipeline.ts', helper: 'markStreamBody', handlers: 1 },
  { file: 'controllers/admin/wvImportCoverageController.ts', helper: 'markStreamBody', handlers: 1 },
];

function sourceFiles(): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the root is built from this module's own URL and a literal
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'));
}

function parse(name: string): ts.SourceFile {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
  const text = readFileSync(join(SRC, name), 'utf8');
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
}

function eachNode(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => eachNode(child, visit));
}

/** Calls to `name(res)` in a file. */
function helperCalls(source: ts.SourceFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  eachNode(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== name) return;
    const [arg] = node.arguments;
    if (arg !== undefined && ts.isIdentifier(arg) && arg.text === 'res') out.push(node);
  });
  return out;
}

/**
 * Does this response body name an access token among its fields?
 *
 * A key is an identifier, a quoted string or a computed expression, and both
 * of the first two are written in this codebase; reading only identifiers
 * would let `{ 'accessToken': token }` past. A computed key, and a spread of
 * an object assembled elsewhere, are out of reach of any syntactic check —
 * which is the boundary of what this file can promise.
 */
function namesAccessToken(arg: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some((p) => {
    if (ts.isShorthandPropertyAssignment(p)) return p.name.text === 'accessToken';
    if (p.name === undefined) return false;
    if (!ts.isIdentifier(p.name) && !ts.isStringLiteralLike(p.name)) return false;
    return p.name.text === 'accessToken';
  });
}

/** The nearest enclosing function, which is the scope a mark has to share. */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !ts.isFunctionLike(current)) current = current.parent;
  return current;
}

// The same set the lint selector keys on, `writeHead` included: it takes the
// header as an object entry rather than as two arguments, and is the one
// method here that never takes the two-argument form.
const SETTERS = new Set(['setHeader', 'set', 'header', 'append', 'writeHead']);

/** A string literal's text, or null where the value only exists at runtime. */
function literalText(value: ts.Expression | undefined): string | null {
  if (value === undefined) return null;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  return null;
}

function isCacheControl(arg: ts.Expression | undefined): boolean {
  return literalText(arg)?.toLowerCase() === 'cache-control';
}

/**
 * How many times a file writes the header, in either shape a setter takes —
 * the two-argument call, and the object one `writeHead` and `res.set({…})`
 * take. Both are read off a *setter call*, which is the scoping the lint
 * selector settled on: a `Cache-Control` in an outbound `fetch(url, { headers
 * })` is a request directive, and counting it here would fail a file for a
 * write nobody removed. `routes/adminRoutes.ts` is where that would bite —
 * the image proxy already makes such a fetch a few lines above its own header.
 */
function writeCount(name: string): number {
  const source = parse(name);
  let count = 0;
  eachNode(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
    if (method === null || !SETTERS.has(method)) return;

    if (isCacheControl(node.arguments[0])) count += 1;

    for (const arg of node.arguments) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      count += arg.properties.filter((prop) => ts.isPropertyAssignment(prop)
        && ts.isStringLiteralLike(prop.name)
        && prop.name.text.toLowerCase() === 'cache-control').length;
    }
  });
  return count;
}

describe('the overrides that answer with something other than no-store', () => {
  it.each(MUST_WRITE.map((m) => [m.file, m.writes] as const))('%s writes the header %i time(s)', (file, writes) => {
    expect(
      writeCount(file),
      `${file} writes Cache-Control a different number of times than the ${writes} recorded here. A lost write ships whatever ran before it — the middleware's value, or Express's defaults — for a response that was answering with something else on purpose; a new one needs its own reason and this count raised.`,
    ).toBe(writes);
  });

  it.each(MUST_CALL_HELPER.map((h) => [h.file, h.helper, h.handlers] as const))(
    '%s marks %i handler(s) through %s',
    (file, helper, handlers) => {
      // Distinct enclosing functions, not calls: three in one handler and
      // none in the other two is the shape a plain count would pass, and
      // exactly the regression this is here to catch.
      const source = parse(file);
      const calls = new Set(helperCalls(source, helper).map((c) => enclosingFunction(c))).size;
      expect(
        calls,
        `${file} marks ${calls} of its handlers with ${helper}, not ${handlers}: a handler that lost it answers under the middleware's no-store, shipping a body that is the same for every caller on every open. A handler added here needs the call and this count raised.`,
      ).toBe(handlers);
    },
  );

  it('every response handing back an access token is marked', () => {
    // Every file, not `authRoutes.ts` alone: a token handed back from
    // somewhere else is the case this would otherwise be blind to, and the one
    // where nobody would think to look. `markTokenResponse` is exported from
    // `middleware/cacheHeaders.ts`, so a payload anywhere can be marked — and
    // one that is not fails here, wherever it lives.
    const unmarked: string[] = [];
    let payloads = 0;

    for (const name of sourceFiles()) {
      const source = parse(name);
      const marks = helperCalls(source, 'markTokenResponse');

      eachNode(source, (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
        if (node.expression.name.text !== 'json') return;
        const [arg] = node.arguments;
        if (arg === undefined || !namesAccessToken(arg)) return;

        payloads += 1;
        // The mark has to run before this response and in the same handler: a
        // call elsewhere in the file says nothing about this one.
        const scope = enclosingFunction(node);
        const marked = marks.some((m) => m.end <= node.getStart(source) && enclosingFunction(m) === scope);
        if (!marked) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          unmarked.push(`${name}:${line + 1}`);
        }
      });
    }

    expect(
      payloads,
      'no token-returning response found anywhere under backend/src — this scan is reading the wrong shape and would pass on anything',
    ).toBeGreaterThan(0);
    expect(
      unmarked,
      'a response handing back an accessToken with no markTokenResponse ahead of it in the same handler answers with Express\'s defaults; RFC 6749 § 5.1 asks a token response for Cache-Control: no-store',
    ).toEqual([]);
  });
});

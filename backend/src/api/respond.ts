/**
 * Send a success body, held to the schema that declares it (ADR-0066).
 *
 * An endpoint's answer is declared once, as a strict Zod schema in
 * `responses/`, and the web's types are generated from those schemas. This is
 * where a handler meets its schema, in two ways:
 *
 * - **At compile time**, the body is typed from the schema. A literal naming a
 *   key the schema lacks, a `Date` where the wire carries an ISO string, a value
 *   outside a vocabulary or a missing key fails `tsc`. `NoInfer` keeps the body
 *   from widening the schema's type to fit itself.
 * - **At run time, outside production**, the body is parsed strictly before it
 *   is sent. TypeScript checks an object literal's own keys and nothing else: a
 *   key that arrives by `...(cond ? { key } : {})`, a row passed through from an
 *   untyped query, a count the driver hands over as a string all compile. The
 *   parse refuses each of them, in the unit test, the smoke lane or the dev
 *   request that produced it.
 *
 * Production sends the body without parsing: every lane that exercises a
 * handler runs with the check, and the cost stays off the readers' requests.
 */

import type { Response } from 'express';
import type { z } from 'zod/v4';
import { isProductionMode } from '../config/validateEnv.js';

/**
 * Whether bodies are parsed before they are sent. Read on every call rather
 * than once, so a spec can switch it.
 *
 * `isProductionMode` treats an unset `NODE_ENV` as production, so a deployment
 * that forgot to set it does not start answering 500 over a shape. Vitest is
 * checked on its own because it only sets `NODE_ENV` where the shell left it
 * unset: both unit lanes must parse whatever the shell exports.
 */
function checksBodies(): boolean {
  return !isProductionMode(process.env.NODE_ENV) || process.env.VITEST === 'true';
}

/** The issues shown in the message; the rest are counted. */
const SHOWN_ISSUES = 10;

/** One issue as a parse reports it: where, and what kind. Never the value. */
interface ShapeIssue {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly keys?: readonly string[];
}

/**
 * A success body that does not match the schema declaring it.
 *
 * A 500: the request was fine and the server built the wrong answer. It is not
 * a `ZodError` on purpose, because the error handler answers a `ZodError` as
 * the client's validation failure.
 *
 * The message names the route by its pattern and never by the URL that
 * reached it, so neither an id nor a `?token=` query reaches a log. Each issue
 * gives its path, its code and, for keys the schema does not declare, their
 * names. Zod issues carry no input values.
 */
export class ResponseShapeError extends Error {
  readonly statusCode = 500;

  constructor(request: RequestLine | null, issues: readonly ShapeIssue[]) {
    const shown = issues.slice(0, SHOWN_ISSUES).map(describeIssue).join('; ');
    const more = issues.length > SHOWN_ISSUES ? `; and ${issues.length - SHOWN_ISSUES} more` : '';
    // A write answers after its transaction. The row changed even though the
    // answer did not go out, and the caller must not read the 500 as a refusal.
    const committed = request && request.method !== 'GET' && request.method !== 'HEAD'
      ? ' The write may already have committed.'
      : '';
    const what = request ? `The answer to ${request.method} ${request.route}` : 'This answer';
    super(`${what} does not match its schema: ${shown}${more}.${committed}`);
    this.name = 'ResponseShapeError';
  }
}

function describeIssue(issue: ShapeIssue): string {
  const where = issue.path.length === 0 ? '(the body)' : issue.path.map(String).join('.');
  const keys = issue.keys && issue.keys.length > 0 ? ` (${issue.keys.join(', ')})` : '';
  return `${where}: ${issue.code}${keys}`;
}

/** The request an answer belongs to, with its route as a pattern: `/api/experiences/:id/publish`. */
interface RequestLine {
  readonly method: string;
  readonly route: string;
}

/**
 * Null for a spec's mock response, which has no request.
 */
function requestLineOf(res: Response): RequestLine | null {
  const req = res.req as Response['req'] | undefined;
  if (!req) return null;
  const pattern = typeof req.route?.path === 'string' ? req.route.path : req.path;
  return { method: req.method, route: `${req.baseUrl}${pattern}` };
}

/**
 * Answer with `body`, after checking it against `schema` outside production. The
 * status is whatever the handler set, 200 unless it called `res.status()` first:
 * `respond(res.status(201), Schema, body)` for a create.
 *
 * An error answer does not go through here. Its body is `{ error }`, and the
 * route declarations of #793 are where error bodies get declared.
 */
export function respond<S extends z.ZodType>(res: Response, schema: S, body: NoInfer<z.output<S>>): void {
  checkShape(res, schema, body);
  res.json(body);
}

/**
 * Write one server-sent event, held to `schema` the way `respond()` holds a
 * body: typed at compile time, parsed outside production.
 *
 * A stream's headers are out before its first event, so a mismatch cannot turn
 * into a 500. It throws `ResponseShapeError` into the handler instead, whose own
 * catch ends the stream with an error event, and that error event goes through
 * here too.
 */
export function writeEvent<S extends z.ZodType>(res: Response, schema: S, event: NoInfer<z.output<S>>): void {
  checkShape(res, schema, event);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function checkShape(res: Response, schema: z.ZodType, value: unknown): void {
  if (!checksBodies()) return;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ResponseShapeError(requestLineOf(res), parsed.error.issues as readonly ShapeIssue[]);
  }
}

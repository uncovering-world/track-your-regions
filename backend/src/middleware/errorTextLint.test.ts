/**
 * The lint rule that keeps an error's own text out of an answer — #1021.
 *
 * A driver, an HTTP client or a model SDK writes table names, URLs and
 * internals into `err.message`, and a handler that answered with it sent them
 * to whoever asked. The rule reads the places an answer leaves by: a response
 * body, a redirect's address, a stream's event and a progress status. Both directions are asserted
 * against the repo's own `eslint.config.mjs`, so a selector that stops
 * reporting, or starts reporting a sentence, fails here.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/** What the error-text rule says about one snippet, if anything. */
async function reported(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/lint-fixture.ts' });
  return result.messages
    .filter(message => message.ruleId === 'no-restricted-syntax' && message.message.includes('error\'s own text'))
    .map(message => message.message);
}

const HEADER = [
  "import type { Response } from 'express';",
  'declare function sendEvent(event: object): void;',
  'declare function respond(res: Response, schema: unknown, body: object): void;',
  'declare const res: Response;',
  'declare const err: Error;',
  'declare const mapErr: Error;',
  'declare const id: number;',
  'declare const stream: { sendEvent(event: object): void };',
  'declare const progress: { status: string; statusMessage: string };',
  '',
].join('\n');

describe('an error\'s own text in an answer fails the lint', () => {
  // The first lint in a worker loads the whole config and its plugins; pay it
  // once with a timeout of its own, as the other config-loading specs do.
  beforeAll(async () => {
    await reported(`${HEADER}res.status(400).json({ error: 'x' });\n`);
  }, 60000);

  it.each([
    ['the instanceof idiom in a body', "res.status(500).json({ error: err instanceof Error ? err.message : 'x' });"],
    ['the message in a template', 'res.status(500).send({ error: `failed: ${err.message}` });'],
    ['the error as a string, through respond', 'respond(res, null, { note: String(err) });'],
    ['a stream event', "sendEvent({ type: 'error', message: err.message });"],
    ['a stream event sent as a method', "stream.sendEvent({ type: 'error', message: String(err) });"],
    ['a progress status message', 'progress.statusMessage = `Failed: ${err.message}`;'],
    ['a progress status', 'progress.status = `Error: ${String(err)}`;'],
    ['an error named for what failed, as a string', 'res.status(500).json({ error: String(mapErr) });'],
    ['an error interpolated whole', 'res.status(500).json({ error: `failed: ${err}` });'],
    ['an error turned into a string by its own method', 'res.status(500).json({ error: err.toString() });'],
    ['a redirect\'s address', 'res.redirect(`/auth/callback?error=${encodeURIComponent(err.message)}`);'],
  ])('reports %s', async (_name, statement) => {
    expect(await reported(`${HEADER}${statement}\n`)).toHaveLength(1);
  });

  it.each([
    ['a sentence', "res.status(500).json({ error: 'Reset match failed' });"],
    ['a sentence in a stream event', "sendEvent({ type: 'error', message: 'The coverage check failed.' });"],
    ['a sentence as a status', "progress.statusMessage = 'Import failed; the server log has the cause.';"],
    ['the error logged, which is where it goes', "console.error('Reset failed:', err.message, String(err));"],
    ['an ordinary value as a string', 'res.status(404).json({ error: `No region ${String(id)}` });'],
    ['an ordinary value interpolated', 'res.status(404).json({ error: `No region ${id}` });'],
    ['a redirect with a sentence', "res.redirect('/auth/callback?error=Authentication%20failed');"],
  ])('passes %s', async (_name, statement) => {
    expect(await reported(`${HEADER}${statement}\n`)).toEqual([]);
  });
});

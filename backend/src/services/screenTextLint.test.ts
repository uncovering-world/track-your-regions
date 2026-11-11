/**
 * The screen-text lint (#2433) over the backend's screen text, against the
 * repo's own `eslint.config.mjs`: a module whose text a screen shows is
 * measured whole, SQL and logs aside; a controller is measured at its answers
 * alone, so a prompt or an identifier beside them is not read as prose.
 */

import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../..', import.meta.url)) });

const HEADER = [
  'declare function badRequest(message: string): Error;',
  'declare const progress: { statusMessage: string };',
  'declare const pool: { query(sql: string): Promise<unknown> };',
  'declare const editions: number;',
  '',
].join('\n');

/** The screen-text messages for one snippet, linted as the file at `filePath`. */
async function reported(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${HEADER}${code}\n`, { filePath });
  return result.messages.filter(message => message.ruleId === 'screen-text/guideline').map(message => message.message);
}

const DUMPS = 'src/services/dumps/lint-fixture.ts';
const CONTROLLER = 'src/controllers/lint-fixture.ts';

describe('the backend\'s screen text', () => {
  beforeAll(async () => {
    await reported(DUMPS, 'export const x = 1;');
  }, 60000);

  it('refuses a refusal reason that names an ADR', async () => {
    const messages = await reported(DUMPS, "export const reason = 'the readership of its article does not say people go to see it (ADR-0175)';");
    expect(messages.join('\n')).toContain('rule 7');
  });

  it('refuses a dump description of two clauses joined by a semicolon', async () => {
    const messages = await reported(DUMPS, "export const about = 'The page table of every edition; a build reads it with the redirects.';");
    expect(messages.join('\n')).toContain('rule 2');
  });

  it('refuses a status that runs past 25 words', async () => {
    const messages = await reported(CONTROLLER, 'progress.statusMessage = "Region assignment read every place of every kind in every region of the '
      + 'world view and placed each of them in the smallest region whose outline holds its point today";');
    expect(messages.join('\n')).toContain('rule 1');
  });

  it('refuses an error answer with an aside in parentheses', async () => {
    const messages = await reported(CONTROLLER, "throw badRequest('description is required (at least two characters long)');");
    expect(messages.join('\n')).toContain('rule 2');
  });

  it('measures each branch of an answer chosen by a condition', async () => {
    const messages = await reported(CONTROLLER, "declare const missing: boolean;\nthrow badRequest(missing ? 'It is missing; enter a value' : 'It is invalid; enter a value');");
    expect(messages.filter(message => message.includes('rule 2'))).toHaveLength(2);
    const status = await reported(CONTROLLER, "declare const done: boolean;\nprogress.statusMessage = done ? 'Read; placed' : 'Reading';");
    expect(status.join('\n')).toContain('rule 2');
  });

  it('measures an answer whose words read like SQL', async () => {
    expect((await reported(CONTROLLER, "throw badRequest('Could not UPDATE this place; try again.');")).join('\n')).toContain('rule 2');
  });

  it('measures a text property sent to a reader, not to a log', async () => {
    const messages = await reported(CONTROLLER, "declare const res: { json(body: unknown): void };\nres.json({ message: 'Saved; reload the page.' });");
    expect(messages.join('\n')).toContain('rule 2');
  });

  it.each([
    ['a text property of a structured log line', CONTROLLER, "console.log({ message: 'Saved; reload the page.' });"],
    ['a text property of a structured log line, in a module measured whole', DUMPS, "console.log({ message: 'Saved; reload the page.' });"],
    ['a record composed into a log line', DUMPS, "console.log('Read in the order of ADR-0101: ' + editions);"],
    ['SQL with an issue in its comment', DUMPS,
      "export const run = () => pool.query(`SELECT id FROM dump_builds -- (#1234); one row a build\n WHERE status = 'running'`);"],
    ['a log line', DUMPS, "console.log('Read 12 kinds, 34 sources and 56 pages; it took 78 seconds (ADR-0101 says so)');"],
    ['a prompt in a controller', CONTROLLER,
      "export const prompt = 'You are matching regions; answer with the item that names the region (not its capital, not its country) and nothing more — ever.';"],
    ['a figure in the reader\'s locale', DUMPS, "export const summary = `kept ${editions.toLocaleString('en')} articles`;"],
  ])('lets through %s', async (_name, filePath, code) => {
    expect(await reported(filePath, code)).toEqual([]);
  });
});

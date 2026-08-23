/**
 * The lint rule that keeps a transaction on one connection — #532.
 *
 * The rule is the only part of that fix that has to keep working without
 * anybody thinking about it, and a selector is easy to break silently: tighten
 * it and it stops reporting, loosen it and it reports SQL that is not a
 * transaction at all. Both directions are asserted here, against the repo's own
 * `eslint.config.mjs` rather than a copy of the selector — a test that restated
 * the pattern would agree with itself while the gate let anything through.
 */

import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/** What the transaction rule says about one snippet, if anything. */
async function reported(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/lint-fixture.ts' });
  return result.messages
    .filter(message => message.ruleId === 'no-restricted-syntax')
    .map(message => message.message);
}

const HEADER = "import { pool } from './index.js';\n";

describe('a transaction opened through the pool fails the lint', () => {
  it.each([
    ["pool.query('BEGIN')", "await pool.query('BEGIN');"],
    ['a template literal', 'await pool.query(`BEGIN`);'],
    ['lower case and padding', "await pool.query('  begin ');"],
    ['START TRANSACTION, the synonym', "await pool.query('START TRANSACTION');"],
    ['ABORT, the other synonym', "await pool.query('ABORT');"],
    ['COMMIT on its own', "await pool.query('COMMIT');"],
    ['ROLLBACK on its own', "await pool.query('ROLLBACK');"],
    ['SAVEPOINT', "await pool.query('SAVEPOINT before_the_writes');"],
  ])('reports %s', async (_name, statement) => {
    const messages = await reported(`${HEADER}async function f() { ${statement} }\n`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('pool.connect()');
  });

  it.each([
    ['an ordinary read', "await pool.query('SELECT 1');"],
    ['the same verbs on a pinned client', 'await client.query(`BEGIN`);'],
    // The selector reads the opening quasi only. Interpolated CASE/END is
    // everywhere in this codebase's SQL, and its trailing quasi begins with the
    // word Postgres also accepts for COMMIT.
    ['CASE … END around an interpolation', 'await pool.query(`SELECT CASE WHEN a THEN ${x} END FROM t`);'],
    ['a transaction verb quoted inside a value', "await pool.query(`SELECT ${x}, 'ROLLBACK' AS word`);"],
    ['a word that merely starts the same way', 'await pool.query(`SELECT ${x} FROM begin_of_year`);'],
  ])('leaves %s alone', async (_name, statement) => {
    const code = `${HEADER}declare const client: { query: (s: string) => Promise<void> };\n`
      + `declare const x: number;\nasync function f() { ${statement} }\n`;
    expect(await reported(code)).toEqual([]);
  });
});

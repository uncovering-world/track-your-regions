/**
 * The label rules as SQL: the one part of the rule only this side spells.
 *
 * The fold and the store rule are `@tyr/shared/labels`, tested beside their
 * one declaration; this suite holds the storing side's spelling of the store
 * rule for Postgres to the JavaScript it copies. Until #789 it also compared
 * the two sides' function bodies as text, because each side declared its own.
 */

import { describe, it, expect } from 'vitest';
import { JS_WHITESPACE_CODE_POINTS, SQL_WHITESPACE_ALTERNATION } from './labelFold.js';

describe('the store rule spelled for SQL', () => {
  it('spells out for SQL exactly the code points the rule collapses beyond ASCII', () => {
    // Walk the plane rather than restate the list: `\s` is the rule, and the
    // list is what the assertion and migration 047 read it as. Any code point
    // the two disagree on is a name one side tidies and the other reports.
    const beyondAscii: number[] = [];
    for (let codePoint = 0x80; codePoint < 0x10000; codePoint++) {
      if (/\s/.test(String.fromCharCode(codePoint))) beyondAscii.push(codePoint);
    }
    expect([...JS_WHITESPACE_CODE_POINTS]).toEqual(beyondAscii);
    // As an alternation and never a bracket expression: under `en_US.utf8` a
    // bracket over these matched the en dash of *MAK – Museum of Applied Arts*.
    expect(SQL_WHITESPACE_ALTERNATION.startsWith('(\\s|')).toBe(true);
    expect(SQL_WHITESPACE_ALTERNATION.endsWith(')')).toBe(true);
    const branches = SQL_WHITESPACE_ALTERNATION.slice('(\\s|'.length, -1).split('|');
    expect(branches).toHaveLength(JS_WHITESPACE_CODE_POINTS.length);
    for (const branch of branches) expect(branch).toMatch(/^\\u[0-9a-f]{4}$/);
    expect(SQL_WHITESPACE_ALTERNATION).not.toContain('[');
  });
});

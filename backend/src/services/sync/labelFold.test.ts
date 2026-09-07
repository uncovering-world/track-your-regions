/**
 * One promise about the fold, and it is the one no single side can keep.
 *
 * No module crosses the front/back boundary (#527), so `foldLabel` is declared
 * twice — here, where the catalogue is written, and in
 * `frontend/src/utils/labelFold.ts`, where a curator's form asks the same
 * question before sending. A second declaration is a second answer to "is this
 * the same name" waiting to happen, and it fails in the direction nobody
 * notices: the form asks the narrower question, lets a repeat through, and the
 * endpoint refuses it as `{ error: 'Validation error' }` with the reason in a
 * `details` array no screen reads.
 *
 * So the two are pinned to each other, from this side, the way
 * `urlSafety.test.ts` pins the picture hosts and file types — by reading the
 * other side's source rather than by restating an expectation, which would
 * drift with the copy instead of catching it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  foldLabel, tidyLabel, JS_WHITESPACE_CODE_POINTS, SQL_WHITESPACE_ALTERNATION,
} from './labelFold.js';

const here = dirname(fileURLToPath(import.meta.url));
const frontendFold = join(here, '..', '..', '..', '..', 'frontend', 'src', 'utils', 'labelFold.ts');

/** The steps of one of the rules, with each side's own comments and indentation removed. */
function steps(source: string, rule: 'foldLabel' | 'tidyLabel'): string {
  const declaration = rule === 'foldLabel'
    ? /export function foldLabel\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
    : /export function tidyLabel\([^)]*\)[^{]*\{([\s\S]*?)\n\}/;
  const match = declaration.exec(source);
  expect(match, `the side declares ${rule} as an exported function`).not.toBeNull();
  return (match?.[1] ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('//'))
    .join('');
}

describe('the fold both sides use', () => {
  it('folds what a source varies in typesetting, and nothing further', () => {
    // Q2415079, *The Washington Family*, lists Edward Savage twice under two
    // QIDs — the case this was written for.
    expect(foldLabel('Edward  SAVAGE')).toBe(foldLabel('Edward Savage'));
    expect(foldLabel('Boma–Badingilo')).toBe(foldLabel('Boma-Badingilo'));
    // A name that differs by more than its punctuation is a real rename.
    expect(foldLabel('Giulio Romani')).not.toBe(foldLabel('Giulio Romano'));
  });

  it('is spelled the same way on the drawing side', () => {
    // If this fails, the two sides have come to disagree about whether two
    // spellings name one person — and the maker field would then accept what
    // the endpoint refuses, as a 400 with nothing on screen to explain it.
    expect(steps(readFileSync(frontendFold, 'utf8'), 'foldLabel'))
      .toBe(steps(readFileSync(join(here, 'labelFold.ts'), 'utf8'), 'foldLabel'));
  });
});

describe('the store rule both sides use', () => {
  it('collapses the whitespace a label service passes through, and nothing further', () => {
    // Q2390197 and Q2392901, the two works the catalogue held with runs (#835).
    expect(tidyLabel('St. John  on Patmos')).toBe('St. John on Patmos');
    expect(tidyLabel('Portrait of a Man (Self      Portrait?)')).toBe('Portrait of a Man (Self Portrait?)');
    expect(tidyLabel('  Louvre \n')).toBe('Louvre');
    // The no-break space four local names carry is whitespace to a person.
    expect(tidyLabel('Getbol,\u00a0Korean Tidal Flats')).toBe('Getbol, Korean Tidal Flats');
    // A store rule, not the fold: case and dashes are the source's spelling.
    expect(tidyLabel('Boma–Badingilo')).toBe('Boma–Badingilo');
    expect(tidyLabel('MAK – Museum of Applied Arts')).toBe('MAK – Museum of Applied Arts');
    expect(tidyLabel('Edward SAVAGE')).toBe('Edward SAVAGE');
    // Nothing but whitespace is nothing: the schemas then refuse it as empty.
    expect(tidyLabel('   ')).toBe('');
  });

  it('is spelled the same way on the drawing side', () => {
    // A form compares what was typed with what is stored by this rule before
    // deciding whether to send a name; a side that tidied differently would
    // claim a column over an edit nobody made.
    expect(steps(readFileSync(frontendFold, 'utf8'), 'tidyLabel'))
      .toBe(steps(readFileSync(join(here, 'labelFold.ts'), 'utf8'), 'tidyLabel'));
  });

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

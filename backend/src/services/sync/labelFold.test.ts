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
import { foldLabel } from './labelFold.js';

const here = dirname(fileURLToPath(import.meta.url));
const frontendFold = join(here, '..', '..', '..', '..', 'frontend', 'src', 'utils', 'labelFold.ts');

/** The steps of a `foldLabel`, with each side's own comments and indentation removed. */
function steps(source: string): string {
  const match = /export function foldLabel\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source);
  expect(match, 'the side declares foldLabel as an exported function').not.toBeNull();
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
    expect(steps(readFileSync(frontendFold, 'utf8')))
      .toBe(steps(readFileSync(join(here, 'labelFold.ts'), 'utf8')));
  });
});

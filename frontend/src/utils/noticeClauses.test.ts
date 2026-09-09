/**
 * Tests for the three clauses two batch notices share: each is a claim about
 * what happened, pinned on its own.
 */

import { describe, it, expect } from 'vitest';
import {
  namedWithRest, outOfScopeClause, refusalClauses, stalePlacementClause,
} from './noticeClauses';

describe('namedWithRest', () => {
  it('names the first five and counts the rest', () => {
    expect(namedWithRest(['a', 'b'])).toBe('a, b');
    expect(namedWithRest(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e and 2 more');
  });
});

describe('refusalClauses', () => {
  it('groups by reason, quoting it once for several objects and inline for one', () => {
    expect(refusalClauses([
      { name: 'A', error: 'stale' },
      { name: 'B', error: 'stale' },
      { name: 'C', error: 'deadlock' },
    ])).toEqual([
      '2 objects refused — A, B. Each: “stale”.',
      'C refused — deadlock.',
    ]);
  });
});

describe('stalePlacementClause', () => {
  it('names the object and its world views, with the verb the caller passes', () => {
    expect(stalePlacementClause([
      { name: 'Prado', worldViews: [{ id: 1, name: 'GADM' }, { id: 4, name: 'Continents' }] },
    ])).toEqual(['1 object published but could not be re-placed into its regions — Prado in '
      + 'GADM (world view 1), Continents (world view 4). Tell an admin.']);
    expect(stalePlacementClause([{ name: 'Prado', worldViews: undefined }], 'answered')[0])
      .toContain('1 object answered but could not be re-placed into its regions — Prado in its world views');
    expect(stalePlacementClause([])).toEqual([]);
  });
});

describe('outOfScopeClause', () => {
  it('says what was left alone, and nothing when nothing was', () => {
    expect(outOfScopeClause(0)).toEqual([]);
    expect(outOfScopeClause(3)).toEqual(['3 objects outside your scope, left alone.']);
  });
});

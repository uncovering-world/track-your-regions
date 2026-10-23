/**
 * The walk up a containment chain (#1819): the nearest place that passes, and
 * no answer when two pass at one level.
 */

import { describe, it, expect } from 'vitest';
import { nearest } from './nearest.js';

// The Ecstasy of Saint Teresa is in the Cornaro chapel, part of Santa Maria della Vittoria.
const ECSTASY = 'Q1333433';
const CORNARO_CHAPEL = 'Q588885';
const SANTA_MARIA = 'Q863593';

const chain = (edges: Record<string, string[]>) => (qid: string) => edges[qid] ?? [];

describe('nearest', () => {
  it('finds the nearest place that passes, however far up', () => {
    const parents = chain({ [ECSTASY]: [CORNARO_CHAPEL], [CORNARO_CHAPEL]: [SANTA_MARIA] });
    const isChurch = (qid: string) => qid === SANTA_MARIA;
    expect(nearest(ECSTASY, parents, isChurch, 3)).toEqual({ at: SANTA_MARIA, hops: 2 });
  });

  it('gives no answer when two places pass at one level', () => {
    const parents = chain({ Q1: ['Q2', 'Q3'] });
    expect(nearest('Q1', parents, () => true, 3)).toEqual({
      unresolved: 'two qualifying ancestors at hop 1: Q2, Q3', why: 'ambiguous',
    });
  });

  it('walks every route up, a level at a time', () => {
    const parents = chain({ Q1: ['Q2', 'Q3'], Q3: ['Q4'] });
    expect(nearest('Q1', parents, (qid) => qid === 'Q4', 3)).toEqual({ at: 'Q4', hops: 2 });
    expect(nearest('Q1', parents, () => false, 3)).toEqual({ unresolved: 'nothing up the chain qualifies', why: 'none' });
  });

  it('stops at the hop limit', () => {
    const parents = chain({ Q1: ['Q2'], Q2: ['Q3'], Q3: ['Q4'] });
    expect(nearest('Q1', parents, (qid) => qid === 'Q4', 2)).toEqual({ unresolved: 'nothing up the chain qualifies', why: 'none' });
  });
});

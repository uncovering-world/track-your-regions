/**
 * Tests for the words a batch shares with the cards (#852): every kind has
 * two answers, two of them a third, and a `waiting` row is counted by what
 * it holds.
 */

import { describe, it, expect } from 'vitest';
import {
  ANSWER_WORDS, answerVerb, countByKind, countLine, gatedKindsAlsoReached, kindsOf, lostOffered, lostOfferedFor,
  matchingKindCounts,
} from './answerWords';
import type { QueueRow } from '../queueRows';

function row(kind: QueueRow['kind'], subs: string[] = []): QueueRow {
  return {
    key: `${kind}:1`, kind, id: 1, name: 'x', category: 'c', question: '', askedAt: null,
    runId: null, specific: '', subs,
  };
}

describe('answer words', () => {
  it('gives every kind two answers, and Lost to the two verdict kinds only', () => {
    for (const words of Object.values(ANSWER_WORDS)) {
      expect(words.accept).toBeTruthy();
      expect(words.reject).toBeTruthy();
    }
    expect(Object.entries(ANSWER_WORDS).filter(([, w]) => w.lost).map(([k]) => k)).toEqual(['missing', 'withdrawn']);
  });

  it('counts a waiting row by the sub-kinds it holds, and every other row by its kind', () => {
    expect(kindsOf(row('waiting', ['held', 'contents']))).toEqual(['held', 'contents']);
    expect(kindsOf(row('waiting'))).toEqual(['arrival']);
    expect(kindsOf(row('conflicts'))).toEqual(['conflicts']);
    expect(countByKind([row('waiting', ['arrival']), row('waiting', ['arrival']), row('refused')]))
      .toEqual([{ kind: 'arrival', count: 2 }, { kind: 'refused', count: 1 }]);
    expect(countLine([row('waiting', ['arrival']), row('missing')])).toBe('1 arrival, 1 object gone from the source');
  });

  it('offers Lost only to a selection wholly of missing rows or wholly of withdrawn rows', () => {
    expect(lostOffered([row('missing'), row('missing')])).toBe(true);
    expect(lostOffered([row('withdrawn')])).toBe(true);
    expect(lostOffered([row('missing'), row('withdrawn')])).toBe(false);
    expect(lostOffered([])).toBe(false);
  });

  it('withholds Lost from an all-matching selection unless the kind filter pins the list to that kind', () => {
    const missing = [row('missing'), row('missing')];
    expect(lostOfferedFor(missing, false, [])).toBe(true);
    // The ticks are all missing, but the filters match arrivals and conflicts too.
    expect(lostOfferedFor(missing, true, [])).toBe(false);
    expect(lostOfferedFor(missing, true, ['missing'])).toBe(true);
    expect(lostOfferedFor(missing, true, ['missing', 'withdrawn'])).toBe(false);
    expect(lostOfferedFor([row('withdrawn')], true, ['withdrawn'])).toBe(true);
  });

  it('counts what the filters match by kind from the facets, honouring a kind filter', () => {
    const facets = { kind: [
      { kind: 'waiting', count: 1070 }, { kind: 'arrival', count: 1070 }, { kind: 'held', count: 0 },
      { kind: 'refused', count: 5 }, { kind: 'conflict', count: 3 },
    ] };
    expect(matchingKindCounts(facets, [])).toEqual([
      { kind: 'arrival', count: 1070 }, { kind: 'refused', count: 5 }, { kind: 'conflicts', count: 3 },
    ]);
    expect(matchingKindCounts(facets, ['refused'])).toEqual([{ kind: 'refused', count: 5 }]);
    expect(matchingKindCounts(undefined, [])).toEqual([]);
    // A facet word the table has no row for is dropped, not looked up.
    expect(matchingKindCounts({ kind: [{ kind: 'novel', count: 2 }, { kind: 'missing', count: 1 }] }, []))
      .toEqual([{ kind: 'missing', count: 1 }]);
  });

  it('names the gated sub-kind a kind filter reaches beside the one it lists', () => {
    // A held filter lists every row with an open held change, unread contents
    // included, and the answer reaches both; the reverse likewise; an arrival
    // is always alone, and a filter naming both reaches nothing unlisted.
    expect(gatedKindsAlsoReached(['held'])).toEqual(['contents']);
    expect(gatedKindsAlsoReached(['contents'])).toEqual(['held']);
    expect(gatedKindsAlsoReached(['held', 'contents'])).toEqual([]);
    expect(gatedKindsAlsoReached(['arrival'])).toEqual([]);
    expect(gatedKindsAlsoReached([])).toEqual([]);
  });

  it('names the verb a confirmation is pressed with', () => {
    expect(answerVerb('accept')).toBe('Accept');
    expect(answerVerb('reject')).toBe('Reject');
    expect(answerVerb('lost')).toBe('Record as lost');
  });
});

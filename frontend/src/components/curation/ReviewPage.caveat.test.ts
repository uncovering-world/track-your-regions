/**
 * Tests for the page's promise about what visitors can see.
 *
 * The sentence claims nothing on the review page has changed what a visitor sees, and two
 * of the queue's kinds are counter-examples — so the claim is only true with the caveat,
 * and only honest when the caveat names the kinds actually on screen. A curator who can
 * see a counter-example to a promise on the same screen learns to read past the promise.
 */

import { describe, it, expect } from 'vitest';
import { visibilityCaveat } from './ReviewPage';
import type { RowKind } from './queueRows';

function kinds(...list: RowKind[]): Set<RowKind> {
  return new Set(list);
}

describe('visibilityCaveat', () => {
  it('makes the promise unqualified when neither exception is on the page', () => {
    // The ordinary page: unread arrivals, conflicts, objects a run stopped finding. An
    // object flagged `missing` reads as ordinary on every reader-facing surface, so it is
    // genuinely no exception — naming one here would tell a curator something is hidden
    // when nothing is.
    expect(visibilityCaveat(kinds('missing', 'conflicts', 'waiting'))).toBe('.');
  });

  it('names the refusal, which was never shown at all', () => {
    const tail = visibilityCaveat(kinds('missing', 'refused'));

    expect(tail).toContain('our own rule for a list turned down');
    expect(tail).toContain('hidden already');
    expect(tail).not.toContain('the places an object lost');
  });

  it('names the withdrawal, which readers had seen and then stopped seeing', () => {
    // The distinction is the whole content of the sentence: a refusal never reached a
    // reader, a withdrawn point did and was taken away by the run rather than by anyone's
    // decision. Both belong under "except", for opposite reasons.
    const tail = visibilityCaveat(kinds('withdrawn'));

    expect(tail).toContain('the places an object lost');
    expect(tail).toContain('stopped seeing');
    expect(tail).not.toContain('turned down');
  });

  it('names both when both are on the page, without either standing for the other', () => {
    const tail = visibilityCaveat(kinds('withdrawn', 'refused', 'missing'));

    expect(tail).toContain('the places an object lost');
    expect(tail).toContain('turned down');
    // One clause per kind, joined — not a single phrase covering them, which is how one
    // of the two facts comes to be described in the other's words.
    expect(tail).toContain(', and ');
    expect(tail.startsWith(' — except ')).toBe(true);
  });
});

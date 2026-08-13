/**
 * Tests for the word comparison behind a conflict card.
 *
 * The load-bearing property is not which words get marked — it is that **nothing is
 * lost**: whatever comes back, joining each side's parts must reproduce the text that
 * went in, because those parts are what the curator reads before deciding. A comparison
 * that drops a sentence would hide the very thing the screen exists to show.
 */

import { describe, it, expect } from 'vitest';
import { wordDiff } from './wordDiff';

function rebuild(parts: { text: string }[]): string {
  return parts.map(p => p.text).join('');
}

function marked(parts: { text: string; changed?: true }[]): string[] {
  return parts.filter(p => p.changed).map(p => p.text.trim());
}

describe('wordDiff', () => {
  it('marks nothing when the two texts are the same', () => {
    const diff = wordDiff('Ruins of the ancient city', 'Ruins of the ancient city');

    expect(marked(diff.before)).toEqual([]);
    expect(marked(diff.after)).toEqual([]);
    expect(diff.capped).toBeUndefined();
  });

  it('marks the words one side added', () => {
    const diff = wordDiff('Ruins of the ancient city', 'Ruins of the ancient walled city');

    expect(marked(diff.before)).toEqual([]);
    expect(marked(diff.after)).toEqual(['walled']);
  });

  it('marks the words one side dropped', () => {
    const diff = wordDiff('the heart of ancient Ethiopia', 'the heart of Ethiopia');

    expect(marked(diff.before)).toEqual(['ancient']);
    expect(marked(diff.after)).toEqual([]);
  });

  it('marks a replacement on both sides, not as one long block', () => {
    const diff = wordDiff('giant stelae and royal tombs', 'giant obelisks and royal tombs');

    expect(marked(diff.before)).toEqual(['stelae']);
    expect(marked(diff.after)).toEqual(['obelisks']);
  });

  it('reproduces both inputs exactly, including their spacing', () => {
    // The property that matters most: the curator reads these parts instead of the raw
    // values, so anything the comparison drops is hidden from the decision.
    const before = 'The  ruins of the ancient city of Aksum are found close to the border.\nThey mark a kingdom.';
    const after = 'Ruins of the ancient city of Aksum near the northern border, the heart of ancient Ethiopia.';

    const diff = wordDiff(before, after);

    expect(rebuild(diff.before)).toBe(before);
    expect(rebuild(diff.after)).toBe(after);
  });

  it('handles an empty side without marking the other into nothing', () => {
    const added = wordDiff('', 'a new short description');
    expect(rebuild(added.before)).toBe('');
    expect(marked(added.after)).toEqual(['a new short description']);

    const removed = wordDiff('a short description that went away', '');
    expect(marked(removed.before)).toEqual(['a short description that went away']);
    expect(rebuild(removed.after)).toBe('');
  });

  it('refuses a value too long to compare, and says so rather than freezing', () => {
    // Quadratic in words. The longest value this screen has ever been asked about is
    // 1339 characters — about 150 words — so a 500-word value is not the text this is
    // for, and the caller renders both sides plainly instead.
    const long = 'word '.repeat(500);

    const diff = wordDiff(long, `${long}and one more`);

    expect(diff.capped).toBe(true);
    expect(rebuild(diff.before)).toBe(long);
    expect(rebuild(diff.after)).toBe(`${long}and one more`);
    expect(marked(diff.before)).toEqual([]);
    expect(marked(diff.after)).toEqual([]);
  });

  it('runs the longest real conflict well inside a frame', () => {
    // Aksum's own pair, at the measured sizes: 511 characters of source text against 200
    // of a curator's. If this ever stops being instant, the cap above is the answer.
    const source = 'The ruins of the ancient city of Aksum are found close to Ethiopia\'s northern border. '.repeat(6);
    const mine = 'Ruins of the ancient city of Aksum near Ethiopia\'s northern border, the heart of ancient Ethiopia. '.repeat(2);

    const started = performance.now();
    const diff = wordDiff(mine, source);

    expect(performance.now() - started).toBeLessThan(50);
    expect(rebuild(diff.after)).toBe(source);
  });
});

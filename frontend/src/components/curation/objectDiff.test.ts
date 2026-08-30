/**
 * Tests for which keys of an object actually moved.
 *
 * Two properties carry the whole change. The keys that differ are the ones a curator is
 * shown, so a key reported that did not move is a question about nothing; and the
 * equality has to be the server's, since the server is what decided the field was worth
 * a card at all. The cases below are the shapes this catalogue's sync log really holds —
 * `criteria` arriving as text, `imageCredit` arriving as an object, a counter moving by
 * two, a `criteria` key appearing as `null` and meaning nothing.
 *
 * The `valuesEqual` block is one half of a pin the two packages cannot share a runtime
 * for (#527): `changeSet.test.ts` § "the equality a curation card mirrors" states the
 * identical properties against `jsonEquals`, so a relaxation on either side fails a test
 * beside it. Keep the two in step — a property added here wants its twin there.
 */

import { describe, it, expect } from 'vitest';
import { changedKeys, isEmptyValue, valuesEqual } from './objectDiff';

describe('valuesEqual', () => {
  it('reads null, undefined and the empty string as the same nothing', () => {
    // `changeSet.ts` does, and a key that merely appeared as `null` must not raise a row:
    // 17 of the log's `criteria` entries are exactly that.
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual('', null)).toBe(true);
    expect(valuesEqual(undefined, '')).toBe(true);
    expect(valuesEqual(null, 'Y 2026')).toBe(false);
  });

  it('compares object keys as a set, since JSONB does not keep their order', () => {
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(valuesEqual({ qid: 'Q1892745', label: 'Salvator Mundi' },
      { label: 'Salvator Mundi', qid: 'Q1892745' })).toBe(true);
    expect(valuesEqual({ qid: 'Q1892745' }, { qid: 'Q19675' })).toBe(false);
  });

  it('compares arrays by position, because their order is the value', () => {
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
  });

  it('holds a string apart from the number that reads the same', () => {
    // The trap the whole "shown as stored" note exists for.
    expect(valuesEqual('2003', 2003)).toBe(false);
    expect(valuesEqual(0, false)).toBe(false);
  });
});

describe('changedKeys', () => {
  /** The Louvre's metadata, as museum run 64 found it. */
  const louvre = {
    website: 'https://www.louvre.fr/zh-hans',
    admittedFor: { qid: 'Q12418', label: 'Mona Lisa' },
    wikidataQid: 'Q19675',
    artworkCount: 122,
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Louvre',
    totalArtworkSitelinks: 2363,
  };

  it('names the one key that moved and leaves the other five off the card', () => {
    const changes = changedKeys(louvre, { ...louvre, totalArtworkSitelinks: 2365 });
    expect(changes).toEqual([{ key: 'totalArtworkSitelinks', old: 2363, new: 2365 }]);
  });

  it('sorts the keys, because a JSONB column does not keep the order they went in', () => {
    const changes = changedKeys(
      { ...louvre, website: 'https://louvre.fr' },
      { ...louvre, totalArtworkSitelinks: 2365 },
    );
    expect(changes?.map(c => c.key)).toEqual(['totalArtworkSitelinks', 'website']);
  });

  it('reads a key one side does not have as one side being empty', () => {
    const changes = changedKeys({ website: 'https://louvre.fr' },
      { website: 'https://louvre.fr', criteria: '(i)(ii)(vi)' });
    expect(changes).toEqual([{ key: 'criteria', old: undefined, new: '(i)(ii)(vi)' }]);
  });

  it('says nothing about a key that only appeared as null', () => {
    expect(changedKeys({ website: 'https://louvre.fr' },
      { website: 'https://louvre.fr', criteria: null })).toBeNull();
  });

  it('treats an absent side as an empty object, so a first metadata arrives by key', () => {
    const changes = changedKeys(null, { dateInscribed: '2003', inDanger: false });
    expect(changes).toEqual([
      { key: 'dateInscribed', old: undefined, new: '2003' },
      { key: 'inDanger', old: undefined, new: false },
    ]);
  });

  it('refuses a pair that has no named parts', () => {
    // Text, and an array whose parts have positions rather than names: pairing tags by
    // index would report a reordering as a change to every one of them.
    expect(changedKeys('Aksum', 'Axum')).toBeNull();
    expect(changedKeys(['unesco', 'ruins'], ['ruins', 'unesco'])).toBeNull();
    expect(changedKeys(null, undefined)).toBeNull();
    expect(changedKeys({ a: 1 }, 'a=1')).toBeNull();
  });

  it('refuses an object pair it finds nothing to say about', () => {
    // The floor under a disagreement with the server, which applies the same equality
    // before reporting the field at all.
    expect(changedKeys({ a: 1, b: 2 }, { b: 2, a: 1 })).toBeNull();
  });
});

describe('isEmptyValue', () => {
  it('reads an empty list as nothing, which valuesEqual deliberately does not', () => {
    // A place with no countries listed and then two is a fact arriving, to a person.
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
    expect(valuesEqual([], null)).toBe(false);
  });
});

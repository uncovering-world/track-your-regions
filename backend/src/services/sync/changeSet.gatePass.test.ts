import { describe, expect, it } from 'vitest';
import { metadataPassesTheGate, passingMetadataKeys } from './changeSet.js';

/** Which metadata rewrites pass the gate unasked (#1353), on the rows the queue held on 2026-10-10. */
describe('a metadata rewrite a visitor would not notice', () => {
  const credit = (author: string, license = 'CC BY-SA 2.5') => ({ author, license });

  it('passes a credit re-read for the same picture under the same licence', () => {
    expect(metadataPassesTheGate(
      'imageCredit', credit('No machine-readable author provided. Ansgar Walk'), credit('Ansgar Walk'), true,
    )).toBe('same-file-credit');
  });

  it('holds a credit beside another picture, or under another licence', () => {
    expect(metadataPassesTheGate('imageCredit', credit('A'), credit('B'), false)).toBeNull();
    expect(metadataPassesTheGate('imageCredit', credit('A'), credit('A', 'CC BY-SA 4.0'), true)).toBeNull();
    expect(metadataPassesTheGate('imageCredit', null, credit('A'), true)).toBeNull();
    // No licence on either side is no licence kept.
    expect(metadataPassesTheGate('imageCredit', { author: 'A' }, { author: 'B' }, true)).toBeNull();
  });

  it('passes a number re-measured by under a tenth as re-measured, and a larger move as unseen', () => {
    expect(metadataPassesTheGate('areaHectares', 821.7474, 821.748, true)).toBe('remeasured');
    expect(metadataPassesTheGate('areaHectares', 770, 796.08, true)).toBe('remeasured');
    // No reader is shown the area (#1834): Cologne Cathedral's only open question was it.
    expect(metadataPassesTheGate('areaHectares', 770, 1000, true)).toBe('unseen');
    expect(metadataPassesTheGate('areaHectares', 0, 5, true)).toBe('unseen');
  });

  it('never passes a key the gate weighs as major, an inscription year among them', () => {
    expect(metadataPassesTheGate('dateInscribed', 1979, 1980, true)).toBeNull();
  });

  it('re-measures only a measurement: a monument\'s year is a number, and a different statement', () => {
    // Passed all the same, as a field no reader is shown (#1834), never as re-measured.
    expect(metadataPassesTheGate('year', 1935, 2100, true)).toBe('unseen');
    expect(metadataPassesTheGate('year', 1935, 1936, true)).toBe('unseen');
  });
});

describe("the Wikidata item a place holds none of (#1794)", () => {
  // Ajanta Caves: the UNESCO run made the place and writes no item, and Places of
  // worship and Archaeology both know it as Q184427.
  it('passes the item arriving where the place holds none', () => {
    expect(metadataPassesTheGate('wikidataQid', undefined, 'Q184427', true)).toBe('own-item');
    expect(metadataPassesTheGate('wikidataQid', null, 'Q184427', false)).toBe('own-item');
    expect(passingMetadataKeys({ inDanger: false }, { inDanger: false, wikidataQid: 'Q184427' }, [], true))
      .toEqual(['wikidataQid']);
  });

  it('holds an item replaced by another, and anything that is not an item', () => {
    expect(metadataPassesTheGate('wikidataQid', 'Q184427', 'Q1', true)).toBeNull();
    expect(metadataPassesTheGate('wikidataQid', 'Q184427', undefined, true)).toBeNull();
    expect(metadataPassesTheGate('wikidataQid', undefined, 'Ajanta Caves', true)).toBeNull();
    expect(metadataPassesTheGate('wikidataQid', undefined, 'Q0', true)).toBeNull();
  });
});

describe('a credit beside a picture a curator owns (#1353)', () => {
  it('never passes: the credit is the claim\'s', () => {
    const before = { imageCredit: { author: 'A', license: 'CC BY 4.0' } };
    const incoming = { imageCredit: { author: 'B', license: 'CC BY 4.0' } };
    expect(passingMetadataKeys(before, incoming, [], true)).toEqual(['imageCredit']);
    expect(passingMetadataKeys(before, incoming, ['image_url'], true)).toEqual([]);
  });
});

describe('a field no reader is shown (#1834)', () => {
  it('passes every rewrite of an unseen key, an appearing value and one sent as null included', () => {
    expect(metadataPassesTheGate('creators', ['Ana'], ['Ana', 'Bo'], true)).toBe('unseen');
    expect(metadataPassesTheGate('criteria', '(ii)(iv)', '(ii)(iv)(vi)', true)).toBe('unseen');
    expect(metadataPassesTheGate('year', undefined, 1915, true)).toBe('unseen');
    expect(metadataPassesTheGate('year', 1915, null, true)).toBe('unseen');
  });

  it('holds a key the incoming record lacks, which the held row would not take', () => {
    // A museum's run sends no year; the held metadata arm merges only the keys sent.
    expect(metadataPassesTheGate('year', 1915, undefined, true)).toBeNull();
    expect(passingMetadataKeys({ year: 1915 }, {}, [], true)).toEqual([]);
  });

  it('holds a key a reader is shown, and a key with no mark', () => {
    expect(metadataPassesTheGate('website', 'https://a.example', 'https://b.example', true)).toBeNull();
    expect(metadataPassesTheGate('wikipediaUrl', 'https://en.wikipedia.org/wiki/A', null, true)).toBeNull();
    expect(metadataPassesTheGate('neverMarked', 1, 2, true)).toBeNull();
  });

  it('holds another Wikidata item, which no reader is shown either: the row may describe another object', () => {
    expect(metadataPassesTheGate('wikidataQid', 'Q184427', 'Q1', true)).toBeNull();
  });

  it('writes a curator\'s claimed unseen key as the curator\'s', () => {
    expect(passingMetadataKeys({ year: 1915 }, { year: 1945 }, ['metadata.year'], true)).toEqual([]);
    expect(passingMetadataKeys({ year: 1915 }, { year: 1945 }, [], true)).toEqual(['year']);
  });
});

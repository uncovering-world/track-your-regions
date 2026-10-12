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

  it('passes a number re-measured by under a tenth, and holds a larger move', () => {
    expect(metadataPassesTheGate('areaHectares', 821.7474, 821.748, true)).toBe('remeasured');
    expect(metadataPassesTheGate('areaHectares', 770, 796.08, true)).toBe('remeasured');
    expect(metadataPassesTheGate('areaHectares', 770, 1000, true)).toBeNull();
    expect(metadataPassesTheGate('areaHectares', 0, 5, true)).toBeNull();
  });

  it('never passes a key the gate weighs as major, an inscription year among them', () => {
    expect(metadataPassesTheGate('dateInscribed', 1979, 1980, true)).toBeNull();
  });

  it('re-measures only a measurement: a monument\'s year is a number, and a different statement', () => {
    expect(metadataPassesTheGate('year', 1935, 2100, true)).toBeNull();
    expect(metadataPassesTheGate('year', 1935, 1936, true)).toBeNull();
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

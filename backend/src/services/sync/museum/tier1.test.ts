import { describe, it, expect } from 'vitest';
import { selectTier1, type TierWork } from './tier1.js';

const w = (qid: string, sitelinks: number, venues: string[]): TierWork =>
  ({ qid, sitelinks, venues });
/** The same work, in a medium that exists in an edition rather than as one original. */
const edition = (qid: string, sitelinks: number, venues: string[]): TierWork =>
  ({ qid, sitelinks, venues, multipleMedium: true });

describe('selectTier1', () => {
  it('admits a museum for the work it holds', () => {
    const { museums } = selectTier1([w('monaLisa', 146, ['louvre'])]);
    expect(museums.get('louvre')).toEqual(['monaLisa']);
  });

  it('ignores a work below the threshold', () => {
    const { museums } = selectTier1([w('minor', 21, ['someMuseum'])]);
    expect(museums.size).toBe(0);
  });

  it('admits a work sitting exactly at the threshold', () => {
    const { museums } = selectTier1([w('atThreshold', 22, ['someMuseum'])]);
    expect(museums.get('someMuseum')).toEqual(['atThreshold']);
  });

  it('admits both holders of a work in two places', () => {
    // Böcklin painted five Isles of the Dead; two museums each hold one
    const { museums } = selectTier1([w('isleOfTheDead', 29, ['leipzig', 'berlin'])]);
    expect([...museums.keys()].sort()).toEqual(['berlin', 'leipzig']);
  });

  it('admits every holder of an edition, however many there are', () => {
    // The Great Wave has roughly a hundred impressions and each is the real thing. The cap asks
    // which of these is the one to travel for, and an edition has no such answer to give — so
    // applying it here deleted Japanese printmaking from the catalogue as a class.
    const { museums, shared } = selectTier1([
      edition('greatWave', 63, ['mak', 'honolulu', 'maidstone', 'tokyoFuji']),
    ]);

    expect([...museums.keys()].sort()).toEqual(['honolulu', 'maidstone', 'mak', 'tokyoFuji']);
    expect(shared).toEqual([]);
  });

  it('still questions a unique work claimed by many, which is a curator\'s call', () => {
    // A painting exists once. Several venues claiming it is a copy-or-original question, and
    // no threshold answers it — the machine's part is to notice.
    const { museums, shared } = selectTier1([
      w('takingOfChrist', 30, ['dublin', 'odesa', 'thirdClaimant']),
    ]);

    expect(museums.size).toBe(0);
    expect(shared).toEqual(['takingOfChrist']);
  });

  it('does not treat an edition as unique just because the flag is absent', () => {
    // The flag is optional on the interface; a work that never says is judged as unique, which
    // is the safe direction — it reaches a curator rather than admitting everyone silently.
    const { shared } = selectTier1([w('unmarked', 40, ['a', 'b', 'c'])]);

    expect(shared).toEqual(['unmarked']);
  });

  it('admits nobody for a work held by more than two venues', () => {
    // The Great Wave exists in about a hundred impressions; holding one is not a distinction
    const { museums, shared } = selectTier1([w('greatWave', 63, ['mak', 'honolulu', 'maidstone', 'tokyoFuji'])]);
    expect(museums.size).toBe(0);
    expect(shared).toEqual(['greatWave']);
  });

  it('reports an iconic work with nowhere to live', () => {
    const { homeless } = selectTier1([w('ghentAltarpiece', 39, [])]);
    expect(homeless).toEqual(['ghentAltarpiece']);
  });
});

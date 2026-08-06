import { describe, it, expect } from 'vitest';
import { computeFolds, type FoldCandidate } from './venueFolds.js';

const v = (qid: string, lat: number, lon: number, works = 0, sitelinks = 0): FoldCandidate =>
  ({ qid, lat, lon, works, sitelinks });

describe('computeFolds', () => {
  it('folds a gallery into the palace that contains it', () => {
    // Galleria Palatina is inside Palazzo Pitti, 5 m apart, one ticket
    const folds = computeFolds([v('palatina', 43.7650, 11.2500, 17), v('pitti', 43.76504, 11.25001, 0, 58)],
      (q) => (q === 'palatina' ? ['pitti'] : []));
    expect(folds.palatina?.into).toBe('pitti');
  });

  it('leaves a branch two streets away alone', () => {
    // Czartoryski is P361 part of the National Museum in Kraków but 500 m away: two visits
    const folds = computeFolds([v('czartoryski', 50.0647, 19.9450, 1), v('nmKrakow', 50.0600, 19.9300, 4)],
      (q) => (q === 'czartoryski' ? ['nmKrakow'] : []));
    expect(folds.czartoryski).toBeUndefined();
  });

  it('leaves neighbours that merely share a square alone', () => {
    // Van Gogh Museum and the Stedelijk are 113 m apart on Museumplein: two tickets
    const folds = computeFolds([v('vangogh', 52.3584, 4.8811, 15), v('stedelijk', 52.3592, 4.8797, 1)], () => []);
    expect(folds).toEqual({});
  });

  it('merges two records of one institution at the same spot, keeping the one with the collection', () => {
    // "The Met Fifth Avenue" and the Metropolitan Museum of Art, 7 m apart
    const folds = computeFolds([v('metFifth', 40.7794, -73.9632, 1), v('met', 40.77944, -73.96333, 58)], () => []);
    expect(folds.metFifth?.into).toBe('met');
    expect(folds.met).toBeUndefined();
  });

  it('keeps every loser of a three-way duplicate pointing at the true survivor, not at each other', () => {
    // Three synthetic duplicate records of one museum at the same spot (works 1, 41, 3). Both
    // losers must resolve to dup2, the one true survivor — not to whichever other loser they
    // happened to be compared against last, which is what happens if an already-folded row is
    // reconsidered as a fold target.
    const folds = computeFolds(
      [v('dup1', 43.76796, 11.25508, 1), v('dup2', 43.76792, 11.25512, 41), v('dup3', 43.7679, 11.25505, 3)],
      () => [],
    );
    expect(folds.dup1?.into).toBe('dup2');
    expect(folds.dup3?.into).toBe('dup2');
    expect(folds.dup2).toBeUndefined();
  });

  it('still folds two duplicate records that are equal on both counts', () => {
    // The tie a duplicate Wikidata record actually produces: no placed works and
    // no sitelinks on either, six metres apart. Without a last resort neither
    // loses — in either direction — so nothing merges and the duplicate pin this
    // rule exists to remove survives, which is the one outcome it must not have.
    const folds = computeFolds([v('dupLow', 48.8606, 2.3376), v('dupHigh', 48.86065, 2.33762)], () => []);

    expect(Object.keys(folds)).toHaveLength(1);
    // Whichever way it goes, it must go the same way from both orders.
    const reversed = computeFolds([v('dupHigh', 48.86065, 2.33762), v('dupLow', 48.8606, 2.3376)], () => []);
    expect(Object.keys(reversed)).toEqual(Object.keys(folds));
    expect(reversed[Object.keys(folds)[0]].into).toBe(folds[Object.keys(folds)[0]].into);
  });

  it('does not mistake a degree of longitude for a degree of latitude near the poles', () => {
    // Two records of one institution 81 m apart at 78°N, separated only in longitude. Treating a
    // degree of longitude as a degree of latitude (dropping the cos(lat) term) computes almost
    // 390 m here and misses a fold that is well inside the container radius.
    const folds = computeFolds([v('arcticBranch', 78.0, 15.0035), v('arcticContainer', 78.0, 15.0)],
      (q) => (q === 'arcticBranch' ? ['arcticContainer'] : []));
    expect(folds.arcticBranch?.into).toBe('arcticContainer');
  });

  it('chains a three-level P361 nesting instead of resolving to the final survivor (current behaviour)', () => {
    // A room inside a gallery inside a palace, each ~137 m from its *immediate* parent only (the
    // room is over 250 m from the palace directly, so a one-hop check would miss it — the whole
    // reason parentsOf is walked one relationship at a time). computeFolds does not chase the
    // chain: it records room -> gallery and gallery -> palace as two separately-correct entries,
    // so folds.room.into names 'gallery', which is itself a key of this same map, not 'palace'.
    // This pins today's behaviour on purpose: resolving the chain is the wiring layer's job, not
    // this function's, so a future change that collapses it to a fixed point in here — rather
    // than in the consumer — should fail this test and force that to be a decision, not a shrug.
    const parentsOf: Record<string, string[]> = { room: ['gallery'], gallery: ['palace'] };
    const folds = computeFolds(
      [v('room', 43.7670, 11.2520), v('gallery', 43.7660, 11.2510), v('palace', 43.7650, 11.2500)],
      (q) => parentsOf[q] ?? [],
    );
    expect(folds.room).toBeDefined();
    expect(folds.gallery).toBeDefined();
    expect(folds.room?.into).toBe('gallery');
    expect(folds.gallery?.into).toBe('palace');
  });
});

describe('reciprocal P361 pairs', () => {
  const at = (qid: string, lat: number, lon: number, works: number, sitelinks: number) =>
    ({ qid, lat, lon, works, sitelinks });

  it('leaves exactly one survivor when two venues each contain the other', () => {
    // Wikidata has these; without the cycle break the map is {A: into B, B: into A}, so nothing
    // merges, each venue's works are written to the other, and both are reported as folded.
    const a = at('QA', 48.8611, 2.3358, 3, 100);
    const b = at('QB', 48.8612, 2.3358, 9, 50);
    const parents = (q: string) => (q === 'QA' ? ['QB'] : ['QA']);

    const folds = computeFolds([a, b], parents);

    expect(Object.keys(folds)).toEqual(['QA']);
    expect(folds.QA.into).toBe('QB');
  });

  it('keeps the row carrying the collection, not the one that happened to come first', () => {
    const a = at('QA', 48.8611, 2.3358, 12, 10);
    const b = at('QB', 48.8612, 2.3358, 2, 900);
    const parents = (q: string) => (q === 'QA' ? ['QB'] : ['QA']);

    const folds = computeFolds([a, b], parents);

    expect(Object.keys(folds)).toEqual(['QB']);
    expect(folds.QB.into).toBe('QA');
  });

  it('gives the same answer whichever order the venues arrive in', () => {
    const a = at('QA', 48.8611, 2.3358, 4, 4);
    const b = at('QB', 48.8612, 2.3358, 4, 4);
    const parents = (q: string) => (q === 'QA' ? ['QB'] : ['QA']);

    const forwards = computeFolds([a, b], parents);
    const backwards = computeFolds([b, a], parents);

    expect(Object.keys(forwards)).toEqual(Object.keys(backwards));
  });

  it('breaks a three-venue cycle down to one survivor', () => {
    const a = at('QA', 48.8611, 2.3358, 1, 1);
    const b = at('QB', 48.8612, 2.3358, 2, 2);
    const c = at('QC', 48.8613, 2.3358, 3, 3);
    const ring: Record<string, string[]> = { QA: ['QB'], QB: ['QC'], QC: ['QA'] };

    const folds = computeFolds([a, b, c], (q) => ring[q] ?? []);

    // Every member but the strongest folds, and the chain terminates.
    expect(folds.QC).toBeUndefined();
    const walk = (q: string): string => {
      let n = q;
      const seen = new Set([q]);
      while (folds[n]) {
        n = folds[n].into;
        if (seen.has(n)) throw new Error('the chain never terminates');
        seen.add(n);
      }
      return n;
    };
    expect(walk('QA')).toBe('QC');
    expect(walk('QB')).toBe('QC');
  });
});

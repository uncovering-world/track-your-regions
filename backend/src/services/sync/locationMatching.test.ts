import { describe, expect, it } from 'vitest';
import { completePairing, type PairCandidate } from './locationMatching.js';

/**
 * The pairing made complete (#549, ADR-0117). Candidates come as the writer
 * lists them, best first within each point; the greedy pairing is what its two
 * `DISTINCT ON` passes would have kept.
 */

const c = (ordinal: number, locationId: number, metres: number): PairCandidate => ({ ordinal, locationId, metres });

describe('completePairing', () => {
  it("pairs both points of the issue's case, which the greedy passes paired once", () => {
    // Two incoming points 15 m apart; row 101 is 7.5 m from both, row 102 is
    // 7.6 m from the second. Greedy: both choose 101, the second is dropped.
    const candidates = [c(1, 101, 7.5), c(2, 101, 7.5), c(2, 102, 7.6)];
    expect(completePairing(candidates, [{ ordinal: 1, locationId: 101, metres: 7.5 }])).toEqual([
      { ordinal: 1, locationId: 101, metres: 7.5 },
      { ordinal: 2, locationId: 102, metres: 7.6 },
    ]);
  });

  it('moves a pair to its next row when that is the only way the other point pairs', () => {
    // The first point could take 101 or 102; the second only 101. Greedy gives
    // 101 to the first and nothing to the second.
    const candidates = [c(1, 101, 3), c(1, 102, 8), c(2, 101, 6)];
    expect(completePairing(candidates, [{ ordinal: 1, locationId: 101, metres: 3 }])).toEqual([
      { ordinal: 1, locationId: 102, metres: 8 },
      { ordinal: 2, locationId: 101, metres: 6 },
    ]);
  });

  it('changes nothing where the greedy pairing is already complete', () => {
    const candidates = [c(1, 101, 0), c(2, 102, 0), c(2, 101, 9)];
    const greedy = [{ ordinal: 1, locationId: 101, metres: 0 }, { ordinal: 2, locationId: 102, metres: 0 }];
    expect(completePairing(candidates, greedy)).toBeNull();
  });

  it('changes nothing where no pairing could place the point left over', () => {
    // Both points can only be row 101: one of them is new whatever is chosen.
    const candidates = [c(1, 101, 2), c(2, 101, 4)];
    expect(completePairing(candidates, [{ ordinal: 1, locationId: 101, metres: 2 }])).toBeNull();
  });

  it('gives a leftover point a row nobody holds before moving anyone', () => {
    // The second point's candidates are 101 (held) then 103 (free): it takes 103
    // and the first point keeps the row the greedy pass gave it.
    const candidates = [c(1, 101, 1), c(1, 102, 2), c(2, 101, 3), c(2, 103, 5)];
    expect(completePairing(candidates, [{ ordinal: 1, locationId: 101, metres: 1 }])).toEqual([
      { ordinal: 1, locationId: 101, metres: 1 },
      { ordinal: 2, locationId: 103, metres: 5 },
    ]);
  });

  it('follows a path through more than one held row', () => {
    // 3 needs 102, held by 2, whose other row 101 is held by 1, whose other row 100 is free.
    const candidates = [c(1, 101, 1), c(1, 100, 9), c(2, 102, 1), c(2, 101, 9), c(3, 102, 2)];
    const greedy = [{ ordinal: 1, locationId: 101, metres: 1 }, { ordinal: 2, locationId: 102, metres: 1 }];
    expect(completePairing(candidates, greedy)).toEqual([
      { ordinal: 1, locationId: 100, metres: 9 },
      { ordinal: 2, locationId: 101, metres: 9 },
      { ordinal: 3, locationId: 102, metres: 2 },
    ]);
  });
});

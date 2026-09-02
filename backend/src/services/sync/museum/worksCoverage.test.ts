/**
 * Tests for the works coverage floor (ADR-0044, #588).
 *
 * The floor is what stands between a short run and two thirds of the
 * catalogue's works leaving the walls: run 42 fetched 291 artworks where run 3
 * had fetched 1906 and reported success. What is defended here is the
 * *measure* — which works count, on which side — because the number is easy to
 * get plausibly wrong: measured on links, a placement rule that re-homes works
 * would fail the floor for ever; measured against every museum the catalogue
 * holds, an admission rule that drops museums would fail it too.
 */

import { describe, it, expect } from 'vitest';
import {
  measureWorksCoverage,
  worksCoverageSkipReason,
  WORKS_COVERAGE_MIN,
  type WorksCoverageInput,
} from './worksCoverage.js';

const LOUVRE = 'Q19675';
const ORSAY = 'Q23402';
const PRADO = 'Q160112';

/** Three museums, ten works, every work placed where the catalogue offers it. */
function input(overrides: Partial<WorksCoverageInput> = {}): WorksCoverageInput {
  return {
    stored: {
      Q12418: [LOUVRE], Q152052: [LOUVRE], Q151047: [LOUVRE], Q3947: [LOUVRE],
      Q79906: [ORSAY], Q1094213: [ORSAY], Q2304394: [ORSAY],
      Q1219008: [PRADO], Q334138: [PRADO], Q2258999: [PRADO],
    },
    admitted: [
      { qid: LOUVRE, works: ['Q12418', 'Q152052', 'Q151047', 'Q3947'] },
      { qid: ORSAY, works: ['Q79906', 'Q1094213', 'Q2304394'] },
      { qid: PRADO, works: ['Q1219008', 'Q334138', 'Q2258999'] },
    ],
    ...overrides,
  };
}

describe('measureWorksCoverage', () => {
  it('counts the works the catalogue offers at the museums this run admits, and how many it placed again', () => {
    expect(measureWorksCoverage(input())).toEqual({ stored: 10, seen: 10, museums: 3 });
  });

  it('counts a work re-homed between two admitted museums as seen', () => {
    // The run still knows where the work is; it is the *link* that moves. A
    // floor measured on links would refuse every placement-rule change for ever,
    // since the old links stay stored until the very withdrawal the floor blocks.
    const moved = input({ admitted: [
      { qid: LOUVRE, works: ['Q12418', 'Q152052', 'Q151047'] },
      { qid: ORSAY, works: ['Q79906', 'Q1094213', 'Q2304394', 'Q3947'] },
      { qid: PRADO, works: ['Q1219008', 'Q334138', 'Q2258999'] },
    ] });
    expect(measureWorksCoverage(moved)).toEqual({ stored: 10, seen: 10, museums: 3 });
  });

  it('leaves a museum that left the category out of both sides', () => {
    // Admission has its own floor (ADR-0024) and its own sweep; a museum the art
    // test drops takes its works out of this measure entirely, or every
    // admission change would read as an under-fetch.
    const withoutPrado = input({ admitted: [
      { qid: LOUVRE, works: ['Q12418', 'Q152052', 'Q151047', 'Q3947'] },
      { qid: ORSAY, works: ['Q79906', 'Q1094213', 'Q2304394'] },
    ] });
    expect(measureWorksCoverage(withoutPrado)).toEqual({ stored: 7, seen: 7, museums: 2 });
  });

  it('counts a work the run placed nowhere admitted as unseen', () => {
    // Whether it fell out of the pool or its only venue failed the venue test,
    // the run would withdraw it — which is exactly the case the floor is for.
    const lost = input({ admitted: [
      { qid: LOUVRE, works: ['Q12418', 'Q152052'] },
      { qid: ORSAY, works: ['Q79906', 'Q1094213', 'Q2304394'] },
      { qid: PRADO, works: ['Q1219008', 'Q334138', 'Q2258999'] },
    ] });
    expect(measureWorksCoverage(lost)).toEqual({ stored: 10, seen: 8, museums: 3 });
  });

  it('counts a work once however many admitted museums hold it', () => {
    // Two claimants are admitted together (ADR-0023 decision 4), and one work is
    // still one work on both sides of the ratio.
    const shared = input({
      stored: { Q12418: [LOUVRE, ORSAY], Q79906: [ORSAY] },
      admitted: [
        { qid: LOUVRE, works: ['Q12418'] },
        { qid: ORSAY, works: ['Q12418', 'Q79906'] },
      ],
    });
    expect(measureWorksCoverage(shared)).toEqual({ stored: 2, seen: 2, museums: 2 });
  });

  it('does not credit a museum this run admits for a work it never held', () => {
    // A newly admitted museum has no stored works, so it adds nothing to the
    // denominator — and its works are not "seen again" either, since nothing
    // offered them before.
    const newcomer = input({ admitted: [
      ...input().admitted,
      { qid: 'Q1201549', works: ['Q1000001', 'Q1000002'] },
    ] });
    expect(measureWorksCoverage(newcomer)).toEqual({ stored: 10, seen: 10, museums: 4 });
  });
});

describe('worksCoverageSkipReason', () => {
  it('allows withdrawal on a run that placed every work again', () => {
    expect(worksCoverageSkipReason(input())).toBeNull();
  });

  it('refuses a run that placed too few of the works the catalogue offers, and says the numbers', () => {
    // Run 42's shape: the pool came back a sixth of its size and the run
    // reported success. The reason names what a person needs to judge it —
    // how many, of how many, at how many museums — rather than a percentage alone.
    const short = input({ admitted: [
      { qid: LOUVRE, works: ['Q12418'] },
      { qid: ORSAY, works: ['Q79906'] },
      { qid: PRADO, works: ['Q1219008'] },
    ] });
    const reason = worksCoverageSkipReason(short);
    expect(reason).toContain('3 of the 10 works');
    expect(reason).toContain('3 museums');
    expect(reason).toContain('30.0%');
    expect(reason).toContain(`${WORKS_COVERAGE_MIN * 100}% floor`);
  });

  it('allows withdrawal at exactly the floor', () => {
    // 9 of 10 is the floor, not below it — a boundary that has to be pinned
    // because `<` and `<=` both read as plausible.
    const nine = input({ admitted: [
      { qid: LOUVRE, works: ['Q12418', 'Q152052', 'Q151047'] },
      { qid: ORSAY, works: ['Q79906', 'Q1094213', 'Q2304394'] },
      { qid: PRADO, works: ['Q1219008', 'Q334138', 'Q2258999'] },
    ] });
    expect(WORKS_COVERAGE_MIN).toBe(0.9);
    expect(worksCoverageSkipReason(nine)).toBeNull();
  });

  it('allows withdrawal when the catalogue offers nothing at the admitted museums', () => {
    // A first run, or a category rebuilt from nothing: there is no link to
    // withdraw, so there is nothing a floor could protect.
    expect(worksCoverageSkipReason(input({ stored: {} }))).toBeNull();
    expect(worksCoverageSkipReason(input({ admitted: [] }))).toBeNull();
  });

  it('is the same floor missing detection applies to a listing', () => {
    // Deliberately not the admission sweep's 50 %: that one guards a rule that
    // is supposed to change the set, this one guards what the source listed —
    // the pool — and a tenth of it going quiet in one run is the source
    // misbehaving, not the world changing.
    expect(WORKS_COVERAGE_MIN).toBe(0.9);
  });
});

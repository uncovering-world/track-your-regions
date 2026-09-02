/**
 * The coverage floor a museum run has to clear before it may withdraw a work.
 *
 * Nothing unlinked a work for a year, and that was a decision (ADR-0023,
 * ADR-0026 decision 5): sync run 42 fetched 291 artworks where run 3 before it
 * had fetched 1906, and reported success. A run like it that also unlinked
 * would have taken two thirds of the catalogue's works off the walls. What
 * makes a withdrawal safe is a floor over how much of what the catalogue holds
 * the run saw again — the treasures analogue of missing detection's floor for
 * experiences (`missingDetection.ts`), which this category, being `ranked`,
 * never reaches.
 *
 * **Measured on works, per pool** (ADR-0044). Of the works the catalogue offers
 * at the museums this run admits, how many does the run place at an admitted
 * museum — any of them. Three choices are inside that sentence, and each was
 * the wrong way round once:
 *
 * - *Works, not links.* A work re-homed from one admitted museum to another is
 *   seen; only the link moves. Measured on links, a placement-rule change would
 *   fail the floor on every later run, because the old links stay stored until
 *   the very withdrawal the floor is blocking.
 * - *At the museums this run admits.* Admission has its own floor and sweep
 *   (ADR-0024); a museum the art test drops takes its works out of both sides
 *   here, or every admission change would read as an under-fetch.
 * - *Per pool, not per band.* A band is whole or fatal — a failed or truncated
 *   band ends the run (ADR-0030 decision 8, `failIfTruncated`) — so the band is
 *   not the unit that can be quietly short. What can be is the pool as the
 *   placement sees it: a class closure that stopped early, a venue graph that
 *   came back thin, a rule that stopped resolving. Those show up as works the
 *   run no longer places, which is what this counts. A cached band is the same
 *   whole answer it was when fetched, so a run mixing cached and fresh bands is
 *   judged on what it placed, like any other.
 *
 * Measured against the stored table rather than the previous run's count, so
 * two consecutive short runs are refused twice rather than believed the second
 * time. The cost is stated in the ADR: a change that legitimately drops more
 * than a tenth of the works at admitted museums in one run is refused too, and
 * a person has to read the reason.
 */

/**
 * The share of offered works a run must place again before it may withdraw
 * any. Missing detection's floor, not the admission sweep's 50 %: that one
 * guards a rule that is supposed to change the set, this one guards what the
 * source listed, and a tenth of it going quiet in one run is the source
 * misbehaving rather than the world changing.
 */
export const WORKS_COVERAGE_MIN = 0.9;

export interface WorksCoverageInput {
  /**
   * Where the catalogue offers each work: work id → the venues holding it, as
   * `readPreviousPlacements` reads it — offered links only.
   */
  stored: Record<string, ReadonlyArray<string>>;
  /** The museums this run admits, each with every work it places there. */
  admitted: ReadonlyArray<{ qid: string; works: ReadonlyArray<string> }>;
}

export interface WorksCoverage {
  /** Works the catalogue offers at the museums this run admits. */
  stored: number;
  /** Of those, the ones this run places at an admitted museum — any of them. */
  seen: number;
  /** How many museums the run admits, for the sentence. */
  museums: number;
}

/**
 * The two numbers behind the floor, exported so a log line can say them.
 */
export function measureWorksCoverage(input: WorksCoverageInput): WorksCoverage {
  const admitted = new Set(input.admitted.map((m) => m.qid));
  const placed = new Set(input.admitted.flatMap((m) => m.works));

  let stored = 0;
  let seen = 0;
  for (const [work, venues] of Object.entries(input.stored)) {
    if (!venues.some((venue) => admitted.has(venue))) continue;
    stored++;
    if (placed.has(work)) seen++;
  }
  return { stored, seen, museums: admitted.size };
}

/**
 * Why this run may not withdraw a work, or null when it may.
 *
 * The sentence names what a person needs to judge it — how many works of how
 * many, at how many museums — because a percentage alone reads the same for a
 * pool that came back a sixth of its size and for a museum that lost one work
 * of nine.
 */
export function worksCoverageSkipReason(input: WorksCoverageInput): string | null {
  const { stored, seen, museums } = measureWorksCoverage(input);
  if (stored === 0) return null;
  const coverage = seen / stored;
  if (coverage >= WORKS_COVERAGE_MIN) return null;
  return `this run placed ${seen} of the ${stored} works the catalogue offers at the `
    + `${museums} museums it admits (${(coverage * 100).toFixed(1)}%), below the `
    + `${WORKS_COVERAGE_MIN * 100}% floor`;
}

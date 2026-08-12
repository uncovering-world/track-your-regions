/**
 * Release everything one source is holding, in one act.
 *
 * The reason this exists is the gate's write model — ADR-0025's decision 3, where the
 * sync path is the one writer that sets `pending` at all, and its decision 5, where
 * publishing is an update to a predicate rather than a replay of a proposal. Switching
 * a gate off therefore publishes nothing: nothing moves a row out of `pending`. Without
 * this endpoint a source turned off would leave its waiting rows stranded with no
 * way out but answering them one card at a time — and a switch that silently
 * published forty unreviewed objects instead is the thing the gate exists to
 * prevent. So the release is explicit, asked for by a person, and per object.
 *
 * **It does not touch a held proposal, and that is the decision worth reading.**
 * The three kinds a source can hold are not equal in what publishing them does.
 * An arrival and unread contents are things a reader *cannot see yet*: releasing
 * them reveals. A held proposal is a run's change to a row a reader is looking at
 * right now, and applying it overwrites what they see with a value nobody read.
 * A curator answering that one is shown `old → new` on its own card; a batch has
 * nowhere to show it. So held proposals stay for the queue, the response says how
 * many were left, and the panel's count afterwards is explainable rather than
 * mysteriously non-zero.
 *
 * That also keeps the staleness check honest rather than routed around.
 * `publishUnderLock` refuses a call that would write held fields without naming
 * the run it saw (`expectedSyncLogId`) — a check that exists so a later run's
 * values cannot be published under a curator's click. A batch cannot satisfy it
 * truthfully, and passing each row's own pointer back to it would satisfy it
 * *falsely*: the whole point of the check is that a person looked.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishUnderLock } from './publishController.js';
import { arrivalWaitingSql, contentsWaitingSql, heldWaitingSql } from './waitingCounts.js';

/** One object's outcome, named so a curator can tell what happened to what. */
interface PublishedObject {
  id: number;
  name: string;
  locationsPublished: number;
  /**
   * Works released, from both axes, because either can be zero while a work was.
   *
   * The link says this work has been passed as being *here*, the row says it has been
   * passed at all (ADR-0025 decision 2), and `contentsWaitingSql` asks both for the
   * case that separates them: a work reviewed in one venue and unread in another
   * publishes `treasureLinksPublished: 1, treasuresPublished: 0`. Carrying only the
   * second would report zero works for an object that released one — which is why the
   * single-object notice reads them as `Math.max` rather than picking one.
   */
  treasureLinksPublished: number;
  treasuresPublished: number;
  /**
   * Points a source replaced whose old pin this publication took off the map.
   *
   * Carried for the same reason as `placementFailed`, and reachable the same way:
   * publishing a visible row's unread points releases every withdrawal deferred
   * behind them (`publishContents`), so a curator releasing forty museums can pull
   * old pins for several of them and read "40 objects published." — a change to
   * what readers see that nothing else in the reply mentions. It survives per
   * object in the audit log, which is the forty-clicks answer this endpoint exists
   * to avoid.
   */
  withdrawalsReleased: number;
  /** Present only when the post-commit region placement failed for this object. */
  placementFailed?: true;
  /** Which world views it failed for — the half only an admin can act on. */
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}

/**
 * Publish everything waiting for one source.
 * POST /api/experiences/categories/:categoryId/publish-waiting
 *
 * Per object, under its own row lock, with its own `published` audit row — never
 * one row for the batch. A curator reading the log later is asking "when did this
 * museum become visible", and a single row saying "42 objects" answers that for
 * none of them.
 *
 * Scope is resolved per object rather than per category: a region-scoped curator
 * publishes what they cover and the response reports the rest as `outOfScope`,
 * because a batch that quietly published fewer than it found would leave them
 * believing the source was clear.
 */
export async function publishWaiting(req: AuthenticatedRequest, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));
  const userId = req.user!.id;
  const userRole = req.user!.role;

  // Ordered by id so a run of this endpoint is reproducible, and both kinds asked
  // for in one statement so the two cannot be answered against different snapshots
  // of the same source. `kind` decides the body each object is published with.
  const waiting = await pool.query(
    `SELECT e.id, e.name,
            CASE WHEN ${arrivalWaitingSql()} THEN 'arrival' ELSE 'contents' END AS kind
       FROM experiences e
      WHERE e.category_id = $1
        AND (${arrivalWaitingSql()} OR ${contentsWaitingSql()})
      ORDER BY e.id`,
    [categoryId],
  );

  const published: PublishedObject[] = [];
  const refused: Array<{ id: number; name: string; error: string }> = [];
  let outOfScope = 0;

  for (const row of waiting.rows) {
    const experienceId = row.id as number;

    // **Everything this iteration can fail at is inside the try**, and where the
    // boundary sits is the whole point. Three ways one object can go wrong and all
    // three must land in `refused` rather than in the request's own failure:
    //
    // - a refusal from `publishUnderLock` — expected, a run landed on the row
    //   mid-batch;
    // - a throw from it — it rolls back and rethrows anything that is not a refusal;
    // - a throw from `resolveExperienceScope`, which is a `pool.query` like any
    //   other, running a recursive CTE once per row. A statement timeout, a reset
    //   connection or an admin's `pg_terminate_backend` on object 400 is as likely
    //   here as inside the publish, and it used to sit outside this block.
    //
    // Any of them rejecting the handler answers 500 to a caller whose earlier
    // objects are already committed, and the page then says nothing was published —
    // false for every one the loop got through, and worse the larger the backlog:
    // a source gated before its first run can hold thousands of arrivals, each its
    // own transaction inside this one request.
    let outcome;
    try {
      const { permitted, logRegionId } = await resolveExperienceScope(
        userId, userRole, experienceId, categoryId,
      );
      if (!permitted) {
        outOfScope += 1;
        continue;
      }

      // An arrival is published as an object — that is what marks it read and
      // releases everything that arrived under it. A visible row is published
      // `contentsOnly`, which releases its unread points and works and leaves its
      // own state, and any proposal it is holding, exactly as they were.
      const body = row.kind === 'arrival' ? {} : { contentsOnly: true as const };
      outcome = await publishUnderLock(experienceId, userId, logRegionId, body);
    } catch (error) {
      // Logged here because nothing else will: on the single-object path the throw
      // propagates to `errorHandler`, which logs it, and swallowing it to keep the
      // batch going takes that away. Both halves of the trade have to actually
      // happen — the curator gets an object to open, the operator gets the reason —
      // or a deadlock part-way through a 1200-object release leaves no trace at all.
      // A literal format string with the id as an argument, matching
      // `publishContents`: a template literal here is `unsafe-formatstring` to
      // Semgrep, because a format specifier reaching the format position can forge
      // a log line. `experienceId` is a parsed integer and could not, but the rule
      // is structural and the idiomatic form is also the one already in this family.
      console.error('[publish-waiting] experience %d failed:', experienceId, error);
      refused.push({
        id: experienceId,
        name: row.name as string,
        error: 'Publishing this object failed — open it to see where it stands',
      });
      continue;
    }

    if (outcome.refusal) {
      refused.push({ id: experienceId, name: row.name as string, error: outcome.refusal.error });
      continue;
    }
    published.push({
      id: experienceId,
      name: row.name as string,
      locationsPublished: outcome.result?.locationsPublished ?? 0,
      treasureLinksPublished: outcome.result?.treasureLinksPublished ?? 0,
      treasuresPublished: outcome.result?.treasuresPublished ?? 0,
      withdrawalsReleased: outcome.result?.withdrawalsReleased ?? 0,
      // Carried rather than dropped, for the reason `publishController.ts` gives
      // where it decided to name them: rebuilding a world view is an admin's job,
      // so the curator's one useful act is telling an admin *which* object and
      // *which* world views — and this is the only caller who could.
      ...(outcome.result?.placementFailed ? {
        placementFailed: true as const,
        placementFailedWorldViews: outcome.result.placementFailedWorldViews,
      } : {}),
    });
  }

  // Counted after the loop, not before it: a run can land a held proposal while
  // this is publishing, and the number's whole job is to explain the remainder a
  // curator will see in the panel a second later. Read too early it explains the
  // wrong remainder.
  //
  // Scoped to the caller, like every other number in this response. Category-wide it
  // would invert the argument the `outOfScope` count exists for: a curator covering
  // two regions of a forty-held category would be told forty changes are still
  // waiting, when the queue will offer them three. The panel may legitimately say
  // "forty" — an admin's view of the source — but this reply is the answer to *their*
  // click. Same predicate the queue qualifies its rows with, so the number and the
  // cards agree.
  const scopeFilter = userRole === 'admin'
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('e.category_id')} OR EXISTS (
         SELECT 1 FROM experience_regions er
         JOIN curator_scoped_regions s ON s.id = er.region_id
         WHERE er.experience_id = e.id
       ))`;
  // The count itself goes inside a `try`, for the same reason the loop's body does, and
  // the last statement is where it matters most: another `pool.query` running another
  // recursive CTE, issued after a loop that may have run for minutes. A throw here
  // reaches `errorHandler` through `express-async-errors` and answers 500 — discarding a
  // report about publications that are already committed, including the
  // `placementFailedWorldViews` names that reach a person through this response and
  // nowhere else. Losing the count costs a sentence; losing the report costs the only
  // copy of it. So `null` means "could not be counted", which the panel says outright:
  // a `0` there would be a claim about the source that nothing checked.
  let heldLeftForReview: number | null = null;
  try {
    const heldLeft = await pool.query(
      `${CURATOR_SCOPED_REGIONS_CTE}
       SELECT count(*)::int AS n FROM experiences e
        WHERE e.category_id = $2 AND ${heldWaitingSql()} AND ${scopeFilter}`,
      [userId, categoryId],
    );
    heldLeftForReview = heldLeft.rows[0].n as number;
  } catch (error) {
    // Literal format string with the id as an argument, like the loop's catch.
    console.error('[publish-waiting] held count failed for category %d:', categoryId, error);
  }

  res.json({
    categoryId,
    published,
    refused,
    outOfScope,
    // Named in the response because a remainder nobody explained reads as a failure: the
    // batch left these behind on purpose, and the reply is where that is said. Not
    // because it is the number the panel will show. The panel counts the same kind for
    // the same category, but for nobody in particular — `waitingCountsByCategory` carries
    // no scope filter — so between that number and this one the only difference is the
    // filter twenty lines above, and for a region-scoped curator it is a real difference
    // by design. The panel's count can also fail on its own and print nothing.
    heldLeftForReview,
  });
}

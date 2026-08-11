/**
 * Publishing the unread points and works under an object — the named ones, or
 * all of them.
 *
 * Its own module rather than a function inside `publishController.ts`,
 * because the question it answers ("which rows does a publish reach") is a
 * whole one on its own and has no dependency on the transaction shell that
 * calls it: no lock, no refusal, no audit row, no scope check — only the
 * client already inside somebody else's transaction and the id.
 */

import type { PoolClient } from 'pg';

/**
 * Publish the unread points and works — the named ones, or all of them.
 *
 * Which kinds run is decided from the ids alone, not from whether this is an
 * object or a contents publish — that decision (whether the experience's own
 * row is also touched) is the caller's to make, and is orthogonal to this
 * one. `anyNamed` false means neither array was sent, which covers an object
 * publish and a bare `{ contentsOnly: true }` publish identically: both mean
 * "every pending row of both kinds", differing only in whether the
 * experience's own state comes with it. `anyNamed` true means the caller
 * named at least one kind, and named exactly what was named: `{ treasureIds }`
 * alone must not touch a single location, or a curator answering the
 * `contents` card's treasure count would silently also publish points nobody
 * asked about.
 *
 * `curation_state = 'pending'` on every statement keeps the counts honest:
 * `rowCount` then reports what this call changed rather than how many ids the
 * caller happened to send. The named predicate is appended rather than written
 * as `($2::int[] IS NULL OR …)`, so each statement asks one question and each
 * parameter has one job.
 */
export async function publishContents(
  client: PoolClient,
  experienceId: number,
  locationIds?: number[],
  treasureIds?: number[],
): Promise<{ locationsPublished: number; treasureLinksPublished: number; treasuresPublished: number }> {
  const anyNamed = locationIds !== undefined || treasureIds !== undefined;

  let locationsPublished = 0;
  if (locationIds !== undefined || !anyNamed) {
    const named = locationIds !== undefined;
    // `missing_since IS NULL` matches the `contents` card exactly
    // (`lifecycleController.ts`'s query carries it on the same table), and the
    // two have to move together: the card is what asks the question this
    // statement answers, so a row the card never showed must not be something
    // this can publish, and a row it shows must be something this reaches.
    //
    // Not merely cosmetic, and not "publishing it changes nothing on screen"
    // either — that is true only for as long as the point stays withdrawn.
    // `locationWriter`'s "offering it again" arm clears `missing_since` and
    // deliberately leaves `curation_state` alone, so a point published while
    // withdrawn reappears on the map already marked `verified`: a coordinate no
    // card ever put in front of a curator, recorded as one a curator passed.
    const result = await client.query(
      `UPDATE experience_locations SET curation_state = 'verified'
        WHERE experience_id = $1 AND curation_state = 'pending'
          AND missing_since IS NULL
        ${named ? 'AND id = ANY($2::int[])' : ''}`,
      named ? [experienceId, locationIds] : [experienceId],
    );
    locationsPublished = result.rowCount ?? 0;
  }

  // A withdrawal deferred against one of these points would be released here,
  // and Task 6 of this branch is what defers one. Nothing does yet, so there is
  // nothing to release and no statement to write — see the note after the COMMIT
  // for why that is also the reason nothing is placed.

  let treasureLinksPublished = 0;
  let treasuresPublished = 0;
  if (treasureIds !== undefined || !anyNamed) {
    const named = treasureIds !== undefined;
    const args = named ? [experienceId, treasureIds] : [experienceId];
    // Two states from one id, because they are two facts: the link says this
    // work has been passed as being *here*, the work says it has been passed at
    // all — "checked once, globally" (ADR-0025 decision 2). A reader's treasure
    // list gates both, so publishing one and not the other would leave the
    // card's count unanswered.
    const links = await client.query(
      `UPDATE experience_treasures SET curation_state = 'verified'
        WHERE experience_id = $1 AND curation_state = 'pending'
        ${named ? 'AND treasure_id = ANY($2::int[])' : ''}`,
      args,
    );
    treasureLinksPublished = links.rowCount ?? 0;

    // Scoped through this experience's own links, so a request cannot publish a
    // work by naming an id that has nothing to do with the object the caller's
    // scope was checked against.
    const works = await client.query(
      `UPDATE treasures SET curation_state = 'verified', updated_at = NOW()
        WHERE curation_state = 'pending'
          AND EXISTS (
            SELECT 1 FROM experience_treasures et
             WHERE et.treasure_id = treasures.id AND et.experience_id = $1
               ${named ? 'AND et.treasure_id = ANY($2::int[])' : ''}
          )`,
      args,
    );
    treasuresPublished = works.rowCount ?? 0;
  }

  return { locationsPublished, treasureLinksPublished, treasuresPublished };
}

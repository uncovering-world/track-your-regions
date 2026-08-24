/**
 * What an experience's lifecycle means to the people looking at it.
 *
 * Four columns can take a row off a reader's screen, and each answers a
 * question none of the others do (ADR-0025's Negative consequences say so
 * explicitly: merging any two into one predicate is forbidden, because
 * collapsing two questions into one column would make it impossible to ask
 * about either separately again):
 *
 * | column | question | who answers it |
 * |---|---|---|
 * | `existence` | does it still stand? | the world |
 * | `admission` | does this catalogue accept it? | a category's rule (ADR-0024) |
 * | `experience_locations.missing_since` | does its source still offer this point? | the source |
 * | `curation_state` | has anyone looked at it? | a curator (ADR-0025) |
 *
 * The first two are set by curators (ADR-0020, narrowed by ADR-0021) and read
 * here. They are not symmetric, because the reasons behind them are not:
 *
 * - `former` — the source stopped listing it, but it is still standing. You can
 *   still go there, so it stays in every list and on the map; the card says so
 *   with a chip and nothing else changes.
 * - `lost` — it no longer exists. Offering it as somewhere to go would be a
 *   lie, so it leaves lists, map, search and counts. It does *not* leave a
 *   visit: someone who saw Palmyra before 2015 saw it, and a record of that
 *   cannot depend on the thing still standing.
 *
 * An object carrying only `missing_since` — flagged by a run, not yet judged —
 * looks completely ordinary here. That is the point of leaving both verdicts to
 * a curator: a source outage must not change what anyone sees.
 *
 * One of an experience's *locations* is filtered on `missing_since` even so —
 * `offeredLocationSql` below says why the two are not the same question.
 *
 * `curation_state` is the fourth, and `hidePendingSql`/`publishedContentSql`
 * below say why a gated source's unread rows get their own predicate rather
 * than reusing one of the first three.
 */

/**
 * Hides `lost` objects. `alias` is the `experiences` alias in the query.
 *
 * Written as a fragment rather than a boolean because it has to go into a
 * dozen queries that already build their WHERE by concatenation, and the one
 * that forgets it is the one that offers a demolished building as a
 * destination. Returned bare, without a leading `AND`: some callers push it
 * into a conditions array and some append it to a WHERE, and a fragment that
 * suits one reads wrong in the other.
 */
export function hideLostSql(alias = 'e'): string {
  return `${alias}.existence <> 'lost'`;
}

/**
 * Hides a row this category's own rule turned down (ADR-0024). `alias` is the
 * `experiences` alias in the query.
 *
 * A separate fragment from `hideLostSql` rather than one combined predicate,
 * because the two hide for unrelated reasons and are asked for separately: the
 * "show what is gone" affordance wants lost rows back, the curation queue wants
 * refused ones, and neither wants the other.
 *
 * It applies where `missing_since` deliberately does not, and the difference is
 * the difference between silence and a sentence. A run that stops seeing an
 * object may simply not have looked everywhere, so the note above leaves that
 * to a curator. A refusal is our own rule naming the object and turning it
 * down; re-running it gives the same answer, and a candidate that fails the
 * same rule is never created at all. A row that predates the rule has to end up
 * where a new one would, or the catalogue becomes the union of every rule the
 * importer has ever had — which is how a collection nobody calls the "Egyptian
 * Museum of Berlin" survived into a list of top art museums.
 *
 * Visits are untouched, as under ADR-0022. Someone who stood in the British
 * Museum stood in it, and that record cannot depend on which of our categories
 * currently claims the building.
 */
export function hideRefusedSql(alias = 'e'): string {
  return `${alias}.admission <> 'refused'`;
}

/**
 * Hides a point the source has stopped offering. `alias` is the
 * `experience_locations` alias.
 *
 * A location's `missing_since` is read here where an experience's is not, and
 * the reason is what the alternative used to be: a withdrawn point was
 * *deleted*, so it left every list and every map the moment a run stopped
 * seeing it. The row survives now — deleting it took the visit record with it
 * through the cascade — and this fragment keeps what a reader sees exactly as
 * it was. Nothing here is a verdict on the place; that question is still a
 * curator's, and the row is waiting for it.
 *
 * The line is not "visits are exempt", which would be the obvious reading and
 * is wrong. It runs between two kinds of statement:
 *
 * - **removing** what a reader asked to remove is unfiltered, because a record
 *   on a point they can no longer see could otherwise never be cleared. The
 *   lookup that resolves which experience a visit belonged to goes with it.
 * - **recording** a visit was unfiltered too, on the reasoning that a reader is
 *   acting on what they were just shown. ADR-0025 ended that: an id can be
 *   guessed, and under a gate the thing being hidden is the row's *existence*,
 *   so "they were shown it" stopped being an assumption the server may make and
 *   became one it has to check. A write that verifies nothing hands back a name
 *   and manufactures a record for a row nobody was offered — measured on this
 *   branch, `mark-all` then made a badge read *visited* while hiding a point the
 *   reader could see and had not been to. So the rule is now: **adding a claim
 *   requires the row to have been showable; removing one never does.**
 *   `offeredToReaderSql` and `linkedForReaderSql` are what "showable" means, in
 *   one place, because the writers that create these rows were each fixed once
 *   and each came back carrying a different subset of the predicates.
 *
 *   The class, not a list: **any statement that records a claim about a row and
 *   answers with something about that row** belongs here — a visit, a viewed
 *   work, a seen chip. An earlier version of this paragraph named four such
 *   writers and a reviewer immediately found the fifth (`markNewBadgesSeen`,
 *   which returns the ids it accepted and so confirms a row exists). Counting
 *   them invites exactly that, which is why the rule is stated by shape.
 * - **what the system decides on their behalf** carries the filter: every read
 *   that puts a point on screen, the per-user visited status included, and
 *   equally the count that infers from what remains whether the
 *   experience-level record should go. Both unmark handlers therefore hold an
 *   unfiltered DELETE and a filtered count, which is not an inconsistency but
 *   this line drawn through one handler.
 *
 * The per-user visited status is the case that shows why: a component the source
 * moved is a withdrawal plus an insert — a coordinate merely rewritten inside ten
 * metres is not, since ADR-0027 — so leaving withdrawn rows in would put the same
 * place on screen twice and disagree with every other count of it.
 *
 * Region placement applies the same predicate as a literal
 * (`regionAssignmentService.ts`) rather than calling this. It is in the service
 * layer, and importing a controller module there would be the first such import
 * in the codebase — a worse trade than one repeated predicate, which is why the
 * duplication is deliberate and noted at both sites.
 *
 * **`existence` joins it with the verdicts (ADR-0026).** A point a curator has
 * declared gone from the world must stay off the map even when the source starts
 * offering it again — and the source doing so is not hypothetical, it is the
 * flapping case of #543. Without this term the run's `returned` arm would clear
 * `missing_since`, and a demolished component would come back. It is the same pair
 * an experience already carries — `hideLostSql` beside the one-direction membership
 * restore — so the two layers answer the two questions the same way: a listing is
 * evidence about the source's list, never about whether the thing still stands.
 *
 * `source_membership` is deliberately *not* here, exactly as it is not in an
 * experience's reads: `former` says the source stopped listing it, and hiding on
 * that would let a curator's reading of a list remove a place that is still there.
 * What keeps a `former` point off the map is its `missing_since`, which the verdict
 * leaves standing.
 */
export function offeredLocationSql(alias = 'el'): string {
  return `${alias}.missing_since IS NULL AND ${alias}.existence <> 'lost'`;
}

/**
 * Where a reader is told an object is: the place nearest its own published
 * coordinate (ADR-0028 decision 2).
 *
 * An object carries a coordinate of its own and its places carry theirs, and the
 * two are independent answers to "where is this". #502 measured them disagreeing
 * by more than a kilometre for 106 objects and by up to 191 km, so a list row and
 * a map pin named different countries for the same site. This is the one rule
 * both now read, which is what makes them agree.
 *
 * Why the nearest place rather than the coordinate itself: the coordinate is often
 * a locator for a whole property rather than a place anyone can go to — UNESCO
 * leaves it empty on serial nominations and publishes a site point elsewhere — and
 * a reader planning a trip needs somewhere to arrive. Where the object's own
 * coordinate *is* one of its places, which is 1382 of 1604, the distance is zero
 * and this returns it unchanged.
 *
 * Why not "the coordinate when it matches a place within ADR-0027's ten metres,
 * and the medoid otherwise", which ADR-0028 first proposed: that rule is
 * discontinuous, and it was measured moving eight objects over 100 km because
 * their coordinate missed a place by a few hundred metres. UNESCO's point for
 * Mountain Railways of India sits 454 m from the Nilgiri line — plainly that
 * railway — and the tolerance called it a miss and sent the reader 2068 km to
 * Darjeeling.
 *
 * **Nearest in metres, on `geography`, never in degrees.** `<->` on
 * `geometry(Point,4326)` is planar: a degree of longitude counts the same as a
 * degree of latitude, and this catalogue holds 42 multi-place objects above 60°,
 * among them Struve Geodetic Arc's 34 points reaching 70.7°N, where a degree of
 * longitude is a third of a degree of latitude. Measured: degree ordering picks a
 * different place for six objects and in every one of them sends the reader
 * *further* — 13.6 km instead of 12.7 for the Pico Island vineyards, 2.1 instead
 * of 1.5 for the Churches of Chiloé. It is also the rule the rest of the
 * repository already follows (`locationIncoming`'s `metresBetween`, and the medoid in
 * `resolveMainPoint`, which scales longitude by cos(lat) for this same reason), and
 * the cast is what makes the answer dateline-safe rather than 358° wrong.
 *
 * **`el.id` breaks ties, because the two subqueries below are two evaluations.**
 * The fragment is interpolated twice, once per axis, and each is its own SubPlan —
 * so without a total order two places equidistant from the anchor could give the
 * longitude of one and the latitude of the other, a coordinate at neither of them.
 * Ties themselves are ordinary: seven objects have one today — the Pico Island
 * vineyards' two places 12719.095 m from their anchor, Iwami Ginzan's six at
 * 657.137 m, the Western Ghats' six at zero. In all seven the tied places share a
 * coordinate, a source having listed one point under several names, so either row
 * answers with the same position and nothing is wrong yet. What the key buys is
 * that a source tying two *different* points cannot answer with a coordinate at
 * neither, and that a position cannot move between two reads of the same row.
 *
 * The places considered are the ones this caller may see, which is why the gate on
 * unread rows is a parameter rather than a constant: the caller names the
 * placeholder its own query binds `maySeeUnread` to, which is how
 * `experienceLocationController` already gates this same table for this same
 * reader. `getExperience` relaxes `curation_state` for a curator whose scope
 * reaches the row (ADR-0025), and a curator previewing a pending object has to be
 * shown where publishing will put it — that preview is the whole point of the
 * queue in ADR-0028 decision 3, and with the gate hard-coded every place would be
 * filtered out and the preview would fall back to the anchor: the one value the
 * curator is deciding against. A point
 * its source stopped offering or one a curator recorded as gone stays excluded for
 * everyone.
 *
 * Every object in the catalogue has a coordinate of its own, so the `COALESCE` is
 * for the object with no visible places rather than a missing anchor: it stays
 * where its source put it rather than losing its position.
 *
 * Costs 25 ms on a whole-region read: Europe's 661 experiences and the 3725
 * places under them go from 19 ms to 44 ms, of which the `geography` cast is
 * 16 ms — the price of a distance in metres, paid once per region and cached for
 * five minutes by the reader's query. Two scalar subqueries rather than a lateral
 * join because the two shapes measured 44 ms and 42 ms, and this one drops into a
 * select list without touching a caller's FROM or GROUP BY. Not because the
 * planner merges the two evaluations: it does not, which is what the tiebreaker
 * above is for.
 */
export function readerPositionSql(alias = 'e', maySeeUnreadParam?: string): string {
  const unreadGate = maySeeUnreadParam
    ? `(${maySeeUnreadParam}::boolean OR ${publishedContentSql('el')})`
    : publishedContentSql('el');
  const nearestPlace = `(SELECT el.location FROM experience_locations el
      WHERE el.experience_id = ${alias}.id
        AND ${offeredLocationSql()} AND ${unreadGate}
      ORDER BY el.location::geography <-> ${alias}.location::geography, el.id
      LIMIT 1)`;
  return `ST_X(COALESCE(${nearestPlace}, ${alias}.location)) as longitude,
      ST_Y(COALESCE(${nearestPlace}, ${alias}.location)) as latitude`;
}

/**
 * Columns a card needs to label what it is showing.
 *
 * `existence` travels even where `lost` rows are filtered out: the same select
 * feeds visit history, where they are not. `missing_since` travels for a
 * different reason — a curator correcting a verdict has to send the row as they
 * saw it, flag included, and inferring it from the verdict would be an
 * assumption where the truth is one column away.
 */
export function lifecycleSelectSql(alias = 'e'): string {
  return `${alias}.source_membership, ${alias}.existence, ${alias}.missing_since`;
}

/**
 * Should this request see objects that no longer exist?
 *
 * Only when it asks — `?includeLost=true` — and the ask is meaningful in
 * exactly two places: a visit history, and a list a user has deliberately
 * unfiltered. Everywhere else the parameter is simply absent, which is the
 * safe default rather than a policy each caller has to remember.
 */
export function includeLost(query: Record<string, unknown>): boolean {
  return query.includeLost === 'true' || query.includeLost === true;
}

/**
 * The fourth question a read has to ask: has anyone looked at this row?
 *
 * `pending` means a gated source wrote it and no curator has passed it
 * (ADR-0025). It is not "wrong", "gone" or "turned down" — the other three
 * helpers above answer those — so it gets its own predicate and its own
 * relaxation: a curator following a queue item through to an object's page is
 * served the row, while every list, count and feed refuses it (the three
 * by-id reads under `/api/experiences/:id` do the widening; nothing else
 * does — `maySeeUnreadExperience` in `experienceScope.ts` is where that
 * boolean comes from).
 *
 * A fragment for the same reason `hideLostSql` is one: it goes into queries
 * that build a WHERE by concatenation, some bare and some already inside a
 * conditions array, so it is returned bare too.
 */
export function hidePendingSql(alias = 'e'): string {
  return `${alias}.curation_state <> 'pending'`;
}

/**
 * The same question, asked of a content row — a location, a treasure link, a
 * treasure — rather than the experience that holds it.
 *
 * A separate fragment from `hidePendingSql` rather than a shared one taking
 * any alias, because a call site should read as what it gates: a content
 * row's state is its own, and ADR-0025's split is load-bearing precisely
 * because of this — a published museum may hold newly-written, unread
 * paintings, and gating only the museum's row would publish them the moment
 * a run wrote them, through the one table the gate never reached.
 */
export function publishedContentSql(alias: string): string {
  return `${alias}.curation_state <> 'pending'`;
}

/**
 * Everything that must be true of an *experience* before a reader may claim
 * anything about it: the catalogue accepts it, and a curator has passed it.
 *
 * The experience-level half of the two composites below, and the whole
 * predicate for the two writers whose claim is about an experience rather than
 * a point or a work — `markVisited` and `markNewBadgesSeen`. It exists because
 * the pair kept being spelled by hand: the composites carried it correctly, the
 * two experience-level writers spelled it themselves, and a review found one of
 * them carrying `hidePendingSql` alone — a guessed id for a refused row
 * answering 200, echoing the row's name, and writing a visit that
 * `getVisitedExperiences` then serves in full for ever, since that read exempts
 * `admission` on purpose (ADR-0022) and nothing else clears the row.
 *
 * That is the sixth time on this branch a predicate in this family was written
 * as a subset of itself. A conjunction spelled in one place cannot be spelled
 * partly.
 */
export function experienceOfferedToReaderSql(alias = 'e'): string {
  return `${hideRefusedSql(alias)} AND ${hidePendingSql(alias)}`;
}

/**
 * Everything that must be true of a location before a reader may claim a visit
 * to it: the catalogue accepts its experience, a curator has passed that
 * experience, the source still offers the point, and a curator has passed the
 * point.
 *
 * Composed rather than left to each call site, and the reason is a measurement
 * rather than taste: the four writers that create these rows were each fixed
 * once during ADR-0025's review, and three of them came back carrying three of
 * the four predicates — a different one missing each time. Four separate calls
 * invite three. One call cannot be partly written.
 *
 * The **experience's** `existence` is deliberately absent, matching the by-id reads:
 * a place that no longer stands is still somewhere a traveller went, and the record
 * of having been there is the one thing that outlives it.
 *
 * A **point's** own `existence` does appear, since ADR-0026, because it arrives
 * inside `offeredLocationSql` — and the two are not the same claim. The exemption
 * above is about the object a visit is remembered against; this is about whether a
 * component is somewhere a reader may be sent, and a curator who has said a
 * component is demolished has answered that. The visit is untouched either way:
 * removing one runs unfiltered, as the note on that fragment sets out.
 */
export function offeredToReaderSql(experienceAlias = 'e', locationAlias = 'el'): string {
  return [
    experienceOfferedToReaderSql(experienceAlias),
    offeredLocationSql(locationAlias),
    publishedContentSql(locationAlias),
  ].join(' AND ');
}

/**
 * Membership a reader can see: this region holds a point of the object that this
 * reader may be shown, or a curator put the object here by hand.
 *
 * `experience_regions` is a denormalisation of where an object's *points* are,
 * and placement writes it from every offered point — unread ones included, on
 * purpose. ADR-0025 decision 5 holds contents by writing them invisible rather
 * than by withholding them, and a `pending` point that went unplaced would leave
 * the region curator who has to answer for it with an empty queue. So the roll-up
 * says "this object is here" on the strength of a row no reader is shown, and a
 * bare `JOIN experience_regions` has no way to tell the two apart.
 *
 * Malta's Ċentrali is the shape of it. The Megalithic Temples are six temples
 * across four of Malta's five regions, and Ċentrali is the one they are not in.
 * Let a gated run add a seventh component there: the region's list gains the
 * site, the `location_count` beside it reads through `publishedContentSql` and
 * says none of its points are on offer here, the map draws no pin, and opening
 * the site lists six temples elsewhere on the island. A list entry with no pin,
 * in a product where the list and the map are two views of one set.
 *
 * Why the read rather than placement: the write has to place the pending point,
 * for the reason above. So the reader's side asks the question the roll-up cannot
 * answer — is any of the points that put this object here one this reader may
 * see — with the same pair every other reader-facing read of a point uses.
 *
 * A **manual** row is exempt, and that is not a hole. A curator adding an object
 * to a region is not deriving membership from a point; they are saying it belongs
 * here, which is how an object whose only point falls just outside the boundary
 * (#469) or lies offshore (#470) reaches a region's list at all, and that claim
 * carries no `experience_location_regions` row to find. `assignment_type` is
 * nullable with a default of `auto`, so a row naming no type is gated like the
 * placement rows it came in with rather than exempted like a curator's.
 *
 * **The exemption is permanent, and covers a row that placement wrote.**
 * `assignExperienceToRegion` upserts — `DO UPDATE SET assignment_type = 'manual'`
 * — so a curator putting a rejected-but-auto-placed object back into a region
 * flips that row, and placement's clear touches `auto` rows only, so it survives
 * every later run. The point that originally placed it can then be withdrawn,
 * called gone, or rewritten unread, and this predicate still short-circuits. That
 * is the reading rather than an oversight: the case the exemption exists for has
 * no backing point *by construction* — a point just outside the boundary is in no
 * `experience_location_regions` row for the region it was claimed into — so a
 * rule that trusted a manual row only while a visible point stood behind it would
 * refuse exactly the claims it is meant to keep. What such a row does not produce
 * is the pinless row this predicate exists to prevent: the marker batch answers
 * with the object's places wherever they are, since `representablePlaces` falls
 * back to the out-of-region ones. The residue is an object with no visible point
 * *anywhere* held in a region by a manual claim, which is the shape #547's third
 * assertion is being written to catch, and the remedy for a claim that should not
 * stand is `removeExperienceFromRegion`, which deletes a row of either type.
 *
 * The curator's side is untouched: the queue's own scope reads
 * (`experienceScope.ts`, `reviewQueueContext.ts`, `publishWaitingController.ts`)
 * go on reading the roll-up whole, which is what puts the unread point in front
 * of the curator who is being asked about it.
 */
export function readerRegionMembershipSql(experienceIdExpr = 'e.id', membershipAlias = 'er'): string {
  return `(${membershipAlias}.assignment_type = 'manual' OR EXISTS (
        SELECT 1 FROM experience_location_regions mem_elr
        JOIN experience_locations mem_el ON mem_el.id = mem_elr.location_id
        WHERE mem_elr.region_id = ${membershipAlias}.region_id
          AND mem_el.experience_id = ${experienceIdExpr}
          AND ${offeredLocationSql('mem_el')}
          AND ${publishedContentSql('mem_el')}))`;
}

/**
 * The same question for a work: may a reader claim to have looked at this one,
 * in this experience? `experience_treasures` is the row that says the work is on
 * show here, so it carries its own state beside the container's — a published
 * museum can hold a link nobody has passed.
 *
 * `treasures.curation_state` is not here: it belongs to the work globally rather
 * than to its being shown in this venue, so a call site that needs it says so
 * with `publishedContentSql('t')` beside this — which the treasure lookup does.
 */
export function linkedForReaderSql(experienceAlias = 'e', linkAlias = 'et'): string {
  return [
    experienceOfferedToReaderSql(experienceAlias),
    publishedContentSql(linkAlias),
  ].join(' AND ');
}

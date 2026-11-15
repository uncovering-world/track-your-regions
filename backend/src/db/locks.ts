/**
 * How a writer locks an object, and in what order.
 *
 * Its own module rather than a line in `db/index.ts`: that module builds the
 * pool, and every test of a curator write mocks it wholesale — a constant living
 * there would come back `undefined` inside those tests while the suite stayed
 * green. Nothing here imports `pg`, so any layer can read it.
 *
 * **Order first: the object, then its points and works.** An audit row's foreign
 * key reaches `experiences` even from a handler that never names it, so a writer
 * that took a point first and logged afterwards was holding one row and waiting
 * for the other.
 *
 * **Two places or more: a whole before its parts, the rest by id.** A writer
 * that locks more than one place locks them in one order
 * (`placeLockOrderSql`): the fewer wholes a place stands under, at any depth,
 * the earlier, and among places under as many wholes the lower id first. A
 * whole stands under fewer wholes than its parts, a loop of records aside
 * (`place_ancestors()`), so a site comes
 * before its parts whatever their ids, which is the order the site's run
 * needs (below); and since the order is one sort key, two writers locking
 * overlapping sets never take two of them the other way round. A part's id is
 * often lower than its site's: a place adopted as a component, or nested by a
 * curator, existed first. `lockTwoExperiences` (a curator's word on a part, a
 * merge, its undo and a merge proposal's answer), `lockPartsAndRegionKeys` and
 * missing detection's marks (`markMemberships`) read it. The wholes above a place are read before the locks are taken, so a
 * part relation committed in between can leave two writers ordered by a
 * relation one of them no longer sees; Postgres ends such a cycle by aborting
 * one.
 *
 * Who it binds, exactly: **a transaction that locks a row of an existing object's
 * contents** — `experience_locations` or `experience_treasures`. Those are the
 * rows a lock-holder waits for, so they are the ones that can be the far side of
 * a cycle. Under it: every curator write that answers, corrects or publishes a
 * point or a work, and the sync's location writer, whose transaction is the
 * longest of them.
 *
 * What sits outside it is named rather than counted — a count above a list is
 * what goes stale when something joins the list below, which is how this
 * paragraph was wrong once already — and each is outside for its own reason
 * rather than by oversight:
 *
 * - `upsertVenueTreasures` links works to a venue and then retires that venue's
 *   curator pass, running each of those statements on the pool with no `BEGIN`.
 *   Each is its own transaction, so it holds nothing across them: it can wait
 *   for a lock, never be half of a cycle. The two of them that write the
 *   venue's membership — the pass's decay and the held-proposal pointer — are
 *   the exception, and run in one transaction that takes the venue first,
 *   under the rule and for the reason the snapshot paragraph below gives: each
 *   chooses its rows by the membership's state. The one transaction inside it
 *   before that —
 *   `reconcileLinks` (ADR-0044), which restores and marks the venue's links in
 *   one `BEGIN` — is under the rule for exactly that reason, and takes the object
 *   first.
 * - `createManualExperience` inserts the object and then its point in one
 *   transaction, and takes no separate lock: its object is new, not existing,
 *   and the INSERT's own row lock *is* the "object first" the order asks for,
 *   since no other transaction can hold a row of an object that did not exist
 *   when it began. Outside the order's statement, then, but not outside the
 *   token: `insertCuratedExperience` hands back the token for that row lock,
 *   and the point insert that follows spends it like every other point write.
 * - Missing detection's mark (`flagMissingExperiences`) and the picture repair
 *   (`writeFoundPicture`, `clearUnshowablePicture`) each write `experiences` in
 *   one statement on the pool, with no `BEGIN`. The statement's own row locks
 *   last only as long as it does, so it can wait for an object's lock and never
 *   be half of a cycle — which is why neither takes `lockExperience`'s token.
 * - `assignExperienceToRegion` and the rejection writers touch
 *   `experience_regions` and `experience_rejections`. A refresh (below) may
 *   wait for one of those rows, and none of these waits for anything after
 *   writing it: their only other reach into `experiences` is the audit row's
 *   key share, and the mode below is chosen so that never conflicts. So none
 *   of them is ever half of a cycle, and none takes a place's region keys.
 * - `assignRegionsForExperiences` — placement — is the one outside the rule that
 *   does reach the contents: its INSERT into `experience_location_regions`
 *   key-shares the point rows themselves. Nothing but a place's own delete
 *   waits for those key shares, since a point's only key column is its id,
 *   which no writer changes. Its order is point rows, then keys, then place
 *   rows: its last step, `refresh_place_regions()`, may wait for a place's
 *   keys, and no key holder waits for what placement holds by then, since
 *   none writes `experience_location_regions`. Its own reach into
 *   `experiences` is another key share, compatible with the mode below.
 *   Placement is also always post-commit on the curator routes.
 * - `assignExperiencesToRegions` — the admin's full rebuild of a world view —
 *   reaches the contents the same way, and for longer: it clears and rebuilds
 *   in one transaction (#1152), so the key shares its inserts take on the
 *   points, and the row locks of the point rows it deleted, are held until it
 *   commits, seconds on the largest world view. Its statements run in
 *   placement's order: the point rows cleared and placed, then every place's
 *   keys and rows in one refresh. So it and a run's placement of the same
 *   objects wait for each other in one direction only.
 * - `refresh_place_regions()` writes a place's rows of `experience_regions`,
 *   and those of the wholes it is a part of, from inside the writers above: placement
 *   calls it last, and the triggers that follow a point's state and a part
 *   relation call it in the curator's own transaction, under the object's lock
 *   (ADR-0197). It takes no object lock: it locks the places it rewrites, one
 *   advisory key per place among 1,024 under 1197, in key order
 *   (`lock_place_regions()`), before it computes their rows, so a publish and
 *   a placement refreshing one whole take turns, and the later one computes
 *   with the earlier one's points. The order is objects, then keys, then
 *   `experience_regions` rows. A refresh holding a key may wait for a row,
 *   so a writer that writes a place's row and then refreshes it in the same
 *   transaction takes the place's keys before the row: withdrawing a
 *   curator's row (`unassignExperienceFromRegion`) and a merge or its undo
 *   (`placeMerge.ts`, after both object locks). A key held is taken again at
 *   no wait. A refresh never waits for an object lock, since every writer
 *   takes its object locks before the writes that fire the triggers and
 *   placement takes none; a writer that writes a part's row after such a
 *   write takes the part's lock before it too (`lockPartsAndRegionKeys`,
 *   below). Once its keys are held it reads the places it
 *   reaches again, and takes the keys a part relation committed meanwhile
 *   adds. Two transactions that take keys out of order that way, or that each
 *   refresh twice with keys in different orders, can still meet in a cycle;
 *   Postgres aborts one, as with the identity registry's keys (ADR-0143).
 * - `refresh_whole_leaves()` writes the `whole_leaves` rows of a whole
 *   (ADR-0206) under the same keys: those of the places changed and of every
 *   whole above them at any depth, in key order, read again until the reach
 *   holds still, before it computes and writes its rows. So the order is the
 *   region refresh's, objects, then keys, then `whole_leaves` rows, and only
 *   it writes those rows. Its triggers fire before the region triggers on
 *   the same statement, and its keys are a superset of theirs, so the region
 *   refresh after it takes none out of order. Unlike the region refresh it
 *   follows a point's INSERT too (`trg_place_leaves_point_insert`), so every
 *   point insert takes its place's keys, and its wholes', inside the
 *   inserting writer's transaction. `createManualExperience` takes only its
 *   new place's key, which another place's refresh may hold; it can wait for
 *   it and never be half of a cycle, since nothing waits for a place that did
 *   not exist. The site's run (`writeExperienceLocations`) is the longest such
 *   transaction, and after its point writes it names each part for its point,
 *   writing the parts' `experiences` rows (`followTheirPoints`); a curator
 *   holding a part and writing its point asks for the site's key. So the run
 *   takes its parts' locks, in the order above, and then in one ordered pass the
 *   keys of the site, its parts and every whole above any of them, before its
 *   first point write (`lockPartsAndRegionKeys`, `db/experienceWriter.ts`). A
 *   merge or its undo takes the same pair for both places, after both object
 *   locks, since its undo names their parts after moving their points. A
 *   merge never takes a whole (ADR-0203), and it cannot cycle with a site's
 *   run: asked to merge a site with its own part, it locks the site first, as
 *   the run does, and refuses; merging a part with another place, it waits
 *   only for region keys, and the run takes those, and the part's rows, only
 *   once it has the part's lock, which the merge holds until it commits. A
 *   place the same transaction makes a part, after those locks, is written
 *   unlocked after keys; that cycle is the out-of-order one above, which
 *   Postgres ends by aborting one, and a run so aborted writes the site again
 *   at its next run.
 * - `parts_follow_records()` writes `experience_parts` from inside a write of
 *   a record in a whole (ADR-0198), so the refresh a part relation sets off
 *   runs in that record writer's transaction, after its object locks: the
 *   World Heritage run's `part_site_components()` under the site's lock,
 *   which writes no `experience_regions` row before it, and a merge or its
 *   undo, whose record moves remake relations of both places, of the parts of
 *   either and of the wholes either is a part of. The merge takes the keys of
 *   all of those in one ordered pass before its first row (`lockPartsAndRegionKeys`),
 *   so every refresh its moves set off takes keys it already holds. The
 *   derivation itself takes no lock and writes a relation only under the
 *   object locks of the record's writer.
 * - A curator's word on a part (`partRecordController.ts`, #2118) refuses a
 *   loop and a chain over four places by reading `experience_parts` beyond
 *   the two places it locks, so two words on disjoint pairs could each pass
 *   and make a chain too deep together: with B→Z→C standing, A→B and C→D
 *   are four places each and take no region key in common, and both leave
 *   A→B→Z→C→D, five. Every
 *   such word takes one transaction-level key first (`PART_WORDS_LOCK`),
 *   after its two object locks and before the region keys, and reads the
 *   chains in the statement after it: a second word waits for the first and
 *   is judged on what it committed. One key serialises them all, since they
 *   are a curator's presses, seconds apart at most. No other writer takes it,
 *   and none waits for it while holding what a holder waits for: the holder's
 *   objects are locked before it, and the region keys after it are never
 *   held by a writer that then asks for an object.
 *
 * **Then the mode: `FOR NO KEY UPDATE`, not `FOR UPDATE`.** It self-conflicts, so
 * two writers on one object still serialise, and it still blocks an UPDATE or a
 * DELETE of the row — but it does *not* conflict with the `FOR KEY SHARE` a
 * foreign key takes on the parent, which is what an INSERT into
 * `experience_locations` needs while its own transaction holds the object. No
 * writer here changes a key column of `experiences`, so nothing gives up anything
 * it had.
 *
 * **And the snapshot: the lock in one statement, the read in the next.** In
 * READ COMMITTED a statement's snapshot is taken when it starts, before it
 * waits for a row lock, and once the lock is granted only the locked row is
 * re-read at its latest version (EvalPlanQual); a row of another table the
 * same statement joins or asks `EXISTS` of — a membership, a point — is still
 * the snapshot's. Measured on 2026-09-05: a `SELECT … FOR NO KEY UPDATE OF e`
 * that waited for a publish answered `false` to "has a membership of `e` been
 * passed?" after that publish had committed; the next statement on the same
 * connection answered `true`. So a writer that decides anything on a
 * membership under the object's lock takes the lock in a statement of its own
 * (`lockExperience`, `db/experienceWriter.ts`) and reads in
 * the next, whose snapshot postdates whatever the lock holder committed: the
 * object upsert's hold and `before` snapshot, and the curator's publish,
 * decline and admission verdict. On `main` the same reads were of the locked
 * row itself and were fresh; moving the state to `source_records`
 * (#822) is what made the second statement necessary. Folding the lock into
 * the writing statement's own sub-select is not the same thing: it waits, but
 * it chooses its rows under the pre-wait snapshot, and a membership a publish
 * moved into the `WHERE` during the wait is skipped outright — never having
 * qualified, it is never re-checked. Measured the same day: a decay written
 * that way updated 0 rows for a membership the publish had just passed; lock
 * first, then the same UPDATE, updated 1. So the treasure writer's pointer and
 * decay run in a transaction of their own that takes the museum first.
 *
 * In `db/` because the sync services take it too, and a service may not import
 * a controller module. The statements that take it are `lockExperience` and
 * `lockSourcedExperience` (`db/experienceWriter.ts`, ADR-0069), whose token a
 * write under the lock requires: the object's, its points' and its works'
 * alike, so the order above is one the curator's writes cannot break.
 */
export const OBJECT_LOCK = 'FOR NO KEY UPDATE';

/**
 * The order places are locked in, as `ORDER BY` terms over the place id `id`:
 * the fewer wholes above it the earlier, then the lower id. The rule above,
 * § Two places or more.
 */
export function placeLockOrderSql(id: string): string {
  return `(SELECT count(*) FROM place_ancestors(ARRAY[${id}])), ${id}`;
}

/**
 * The transaction-level advisory key every curator's word on a part takes
 * (`pg_advisory_xact_lock(PART_WORDS_LOCK, 0)`), after its object locks and
 * before the region keys: the order above, § A curator's word on a part.
 */
export const PART_WORDS_LOCK = 2118;

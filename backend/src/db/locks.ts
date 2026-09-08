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
 *   transaction. The INSERT's own row lock *is* the "object first" the rule asks
 *   for, and no other transaction can hold a row of an object that did not exist
 *   when it began.
 * - `assignExperienceToRegion` and the rejection writers touch
 *   `experience_regions` and `experience_rejections`, which no lock-holder waits
 *   for; their only reach into `experiences` is the audit row's key share, and
 *   the mode below is chosen so that never conflicts.
 * - `assignRegionsForExperiences` — placement — is the one outside the rule that
 *   does reach the contents: its INSERT into `experience_location_regions`
 *   key-shares the point rows themselves. It can therefore be *waited for* by a
 *   transaction that changes a point's key column, which the location writer's
 *   ordinal parking does. It never waits in turn: its own reach into
 *   `experiences` is another key share, compatible with the mode below, so it
 *   cannot be the far side of a cycle. Placement is also always post-commit on
 *   the curator routes, which is what keeps that true rather than an accident.
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
 * (`SELECT id FROM experiences WHERE id = $1 FOR NO KEY UPDATE`) and reads in
 * the next, whose snapshot postdates whatever the lock holder committed: the
 * object upsert's hold and `before` snapshot, and the curator's publish,
 * decline and admission verdict. On `main` the same reads were of the locked
 * row itself and were fresh; moving the state to `experience_kind_memberships`
 * (#822) is what made the second statement necessary. Folding the lock into
 * the writing statement's own sub-select is not the same thing: it waits, but
 * it chooses its rows under the pre-wait snapshot, and a membership a publish
 * moved into the `WHERE` during the wait is skipped outright — never having
 * qualified, it is never re-checked. Measured the same day: a decay written
 * that way updated 0 rows for a membership the publish had just passed; lock
 * first, then the same UPDATE, updated 1. So the treasure writer's pointer and
 * decay run in a transaction of their own that takes the museum first.
 *
 * In `db/` rather than beside the lifecycle fragments because the sync services
 * need it too, and a service importing a controller module would be the first
 * such import in the codebase — the same boundary `regionAssignmentService`
 * respects by repeating a predicate rather than reaching upwards.
 */
export const OBJECT_LOCK = 'FOR NO KEY UPDATE';

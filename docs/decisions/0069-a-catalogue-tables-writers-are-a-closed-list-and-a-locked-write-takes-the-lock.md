# ADR-0069: A catalogue table's writers are a closed list, and a locked write takes the lock

**Date:** 2026-09-25
**Status:** Accepted
**Issue:** [#791](https://github.com/uncovering-world/track-your-regions/issues/791)

---

## Context

`experiences` is written from nine modules outside the seed: six curator controllers
(`curationController`, `acceptSourceController`, `curatorRefusalController`,
`lifecycleController`, `locationEditController`, `publishController`) and three sync modules
(`experienceUpsert`, `missingDetection`, `pictureRepair`). `experience_locations` is written from
eleven. Each writer carries its own copy of the table's invariants:

- **The lock order.** `db/locks.ts` states it in prose: the object first, in a statement of its
  own, then its points and works. Every curator writer re-implements it with
  `SELECT … FROM experiences WHERE id = $1 ${OBJECT_LOCK}`. Nothing checks that a write to the row
  comes after that statement, on the same connection.
- **The picture rule.** Every writer of `image_url` refuses a host outside `PICTURE_HOSTS`
  (ADR-0043). Each does so through its own call to `isCommonsPictureUrl` or
  `isDisplayablePictureUrl`.
- **The stamp.** There is no trigger on `updated_at`, and every writer writes `updated_at = NOW()`
  by hand.

Nothing in the code reports a copy that misses one. PR #525 found reads missing the refused-row
predicate one review at a time, #679 found the writers of `regions.geom` the same way, and #688
is a writer that does not bump `tile_version`. ADR-0035 answered one such invariant with a
trigger. The principle recorded beside it, that a writer owns its invalidation, has no structure
holding it.

## Decision

**A catalogue table's writers are a closed list, and nothing else inserts into or updates it.**
For `experiences` the list is:

- `backend/src/db/experienceWriter.ts`, where every curator write the product makes is a named
  function: the edit, a lifecycle verdict, a recorded decision, the anchor following its one point,
  and the manual create. Each keeps its statement and the reasoning that belongs to the
  statement; the decision about *whether* to write stays with the caller.
- The run's three writers, each already a single-purpose module:
  - `services/sync/experienceUpsert.ts`, whose one statement writes the place and its
    membership together, which is how the hold is decided (#519, #822);
  - missing detection's mark (`missingDetection.ts`);
  - the picture repair (`pictureRepair.ts`).
- The seed.

Splitting the upsert's statement to put it in the curator module would break the atomicity that
statement exists for. Moving the other two would only rename their paths.

**A write that assumes the object's lock takes the lock as an argument.** `lockExperience(client,
id, columns)` runs the `OBJECT_LOCK` statement on the caller's connection. It returns the row it
read together with a `LockedExperience`, a token whose type only that function can produce. Every
write made under the lock requires the token, so the type checker refuses an update issued
before the lock or without it. A write outside the lock rule, as `db/locks.ts` names them, takes
no token and says why in its own docblock:

- the sync upsert's insert, which is its own row lock;
- missing detection's bulk mark;
- the picture repair.

**The lint holds the list.** An `INSERT INTO` or `UPDATE` of the table anywhere but those
modules fails the backend lint (`EXPERIENCE_WRITE_RULES` in `backend/eslint.config.mjs`), as a
spelled-out reader predicate does. The reader predicates were declared once in
`db/readerPredicates.ts` by the first slice of #791.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A generic `writeExperience(lock, sql, params)` passthrough | It enforces the lock but leaves every statement where it was. A lint on `UPDATE experiences` would then be evaded by passing the text through the function, so the table would still have nine writers under one name |
| Exactly one module, with the run's writers moved into it | The upsert's statement writes the place and its membership in one CTE, and its hold is decided on that one snapshot. A second module holding half of it breaks the hold, and one holding both has the membership's writes in the place's writer. Missing detection and the picture repair are single-purpose already, so moving them only changes paths and the specs that mock them |
| A repository object per table (`ExperienceRepository.update(id, patch)`) | It hides the SQL the codebase keeps visible (ADR-0064: row types are generated, queries stay SQL). The curator's per-field claims and the held-proposal assignments are statements, not patches |
| Triggers for every invariant, as ADR-0035 did for geometry | They fit an invariant the database can compute, such as clearing a derived outline. They do not fit the lock order, which is about the caller's transaction, or the picture rule, which lives in `@tyr/shared` (ADR-0065) |
| A runtime check that the lock was taken | It fails in production rather than at compile time, and costs a query per write |

## Consequences

**Positive:**
- A write that forgets the lock does not compile.
- The table's invariants have one place to live, so a new one is added once:
  - the stamp;
  - the picture rule on `image_url`;
  - the columns `updated_at` must follow.
- A reviewer looking for "who writes `experiences`" reads the lint's exempting block, not a grep.

**Negative / Trade-offs:**
- The statements move away from the handlers that decide to issue them. The reasoning splits:
  what the statement does stays with the statement, and why the handler issues it stays with the
  handler. A reader follows a function name across two files where they used to read one.
- A dynamic `SET` list, which the curator edit, accept-source and publish all build, crosses the
  boundary as assignments and parameters. The writer owns `WHERE id` and the stamp; the caller
  owns which columns.
- The list is short but not one. A reader asking who writes the table reads the lint's
  exempting block, which names each writer, not a single file.
- The rule binds a table only once its writers are named: `experiences` first,
  `experience_locations` next, then the remaining aggregates #791 lists.

## References

- Related ADRs: ADR-0035 (a writer owns its invalidation, first held by a trigger), ADR-0043 (the
  picture rule), ADR-0064 (queries stay SQL), ADR-0065 (rules both sides apply)
- Related docs: `backend/src/db/locks.ts`, `backend/src/db/readerPredicates.ts`,
  `docs/tech/experiences.md` § Shared modules
- Issue: #791

# ADR-0070: The database refuses a curation-state move the gate does not allow

**Date:** 2026-09-26
**Status:** Accepted
**Issue:** [#794](https://github.com/uncovering-world/track-your-regions/issues/794)

---

## Context

`curation_state` carries the gate of ADR-0025 on four tables:

- a place's membership in a kind;
- a point (`experience_locations`);
- a work (`treasures`);
- a work's link to a venue (`experience_treasures`).

`pending` is a gated arrival nobody has passed and that readers do not see. `auto` came from a trusted source and is shown, and `verified` is one a curator passed.

The moves the code makes, measured on `main` @ 5e91a3a60 by reading every writer of the column:

| Table | Moves |
|---|---|
| memberships | `pending` → `verified` (a publication), `auto` → `verified` (a published held proposal), `verified` → `auto` (a trusted source's new content decays the pass) |
| points, works | `pending` → `verified` |
| links | `pending` → `verified`, `auto` → `pending` (a curator refuses a link whose work is unread, ADR-0053) |

Two moves are made by nothing, and either would break the gate silently. `verified` → `pending` takes a published row off every reader's screen. `pending` → `auto` publishes a row nobody has passed. Nothing today would notice either: the column's CHECK allows all three values, and every reader hides by `<> 'pending'`.

#794 asks for a transition table per vocabulary, with one helper the writers call. Most of these writes are set-based SQL: a publication, the decay, a refusal of every unread link. The from-state of each row is a `WHERE` term the database evaluates, which a TypeScript helper never sees.

## Decision

**The moves each table's `curation_state` may make are declared once, in
`@tyr/shared/lifecycle` (`CURATION_MOVES`), and the database refuses every other move.** A
row-level `BEFORE UPDATE OF curation_state` trigger, `guard_curation_state_move()`, fires only
when the value changes. It checks the pair against the table's list and raises `check_violation`
(23514) for one it does not hold. An insert is not a move: a row is created in whatever state
its writer chose, and the gate is on what happens to it after.

**The list and the trigger are held to each other by execution, not by reading text.**
`backend/src/db/curationMoves.db.test.ts` runs on the database lane. On every table the gate
covers, it tries every pair of distinct states as a real `UPDATE` and compares the database's
answer with `CURATION_MOVES`. A move added to one side and not the other fails there.

The two-valued axes (`admission`, `existence`, `source_membership`) move freely: a curator may
call a place lost and take it back, and a rule may refuse a membership that a run later restores.
Their vocabularies are declared in the same module and pinned to their CHECKs by a type, as the
run statuses are, and they have no transition table, since every change between two values is
allowed.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A TypeScript transition helper each writer calls, as #794 first proposed | Most writes are set-based: the from-state is a `WHERE` term per row, which the helper cannot see without a read before every write, and the read would race the write it guards |
| A CHECK on each pair of columns | A CHECK sees one row version, not the move between two, so it cannot say what a row may become from what it was |
| A lint rule against a literal `curation_state = 'pending'` assignment | It reads the text and misses a parameter, a `CASE` or a copy from another row, and it says nothing about the from-state that makes a move wrong |
| Spell the allowed pairs only in the trigger | Then the moves exist only in PL/pgSQL, where neither side's code or reviewers look. The shared list is where a writer reads what it may do, and the spec holds the trigger to it |

## Consequences

**Positive:**
- The two moves that would break the gate silently fail loudly, whatever writer attempts them, the set-based ones included.
- What each table's state may become is readable in one place, with the reason for each move.

**Negative / Trade-offs:**
- A new legitimate move has to be added in three places: the list, the trigger, and the reason beside the list. The database-lane spec fails until the first two agree, and the third is what a reviewer reads.
- A trigger fires on every update that changes the column. It is row-level, and its `WHEN` clause skips updates that leave the value alone. The column changes on publications, decays and refusals, not on every run's upsert.

## References

- Related ADRs: ADR-0025 (the gate), ADR-0053 (a refusal is `refused_at`, never a fourth state), ADR-0035 and ADR-0068 (rules the database enforces rather than each writer), ADR-0069 (the writer modules)
- Related docs: `docs/tech/experiences.md` § the gate, `packages/shared/src/lifecycle.ts`
- Issue: #794

**Amended in its accepting pull request (#1075):** the first draft listed `auto` → `verified` on
links, attributed to a publish of a link whose work was the unread half. Review found no writer
makes that move: the link publish changes `pending` links only. It is gone from the list, the
trigger and the table above.

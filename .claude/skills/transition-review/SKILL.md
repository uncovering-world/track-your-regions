---
name: transition-review
description: "Transition Review: Review a pull request or branch that changes the catalogue model against the transition regime: the target schema and owner table in db/target/, docs/tech/model-transition.md and the end goal. Temporary, removed by #2646."
---

# Transition Review

**Temporary — transition regime, removed by #2646.** This skill exists only while the catalogue
moves onto its clean model. The regime it checks is `docs/tech/model-transition.md`.

It reviews one pull request or branch against four things:

- the end goal: a clean schema with clean code, with no legacy tables, no intermediate formats,
  no workarounds or complex schemes the model makes unnecessary, and one owner-writer per fact;
- `db/target/model.sql`, the target schema;
- `db/target/owners.json`, each table and column's one owner-writer and every reader, and the
  triggers the model allows, each with its invariant;
- the method and the pull request's sections in `docs/tech/model-transition.md`.

It changes nothing. It reports findings, each blocking or not, and `/pr-create`, `/review-pr`
and `/pr-comments-analyze` act on them.

## Arguments

$ARGUMENTS — optional: a pull request number, or a branch name. With neither, the current branch
against `origin/main`.

## Instructions

### 1. Read the regime and the target

Read `docs/tech/model-transition.md` whole, then `db/target/model.sql` and
`db/target/owners.json` at the head being reviewed. When `db/target/` is missing there, say
so first: the checks that need the target (owners, triggers, the model's line of a finding) are
reported as **not checked**, never as passed.

### 2. Get the change and decide whether it applies

For a pull request:

```bash
gh pr view <number> --json number,title,body,headRefName,headRefOid,files
gh pr diff <number>
```

For a branch, the diff is `git diff origin/main...<branch>`. The body is the draft `/pr-create`
is about to open with, when it calls this skill; otherwise there is none yet, and the body's
checks are reported as owed.

The review applies to a **model change** (`docs/tech/model-transition.md` § The areas): a
change to a table or column the target names, or an old table it replaces, to its schema, or to
any of its writers or readers. A diff that touches nothing under `db/`, `backend/src/`,
`frontend/src/` or `packages/` is not one. A diff that touches those paths but no table,
column, writer or reader of the catalogue model is not one either. Say which, in one line, and
stop.

### 3. Name the area

Map every table, column, writer and reader the diff touches to its area through
`db/target/owners.json` and the slice issues (#2648 to #2653). A pull request moves one area.
A second area is a finding, unless the body says why the two cannot be split, such as an owner
that both areas share.

### 4. Fan out on a large change

When the diff spans many modules, start one subagent per area, or per group of checks below.
Give each the regime document, the area's rows of `db/target/owners.json`, the paths of the
diff it owns and this section's output format. Merge what they return and check each finding
yourself (step 6) before reporting it.

### 5. The checks

Run each one on the diff, and on the files around it where a check needs the whole picture (a
second writer lives outside the diff as often as in it).

1. **Code adapted instead of replaced.** An old function, query or component keeps its shape and
   is re-pointed at the model's tables. Old names survive on new data. A reader keeps building
   the object it built before, out of the new tables.
2. **An intermediate format.** Something converts the model into an old shape or back, outside
   the external boundaries (the answers of Wikidata, UNESCO, OpenStreetMap and Commons):
   - old keys rebuilt from new tables;
   - a view or function under an old name;
   - a compatibility column;
   - a mapper from new to old;
   - a JSON value that carries a fact the model gives a table or column.
3. **A workaround or a complex scheme the model makes unnecessary.** A guard against a state the
   model cannot hold. A reconciliation between two copies the model keeps once. A multi-step
   dance around a constraint the model removed.
4. **A second owner of a fact.** Search every write to each table and column the diff touches
   (`INSERT`, `UPDATE`, `DELETE`, `COPY`, a trigger or SQL function) across
   `backend/src/`, `db/init/` and `scripts/`. Any writer that `db/target/owners.json` does
   not name as the owner is a finding, whether or not the diff added it.
5. **A trigger the target does not allow.** Every trigger and trigger function the diff adds or
   changes is compared with the allowed triggers in `db/target/owners.json`: its name, its
   table and the invariant it holds.
6. **A derivation per row instead of per step.** A derived fact is computed by a trigger
   `FOR EACH ROW`, by a loop that sends one query per row, or by a function called per row,
   where its owner could write it with one set-based statement at the end of the step.
7. **A slice that only adds code in an old area.** The diff adds code to an area that is not
   being moved, or to the moved area while removing little of it. Read the body's
   *Removed and added lines* against `gh pr view <number> --json files` (per-file additions and
   deletions).
8. **A DELETE or SIMPLIFY verdict that survived.** For each verdict in the body's
   *Area review*, search the head: a construct marked DELETE that is still named, or one marked
   SIMPLIFY that is unchanged.
9. **Old answers not compared on the catalogue.** The diff deletes or replaces a reader or a
   writer, and the body's *Compared on the catalogue* is missing, gives no command or names no
   real place.
10. **A missing section of the body.** *Area review*, *Owners touched*, *Retires*,
    *Removed and added lines* or *Compared on the catalogue* is absent or empty
    (`docs/tech/model-transition.md` § What every model pull request carries).

Where the no-legacy check exists on the branch (`npm run lint:retired`, #2131), run it and
read its pending mentions in the area as findings of check 1 or 2.

### 6. Verify before reporting

Each finding is checked against the code at the head, not inferred from the diff alone: the
second writer is opened and read, the surviving construct is found by search, the JSON value is
traced to its reader. A suspicion that cannot be verified is reported as not blocking, and says
what would settle it.

### 7. Report

One block per finding:

```text
[Blocking | Not blocking] <check name>
Where: <file> — <symbol>
Model: <the line of the target or the regime it breaks: a table or column of db/target/model.sql, an owner in db/target/owners.json, or a section of docs/tech/model-transition.md>
Fix: <what the slice does instead>
```

A finding is **blocking** when it is verified and is the pull request's own: it is in the area
the pull request moves, or the pull request added it. A finding in an area the pull request does
not move, which the code already held before the branch, is **not blocking**: it is debt of that
area's slice, and the report names the slice issue (#2648 to #2653) that will remove it. An
unverified suspicion is not blocking either.

End with one line: `Transition: <n> blocking, <m> not blocking`, or `Transition: clean`, or
`Transition: not a model change`.

### 8. Where the findings go

- **From `/pr-create`:** the pull request is not opened while a blocking finding stands. Fix it
  on the branch (folded into the commit it belongs to), or tell the user why it cannot be fixed
  there.
- **From `/review-pr` or `/pr-comments-analyze`:** each finding joins the action plan, a
  blocking one as **Must fix** and the rest as **Should fix**, with a disposition like any other
  finding (`/pr-create` § 8 *Dispositions*).
- **On its own:** print the report.

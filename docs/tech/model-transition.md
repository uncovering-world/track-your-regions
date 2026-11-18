# The model transition

**Temporary — transition regime, removed by #2646.** This document is the regime the catalogue
works under while it moves onto its clean model (#2634). It holds every session, every review
and the `Model transition` CI job (#2131) to one method for as long as the move lasts. When the
move is done, #2646 removes it: what stays true becomes a plain rule of the development guide,
and the rest goes. Queue #2458 runs the move.

## The end goal

A clean schema with clean code:

- no legacy tables, and no column, key, function or trigger the model retired;
- no intermediate formats: nothing converts the model's tables into an old shape or back;
- no workarounds and no complex schemes the model makes unnecessary;
- one owner-writer per fact, with every reader named.

The move is over when the schema built from `db/init/` equals the target, the code writes and
reads only what the target states, and a database rebuilt from the schema file and refilled by
the runs is a working catalogue (#2129).

### The target

The revised model is an ADR (#2634). What reviews and the CI job measure against is its target,
kept in `db/target/`:

- `db/target/model.sql` — the target schema: every table, column, constraint and function of the
  model;
- `db/target/owners.json` — for every table and column, its one owner-writer and all its readers
  (the runs, the curator's writers, the API, the screens, the Catalogue Checks, the public dumps),
  and the triggers the model allows, each with the invariant it holds.

`db/target/` is temporary as well. When the move ends, `db/init/` equals it, and #2646 deletes
it.

### The areas

The model is moved one area at a time, in this order:

| Slice | Area |
|---|---|
| S1 (#2648) | World Heritage |
| S2 (#2649) | time and gone |
| S3 (#2650) | admission and curation |
| S4 (#2651) | works |
| S5 (#2652) | regions and shape |
| S6 (#2653) | visits |

**A model change** changes a table or column the target names, or an old table the target
replaces: its schema in `db/init/01-schema.sql` or `db/migrations/`, or any of its writers or
readers. A change that touches none of them works as it always has.

## The method

1. **A fresh database.** The schema file is the model. A slice writes its area's tables into
   `db/init/01-schema.sql`. On a database that already exists, the area's old tables are
   dropped and the new ones created empty, and the runs refill them. Nothing migrates data: no
   backfill, no copy from an old table, no curator decision carried over. The development
   database is disposable, and the fresh one is curated again.
2. **A slice is one area, end to end, in one pull request:**
   - its schema;
   - every writer: the runs, the curator's writers, the review answers, the triggers and SQL
     functions;
   - every reader: the endpoints with their response schemas and the generated client, the
     screens, the Catalogue Checks, the public dumps, the tile functions, the tests and the docs.

   The old is deleted in the same pull request. A reader that still needs the old shape belongs
   to the slice and changes with it. The response schemas, the OpenAPI document and the web's
   client are derived again from the model. A field whose old name no longer fits is renamed,
   never aliased.
3. **Translation happens only at a true external boundary.** The answers of Wikidata, UNESCO,
   OpenStreetMap and Commons are read into the model's records by the run that reads that
   source. The translation there only translates: it holds no rule of the catalogue. Inside the
   repository nothing converts between the model and an old shape: no adapter, no view under an
   old name, no compatibility column, no JSON key rebuilt from the new tables.
4. **Old and new answers are compared on the real catalogue before the old is deleted.** For
   every reader the slice switches, the old and the new answer are compared on the development
   catalogue:
   - counts;
   - the rows that differ;
   - named real places: a serial site, a cross-border site, a gone place, a museum and its
     works, as the area has them.

   Every difference is explained or fixed. Keeping old code "just in case" is not an outcome:
   the comparison is what allows the deletion.
5. **One owner-writer per fact.** `db/target/owners.json` names it, and every other module only
   reads. A slice adds its tables to the writer lists the backend lint holds (ADR-0069) and
   removes the old tables from them, in the same pull request.
6. **A derivation is computed by its owner, once per write step.** A fact worked out from others
   is written by its owner at the end of the step that changed its inputs, such as a run's stage
   or a curator's write. It is one set-based statement over what the step touched, never a loop
   over rows or a trigger per row. A trigger exists only for an invariant that
   `db/target/owners.json` lists, such as a move the lifecycle refuses. A trigger that computes a
   fact is a second owner of it.
7. **Every construct shaped by the old model gets a verdict.** Each slice starts with a review
   of its area: every table, column, key, function, trigger, writer, reader, workaround and
   check gets one of three verdicts:
   - **DELETE**: the model makes it unnecessary;
   - **SIMPLIFY**: the problem it solves still exists, and the slice states it again in the
     model's terms, with a test that names the real case;
   - **KEEP**: it stays as it is, with the reason the model still needs it.

   "Re-pointed to the new tables unchanged" is not a verdict.
8. **A fix outside a slice stays small.** A bug in an area not yet moved is fixed without a new
   table, column, owner, format or trigger. A fix that needs one belongs to the area's slice.

## What every model pull request carries

The pull request's body holds these sections; the template's `Model transition` section lays
them out:

- **Area review.** Each construct of the area with its verdict (DELETE, SIMPLIFY or KEEP) and its
  outcome in this pull request: deleted, simplified to what, or kept and why.
- **Owners touched.** Each table and column of the target that the pull request writes or reads,
  with its owner from `db/target/owners.json`, and whether the code now matches it.
- **Retires.** The entries of the no-legacy ledger (#2131) that the pull request moves from
  `pending` to `retired`.
- **Removed and added lines.** The lines removed and added under the area's paths,
  with the command that counted them, for example
  `git diff --shortstat origin/main...HEAD -- <the area's paths>`.
- **Compared on the catalogue.** What was compared, the command, the result and the named places
  (method, step 4).

## The review

- **`/transition-review`** reviews a branch or a pull request against the target, this document
  and the end goal. `/pr-create` runs it before it opens a pull request with a model change.
  `/review-pr` and `/pr-comments-analyze` run it on every round. It flags:
  - code adapted instead of replaced;
  - an intermediate format, such as old keys rebuilt from new tables or a JSON value carrying a
    fact;
  - a workaround or complex scheme the model makes unnecessary;
  - a second owner of a fact;
  - a trigger that `db/target/owners.json` does not allow;
  - a derivation per row instead of per step;
  - a slice that only adds code in an old area;
  - a DELETE or SIMPLIFY verdict of the area review that survived;
  - old answers deleted without a comparison on the catalogue.
- **The review bot's Transition phase** (`.github/workflows/claude-review.yml`) runs the same
  checks on every pull request that touches `db/`, `backend/src/`, `frontend/src/` or
  `packages/`. Its findings sit under their own heading in the bot's summary comment.

## The CI job

The `Model transition` job (#2131) holds the move by machine, from the first area slice on:

- **(a) No legacy.** A ledger of what the model retires (`scripts/retired-model.json`), with
  the slice that retires each entry. The job fails when the schema, the code, the tests, the lint
  rules, the scripts or the living docs name a retired entry. For a pending entry it prints the
  mentions left, which are the slice's debt.
- **(b) Owners.** The job fails when a table or column of the target is written by a module that
  `db/target/owners.json` does not name as its owner.
- **(c) The slice contract.** The job fails when a pull request changes an area's schema while
  one of the area's writers or readers still uses the old one, or when its body lacks the
  sections above.
- **(d) No intermediate formats.** The job fails on code that converts the model's tables into
  an old shape or back, outside the external boundaries.
- **(e) The distance only shrinks.** The distance between the code and the target is recorded
  on `main`: the pending ledger entries and their mentions, the owners the code does not yet
  match, and the schema's difference from `db/target/model.sql`. A pull request that grows the
  distance fails.

How to read each check's failure is written here when the job lands. Until then, the review
holds the same checks by reading.

## The keeper's duties

The keeper is the session that keeps the development stack (ADR-0223 decision 2). During the
move it also:

- **Refills an area after its slice merges.** It drops and recreates the area's tables on the
  development stack from the schema file, runs the area's runs from the admin panel, and
  records the result in the journal of queue #2458.
- **Keeps the workbench.** The local Wikidata subset, readership, the OpenStreetMap layer and the
  downloaded dumps they are built from are never dropped with an area (`docs/tech/dumps.md`).
  They are what keeps a refill to hours rather than days.
- **Clears the curation gate for a refill.** Before a refill it clears the curation gate
  (`experience_sources.requires_curation`, set from the admin panel) on the sources it runs,
  and afterwards sets each one back to the answer it had. The maintainer approved this on
  2026-11-18. With the gate on, every place a gated source brings would wait in the review
  queue, and the refilled area could not be looked at. The fresh catalogue is curated again
  afterwards.
- **Runs UNESCO first in a full refill**, then the Wikidata kinds, then the museums and their
  works.
- **Measures after each slice.** It runs `npm run perf:api` on the refilled stack, and
  `npm run perf:local` when the slice changed what the browser loads, and records the numbers
  beside the refill.
- **Runs the acceptance at the end.** A database is built from the schema file alone and
  refilled by every run (#2129). If the catalogue that results works, nothing of the old model is
  needed.

## A session outside the queue

A session that works another queue, or no queue, and would change the catalogue's tables,
migrations or writers either builds that change under this regime, inside its area's slice, or
asks the owner of queue #2458 first (`/queue status` names the owner). A change that touches no
part of the catalogue model works as usual.

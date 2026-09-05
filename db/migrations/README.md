# Database Migrations

`db/init/01-schema.sql` is the canonical schema — tables, indexes, triggers,
tile functions and the auth system. It is the only file in `db/init/`, and
Postgres applies it automatically when a database is created empty
(`docker-entrypoint-initdb.d`, see `docker-compose.yml`).

The numbered files in this directory carry what a database holding data cannot
get from that file: one-shot cleanups, backfills, and DDL that fails while the
old rows are still there.

## Applying them

```bash
npm run db:migrate:status   # what this database has been through, and what is pending
npm run db:migrate          # apply every pending file, in filename order
```

`scripts/db-migrate.sh` applies the pending files and records each one in
`schema_migrations`, so the database itself says which of them it has seen
(#435, [ADR-0041](../../docs/decisions/0041-a-database-says-which-migrations-it-has-seen.md)).
`npm run db:status` prints the same summary alongside the row counts.

A file is recorded only when psql reached the end of it: the `INSERT` into the
ledger is appended to the migration and handed to the same invocation under
`ON_ERROR_STOP=1`. That flag is the point. psql exits 0 when a statement in a
piped script fails, so without it a migration that aborts on purpose — 006
refuses to run when a row it would delete still has dependents — reports success
to the shell. `006` also sets `\set ON_ERROR_STOP on` in the file itself so it
cannot be defeated by the way it is invoked; `001`-`005` predate that habit.

Applying one file by hand still works and is sometimes what you want — a long
migration you are watching, or one you are stepping through:

```bash
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/006-single-default-world-view.sql
```

The ledger does not see it. It is a record, not a lock: tell it afterwards with
`npm run db:baseline -- --through NNN`, naming the file you actually ran, or the
file stays pending and the next `db:migrate` runs it again. Say `--through`:
plain `db:baseline` records *every* pending file, which after a hand-applied 041
would also assert that 042 was applied — the "somebody was sure" failure, written
down.

## Two rules for a new migration

**Name it `NNN-slug.sql`** — three digits, then lowercase words joined by
dashes. Filename order is the order they are applied in, so a name outside that
shape, or a number already used, makes the order a guess; the runner refuses
both, and `backend/src/db/migrationLedger.test.ts` fails the gate before it
gets that far.

**Declare your own transaction.** The runner wraps nothing, because a file knows
whether its work is one step or several and nothing outside it does — 36 of the
files here open a `BEGIN`/`COMMIT` of their own. A wrapper would not even hold:
`psql --single-transaction` over such a file warns that a transaction is already
in progress, and the file's own `COMMIT` then ends psql's outer one, leaving
everything after it unwrapped. That is atomicity you can see and cannot rely on.
Write the file to be re-runnable while you are there: a run interrupted between a
migration's commit and its ledger row leaves the file pending, and the next run
applies it again.

## A database that predates the ledger

`schema_migrations` arrives with the canonical schema, so an existing database
needs it re-applied once. Then state what that database already carries:

```bash
npm run db:baseline                  # every pending file, recorded without being run
npm run db:baseline -- --through 040 # or only up to a given one
```

A baselined row is marked `ran = false`, because it is an assertion by a person
and not something this database was observed doing; `db:status` reports the two
apart.

**A database built from the canonical schema needs the same baseline, and for
the same reason.** Everything here is already in the file it was built from, and
the backfills have no rows to repair. Two paths build one: `npm run db:create`,
which baselines it itself, and Docker Compose, which mounts `db/init/` into
`docker-entrypoint-initdb.d` and creates `track_regions` on first start —
`scripts/setup.sh` baselines that one, so run `npm run db:baseline` once by hand
if you brought the stack up another way.

Getting this wrong is the failure worth naming. An unbaselined database of that
kind stands at 40 pending files it must not run: `015-museum-clean-slate.sql`
deletes catalogue rows by volume rather than by whether it has run before, so
applying it after an import takes the freshly imported rows with it — its own
header says it is a one-time manual action, not a repeatable step. So an empty
ledger never means "apply everything": `db:status` says to baseline, and
`db:migrate` refuses outright on a database that holds a catalogue and has
recorded nothing.

Re-applying `01-schema.sql` to an existing database is the other half of the
workflow: it is how new tables and columns arrive between migrations. That is
why the file has to stay idempotent — DDL uses `IF NOT EXISTS` / `OR REPLACE`,
and every seed `INSERT` names an explicit `ON CONFLICT` arbiter backed by a real
unique index. A bare `ON CONFLICT DO NOTHING` is not a guard: on a table whose
only unique constraint is a serial primary key it never fires, and the seed row
is inserted again on every run. That is exactly how a second default world view
appeared (#434). `backend/src/db/schemaSeeds.test.ts` guards the rule.

A migration that adds a constraint the existing rows violate has to run *before*
the next re-application of `01-schema.sql`, since the schema file will otherwise
fail on the same constraint. Each such migration says so in its header.

`039-held-decisions.sql` adds `experience_held_decisions` and the `declined_held` audit action —
where a curator's answer to *one row* of a held proposal is recorded (#722,
[ADR-0038](../../docs/decisions/0038-a-held-proposal-is-answered-per-field.md)). Both verdicts,
keyed on the experience, the part the record names and the field, storing the value answered
about: the queue, the panel's count and publishing suppress a row only while the proposal is
jsonb-equal to it, so a source that changes its mind is heard. `UNIQUE NULLS NOT DISTINCT` is
load-bearing rather than tidy — the object's own row carries three NULLs and the one referenceless
point carries one, and under the default rule no two such rows would ever collide. Nothing to
backfill: every held proposal on disk is unanswered by definition, because until this file there
was no way to answer one field of one. Applying it changes nothing a reader sees.

`038-sync-log-total-held.sql` adds `experience_sync_logs.total_held` — how many rows a reader
can already see the run proposed a change to and the gate kept whole, each waiting on a verdict —
and fills it for the runs that predate the column from the `held` rows they recorded (#523). A
subset of `total_unchanged`, counted again, because a held row moved nothing and that counter's
meaning is fixed; the code writes it from the same predicate that files a changeset row as `held`,
so the count and the rows are one decision and the fill is exact wherever the changeset landed. On
the dev database: UNESCO run 68 reported `unchanged 1272` about 1272 held sites, Public Art run 67
held 199 of its 200, museum run 64 held 15. A run whose changeset was lost, or landed only in part
— the insert goes in batches of 500 with no transaction around them — is left at 0 and listed by
the closing query with the held rows that did land, because a count taken from a partial record
would read as exact everywhere afterwards. Adds the column itself, so it may run before or after
the next re-application of `01-schema.sql`, any number of times — a second run finds nothing to
fill.

`037-topology-preserving-rungs.sql` rebuilds every rendered rung of `regions` and
`administrative_divisions` (#685). `simplify_for_zoom()` simplified with `ST_SimplifyVW`,
which moves each ring on its own: the simplified outline crosses itself, two parts that
were disjoint come to overlap, and the `ST_MakeValid` every geometry write ends with then
resolves the overlap by carving it out as an interior ring. So each rung drew holes that
are in no data, and more of them the coarser the rung — 1,933 across the eight root regions
of the Administrative world view, which hold 610, and 66 over north-eastern Thailand where
the data has 8. The function now uses `ST_CoverageSimplify` (ADR-0036) and this file
recomputes what the old one wrote: per row first, then the coverage pass over each sibling
set, because only that pass can keep a border shared between two rows (rule 15). It repairs
no data and drops no column — every value in it is derived, and a second run arrives at the
same shapes. It refuses to run against the old function definition, since it would
otherwise spend its whole runtime writing back the shapes it exists to replace, and it
checks the rows before committing. It is hours rather than minutes — 2 h 24 m on a development
database, since every rung is recomputed from full resolution — and raises a NOTICE with the
elapsed time as each pass finishes, so a long run can be told from a stuck one. Follow it with
`VACUUM (ANALYZE)` on both tables, as 008 and 030 say.

`036-parent-geometry-invalidation-trigger.sql` moves ancestor geometry invalidation into
the database, so that no writer of `regions.geom` can bypass it (#680). A region's outline
is the union of what is under it, so a write leaves every derived ancestor covering a
smaller world than it contains; #667 established that the writer nulls those ancestors and
the next world-view run rebuilds them bottom-up, and #679 enforced that by hand at each
writer — whose review found seven writers beyond the one the issue described, one round at
a time. A write that skipped the call consumed the `NULL` its own convergence depended on:
the parent kept a stale outline with nothing `NULL` beneath it and fell outside every later
run's closure, while every run reported Complete. The file adds one trigger function and
its two arms (`UPDATE OF geom`, and `INSERT` for a region born with a drawn shape), which
`01-schema.sql` carries as well; it repairs no row and touches no data, so it may run in
either order against that file, any number of times. What it has not repaired it reports:
the closing queries name the parents still short of their children and the derived regions
still holding no geometry — #667's rows, waiting on #459.

`035-in-danger-flag.sql` sets `metadata.inDanger` on the sites the catalogue already
tags as `in_danger` (#600). One fact is stored twice and the import wrote the two halves
from different fields: the tag from either of UNESCO's, the flag from the boolean alone —
compared against the number `1` while the portal sends the string `"True"`. So the tag was
right on 58 of 1272 rows and the flag was false on all of them, and the "In Danger" badge
three surfaces draw off the flag has never appeared for anyone. The reading was widened on
2026-08-21 and both writers now ask one predicate, which fixes what a run imports and
nothing that is already stored — and on a gated source a run cannot fix it: `inDanger` is
not a key a run owns outright, so the hold refuses to overwrite a row a reader can see and
the 58 flips would queue as 58 major changes for a curator to answer for. They are not the
source changing its mind. Keyed on the tag rather than on UNESCO's field, so the file
speaks about two columns of one catalogue; the two agree on every row today (58 tagged, 58
carrying a dated listing, 58 flagged `True` in `whc001` itself, measured 2026-08-27) and
the query at the end reports any row where they do not rather than repairing a shape
nobody has seen. A repair of data and not of shape, so it may run in either order against
`01-schema.sql`, any number of times.

`034-unnamed-gadm-rows.sql` gives back the polygons the loader folded into their parents,
and fills the holes they left above them (#665). GADM 4.1 leaves the deepest `NAME` empty on
2831 rows that carry a valid `GID` and a polygon; the loader read only the names, so such a
row ended one level early and its polygon was stored on the division above it — which then
sat as a leaf holding one tambon while its named siblings arrived as its children and reached
no ancestor at all. 86 divisions on the dev database are in that state (66 Thai districts,
all 16 Uruguayan departments, 4 in the United Arab Emirates), and Thailand's country polygon
carries 54 interior rings, 20 742 km² of them. The file materialises each folded polygon as a
division of its own — called after the row it was folded into with `" (rest)"` on the end, since
that is what it holds and the row it hangs under has other children by definition — rebuilds the row above it from its children, and unions the missing area
back into every ancestor — *unions* rather than recomputes, because rebuilding a continent from
its countries is precisely what times out (#459), while what the ancestors lack is area and
nothing else. The regions built on those divisions are the one thing it does not union: they are
rebuilt from what they are made of, their members together with the regions under them and
deepest first, because unioning a region computed from its provinces with district polygons of
another provenance leaves thousands of interior rings along the seams. A region whose whole
boundary a curator drew is skipped and listed for a person, as the compute path skips it. The geometry triggers stay enabled and the
coverage-aware pass (`simplify_coverage_siblings`, the same function
`precalculate-geometries.py` calls) puts the touched sibling groups back to gap-free borders.
What it cannot repair is a polygon that never reached the database: 24 of GADM's 356 508 did
not, 21 of them to name paths resolving to more than one GID and 3 where the folded district
had a single same-named child and `merge_single_children` deleted it, polygon included. The
loader change recovers those 3 on the next load; the 21 want their own repair (#681), and they are
why Thailand keeps two interior rings (379 km², at Bang Sai in Phra Nakhon Si Ayutthaya)
where 54 and 20 742 km² stood before.
It may run before or after the next re-application of `01-schema.sql` — it adds no DDL — and
a re-run is inert: a repaired row is no longer a leaf and carries no `gadm_uid`, and a row it
could not rebuild — one whose children carry no geometry, which is every folded row on a
database loaded without `-g` — keeps its flag and its uid on purpose, so the checks go on
naming it, while the insert that gave it a child declines to repeat. Its closing statements report
what it changed, every leaf that still has children (zero, or the repair missed one), and any
region whose member is a curator's hand-drawn cut of a division that has just changed shape:
those are deliberately left alone and want recomputing by hand.

`033-division-focus-data.sql` fills `administrative_divisions.focus_bbox` and `anchor_point` —
the focus data regions have always had, now stored for divisions too (#674) — from
`geometry_focus()`, the one rule, for every division with geometry. It writes the two columns
directly rather than re-firing the geometry trigger, which would drag the simplification and 3857
triggers through 392 112 rows, and it disables `trg_admin_div_geom_3857` around the write, since
that trigger fires on any UPDATE and compares geometries byte for byte to find it has nothing to
do. About five minutes on the dev database. Runs *after* the next re-application of
`01-schema.sql`, which defines the function and adds the column; its guard refuses otherwise. A
re-run fills only what is still empty and takes seconds. Its closing SELECT lists every division
whose box is global — the two Antarctica rows, and nothing else, on a database holding GADM 4.1.

`032-antimeridian-focus-data.sql` recomputes `focus_bbox` and `anchor_point` for the
regions the antimeridian fix in `update_region_focus_data()` reaches (#666; the measurement has since moved into `geometry_focus()`, which the guard accepts). The trigger
fires only on `geom` and `hull_geom`, so a database already holding rows keeps the wrong
boxes until something re-fires it: on the dev database the Far Eastern Federal District and
Fiji each claimed every longitude on Earth and anchored the camera in the wrong ocean. This
one runs *after* the next re-application of `01-schema.sql`, not before — it needs the fixed
function to be the one that answers, and its guard refuses to run otherwise rather than
writing the same wrong boxes back in place. Re-running it is a no-op.

`031-data-assertion-acceptances.sql` adds `data_assertion_acceptances`, the ledger
behind the admin panel's catalogue checks: one row per act of accepting what an
assertion currently finds, so the newest row per assertion is the debt this
catalogue is knowingly carrying and the rows behind it are the history of who
said so (ADR-0032). Nothing to backfill — an assertion with no accepted number is
reported in full, which is the correct starting state on a database nobody has
answered for yet. Adding a table cannot fail on rows already there, so it may run
before or after the next re-application of `01-schema.sql`.

`013-locations-mark-not-delete.sql` adds `experience_locations.missing_since` and drops
`ordinal`'s NOT NULL, so a point a source stops offering can be marked instead of deleted —
deleting it cascaded away the visit record and every region assignment on it. There is nothing
to backfill: until this file, anything missing was removed rather than recorded, so no existing
row has ever been observed missing. Adding a nullable column and dropping a NOT NULL cannot
fail on rows already there, so unlike the ordering rule above it may run before or after the
next re-application of `01-schema.sql`.

`012-new-badge-views.sql` adds `user_new_badge_views`, which records when a reader was
first shown the "New" chip. Nothing to backfill: an absent row means "not yet shown", which
is the correct starting state for every existing reader and experience. No retention job
either — the personal clause is bounded by the age of these rows themselves, so one that
ages past its seven days stops being read rather than needing to be swept.

Nothing to backfill *here*, but 009's backfill decided what the chip would show on day one,
and the answer would have been "everything": it credited every pre-existing row to the newest
run of its category, which was then the value the chip compared against. That is no longer
what the chip asks — #529 re-anchored it on `published_at`, which nothing backfills — so the
1547 rows credited without ever being observed wear no chip because they were never published,
not because of what a changeset says about them. The `created` clause that used to carry this
paragraph is gone with it.

`011-curation-lifecycle-actions.sql` widens the curation log's action check to
admit the five verdicts a curator can now record — `marked_former`,
`marked_lost`, `state_restored`, `missing_dismissed`, `accepted_source`. Widening a CHECK cannot fail
on rows already there, so unlike the ordering rule above it may run before or
after the next re-application of `01-schema.sql`; it exists because
`CREATE TABLE IF NOT EXISTS` leaves the old constraint alone on a database that
already holds the table.

`010-sync-filtered-entities.sql` separates filtering from failing: the museum
query answers with collections as well as museums, and dropping the ones with no
address is the filter working rather than the run breaking. It adds a counter and
widens the changeset's type check; there is nothing to backfill, because no run
before it distinguished the two.

`040-every-creator-of-a-work.sql` converts four stores that name one field at once —
`treasures.artist` becoming `artists`, the claims on it, the change records carrying
it, and the answers to those records — because their match is the field name *and* the
value, and a half-converted set is worse than either end of it: an unconverted record
lands in `publishHeldParts`'s `unwritable` and refuses the whole card it belongs to. It
leaves `experience_curation_log` alone on purpose: that table records what a curator
did and what the field was called when they did it. Order-independent with
`01-schema.sql` — that file adds the column empty, this fills it and drops the old one,
each step guarded so either order arrives at the same place — and it widens the
curation-log action CHECK, so it is also the newest file that states that list whole.

`041-a-work-is-marked-not-deleted.sql` adds the two columns behind a work leaving a museum
(ADR-0044): `experience_treasures.missing_since`, the mark on a link the source stopped placing
here — the observation a point carries, hidden from readers by the same predicate — with a partial
index on the offered links, and `experience_sync_logs.withdrawal_skipped_reason`, why a run marked
nothing when the works coverage floor refused it. One file for both because they are one decision:
a mark is only safe behind the floor, and a refusal that lands nowhere a person reads is a run that
"found nothing to withdraw". No backfill — every link stored before it is one no run has
contradicted, which is what NULL means — and re-running it is a no-op.

`042-refused-row-keeps-no-iconic-badge.sql` clears `is_iconic` on every refused row that still
carries it, a flag a curator pinned excepted (#760). The run's refusal writes clear the flag on the
rows they may touch, and a curator's confirmation of a refusal does so since #760; what the file
reaches is the rows refused before either did — eight museums on the development catalogue,
refused on the day the admission writes landed and then confirmed, whose pin on `admission` had
kept every later run off them. No DDL, so it is order-independent with `01-schema.sql`, and
re-running it touches nothing.

`043-a-cached-answer-belongs-to-the-source-that-asked.sql` empties `wikidata_query_cache` and
corrects the comment on its `query_hash` column, after the key became the asking source's
`category_id` and the query text together rather than the query text alone
([ADR-0047](../../docs/decisions/0047-a-cached-answer-belongs-to-the-source-that-asked.md),
#754): every row keyed the old way is unreadable from then on and would sit as dead weight,
counted by the panel against whichever source last wrote it, until its lifetime passed. It is a
cache, so the next run of each source asks Wikidata again; re-running the file clears it again,
and the next run of each source starts cold. The comment is the one thing `01-schema.sql` also
states, for a fresh database.

`044-an-object-has-a-type-not-a-category.sql` renames `experiences.category` to `type` — the
column was the type within a kind (cultural / natural / mixed, monument / sculpture) carrying
the word the code uses for the kind and its source — and moves everything that names the
field by name with it in one transaction: a curator's claim in `curated_fields`, the
`field` of every stored proposal in `experience_sync_changes.changed_fields`, a curator's
answers in `experience_held_decisions.field` and `experience_conflict_decisions.field` — which
the queue matches against the proposal entry by name, so an answer left under the old name
would re-ask an answered question — and the three shapes in which
`experience_curation_log.details` names a field (an edit's column keys, a publication's field
list, a refusal's or an acceptance's `field` objects), so each keeps its identity under the
new name. It runs before the next re-application of `01-schema.sql`, which now comments and
indexes `experiences.type`. Two vocabularies end with it: a museum's type becomes NULL (the literal `art`
every row carried said nothing the kind does not — an art museum is a kind, ADR-0045), and
public art stops holding its type twice (`metadata.type` is removed from the rows and the
duplicate entry from the stored proposals; 124 of 1,685 public-art proposals on the
development catalogue carried both). Guarded on the column's current name, so re-running it
on a database already renamed changes nothing (#814, Epic #815).

`009-experience-change-provenance.sql` is the current example of the other kind:
its DDL is a copy of what `01-schema.sql` already carries and re-applying the
schema file achieves the same thing. What only exists in the migration is the
backfill — every source-derived row that predates change provenance is attributed
to the newest run of its category that wrote anything, which is how it got
there. Rows a curator created by hand are the exception: they were inserted
outside any run and keep NULL provenance permanently, since manual creation
writes none either. `COALESCE` guards each column, so running it twice is inert.

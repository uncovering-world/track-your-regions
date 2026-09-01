# Catalogue checks

**Admin panel → Catalogue Checks** asks the live database whether the catalogue
still means what the product says it means, and answers with a report a person
can act on. It is the only lane in the repository that looks at **rows** rather
than at code.

Everything else watches the source. `npm run check` reads it, Semgrep and Trivy
read it again, `schemaMigrationParity` compares two SQL files as text, and the
E2E smoke drives a browser over a fixture. None of them can see a defect that
writes wrong rows into a database that is otherwise healthy — which is how the
catalogue held a withdrawn point for Bilbao Fine Arts Museum whose replacement
stood 1.2 cm away for nine days, with every sync run reporting `success`
(#543). A withdrawal plus an arrival is an ordinary outcome; only the two rows
together are wrong.

It is a **screen** and not a command, and ADR-0032 decision 6 says why: an
admin starts runs in the panel and reads their outcome there, and asking them to
open a terminal to learn what the catalogue holds would hand a product role a
developer's tool.

## A rule is absolute; the catalogue is not

Each assertion is a claim that should hold — a place is not stored twice, an
object a reader is offered has somewhere to go. The catalogue does not hold all
of them today, and never will hold all of every rule added from here. Measured
on the dev catalogue on 2026-08-24: 28 objects a reader is offered sit in no
region at all, 173 offered places carry no region row, and 2911 pictures are
displayed with nobody credited — 407 by 2026-09-02, 330 objects and 77 works, once
ADR-0043 had replaced the World Heritage portal's photographs with credited Commons
files and museum runs had written the works' credits.

So the rule stays at zero and the debt is recorded separately (ADR-0032):

- **Accepting** a number records what that assertion returns *now* as the debt
  this catalogue carries, with who accepted it and when. The number is measured
  by the server as it records it — the browser sends an assertion's id and
  nothing else.
- A count that **stands still** is reported as carried and asks nothing of
  anybody.
- A count that has **grown** is what the page leads with: something is writing
  those rows now, rather than a backlog somebody already knows about.
- A count that has **fallen** says so, so work that fixed something is visible
  and the number can be accepted again lower.
- An **invariant** nobody has accepted a number for reports everything it finds
  and counts as needing a person. That is the honest state for a rule that has
  not been answered for, and the moment to choose between fixing it and carrying
  it. A `watch` never counts, accepted or not: its rows are legitimate, so there
  is nothing to answer for and no way to accept it.

One assertion is accepted at a time, on purpose: a single control that accepted
everything would make the run where somebody answers for a newly added rule also
the run that re-baselines a regression standing beside it.

The numbers live in `data_assertion_acceptances` in the database they describe,
as a ledger — one row per acceptance, never updated, the newest per assertion
being the number in force. A dump restored elsewhere therefore carries its own
accepted debt, and a fresh checkout of the code inherits none.

## What is asserted

| Area | Assertion | Kind |
|---|---|---|
| places | A place marked as withdrawn while its replacement stands within ten metres of it | invariant |
| places | Two places of one object on offer under one reference, within ten metres of each other | invariant |
| places | An object offered to readers with no place a reader can see | invariant |
| places | Visits recorded against a place no reader-facing read offers | watch |
| regions | An object offered to readers that no region holds | invariant |
| regions | A place the source still offers that no region holds | invariant |
| regions | A region framed as the whole world while its geometry is not | invariant |
| regions | A region whose anchor point is more than 500 km from its own geometry | watch |
| regions | A parent region whose geometry covers less than nine tenths of what its children hold | invariant |
| regions | A region with no geometry, in a world view whose geometry has been computed | invariant |
| regions | A display rung drawing holes its source has not, or missing pieces its source has | invariant |
| boundaries | A division stored as a leaf while divisions hang beneath it | invariant |
| boundaries | A division holding a single source polygon while divisions hang beneath it | invariant |
| objects | A site whose danger tag and whose In Danger badge disagree | invariant |
| objects | A work names several makers in an order nobody has confirmed | watch |
| pictures | A stored picture on a host whose terms do not let us show it | invariant |
| pictures | A picture shown with nobody credited | invariant |

**A stored picture the product may not show** is ADR-0043's own invariant over
live rows: every `image_url` names a Commons file or a file we host, because the
World Heritage Centre's terms do not let this product draw its photographs and
every writer refuses any other host since. What it catches is the past — 1260
rows carried `whc.unesco.org/document/<id>` on the day the rule landed, and a
database restored from before it carries them still. Such a row draws nothing
(the rendering side refuses the host), so nothing is shown wrongly; what is wrong
is an empty frame over a stored value nothing will ever draw, and the remedy is
one button, *Fix pictures* on the source's card in the sync panel, which the
sentence names rather than a run. It reads the host and file-type lists from
`urlSafety.ts` rather than spelling them twice, and asks all four arms of the
rule — host, Commons path on the upload host, not a `/wiki/File:` page, a
picture's extension — so that the two picture assertions partition the rows: a
Commons PDF is a picture the product may not show, not one nobody is credited
for. `picture-with-nobody-credited`
narrowed alongside it to pictures that are actually drawn — before that, every
row still carrying the portal's photograph read as a photograph on show needing
a photographer, and sent an admin to a run that could not have fetched one.

`work-makers-unconfirmed` is the newest watch and the one whose *kind* is the whole
point. A work often has more than one maker and the catalogue now stores every one
(ADR-0040), but the source states who and not in what order: SPARQL exposes no statement
order, and the query the pool actually sends answers in reverse of Wikidata's own. So the
stored order is nobody's judgement, no screen claims one of them leads until a curator
makes it, and this is the count of decisions outstanding. It reads zero on a gated
catalogue that has never published one of these, which is not the same as nothing to do: a
run may not rewrite a visible work's attribution ([ADR-0037](../decisions/0037-a-part-field-readers-see-is-held-like-the-objects.md)),
so the second maker arrives as a held proposal and the row holds one name until somebody
publishes it — museum run 79 filed 22 such proposals and moved this count not at all. What
is waiting there is the queue's own question, counted on the gate's panel; this assertion
begins where that one ends. It is expected to rise as those are published and to come down
as attributions are read — a curator answers it through the work edit endpoint, whose claim on `artists` takes
the row out of the count and stops the next run reordering it. **One row per work**, not
per pair of makers — a work naming six of them is one decision, and `maker_count` says how
big a decision. A work naming two counts as much as one naming six: the question is whose
attribution a person has looked at, not whether a screen currently depends on the answer.
Works nobody has passed are left out, since a `pending` row is invisible and the first
thing a curator does with it is decide whether it belongs at all — their makers *are*
stored in full, the hold protecting a visible row and an arrival having nothing to
protect.

The first two are the detection half of
`db/migrations/026-collapse-false-withdrawals.sql`, promoted from a one-shot
repair to a standing assertion — the first is #543's shape exactly, the second
is the floor under the writer ADR-0027 rewrote and the shape a gated source
produces instead (an unread arrival beside the visible point, neither marked).

Both pair on the **reference as well as the distance**, which is ADR-0027's rule
and not a detail: ten metres applied without a reference would be a
nearest-point search over an object's own places, and 4172 pairs of one
experience's points lie within a kilometre of each other — many at exactly
nought metres, because what separates two rock shelters in one cliff is the
component number rather than the metres between them.

The third is the failure ADR-0025 decision 5 exists to prevent: a list entry
with no pin, in a product where the list and the map are two views of one set.
Two routes reach it — an object's only place written unread under a gate, or a
withdrawal applied with no arrival to hold it — and a third is a curator's
manual region claim outliving every visible place of the object it holds, which
`readerRegionMembershipSql` names as the residue its own exemption leaves
(#521).

The fourth is a **watch** rather than an invariant, and ADR-0022 is why: a
traveller who stood somewhere stood there, and the record cannot depend on a
source still listing the place. Those rows are legitimate, so the count is a
number to watch and the panel offers no way to accept it. It is grouped by place
and never reads the person — who went where is not an admin's business here.

The two region assertions are a pair: an object no region holds cannot be
browsed to at all, while a place no region holds is a pin that votes nowhere,
and an object with several places can be findable while one component is counted
in no region. Both are debt today, and reading the rows as a traveller says why
— Aldabra Atoll, the Great Barrier Reef, Cordouan Lighthouse in the Gironde
estuary, four of the D-Day beaches. Water. A boundary set built from land
polygons has nowhere to put them (#470), and a point a few metres outside a
coastline has the same problem for a different reason (#469).

The five geometry rules exist because defects keep being found by a person
looking at a map and by nothing else in the repository (#668): three regions
framed as the whole world (#666), four continents holding a fraction of what
their countries hold (#667), and the rung the map serves drawing 66 holes over
north-eastern Thailand where the data has 8 (#685). Every run had reported
success.

**Framed as the whole world** asks whether a stored `focus_bbox` claiming every
longitude is telling the truth, and it asks in a way that is deliberately *not*
`geometry_focus()`'s: a second copy of the trigger's arithmetic would agree with
the trigger on every row the trigger got wrong. Instead the region's parts are
dumped, the 10° bands of longitude each part touches are collected, and the
widest run of empty bands round the circle is found; 20° or more with no part of
the region in them means a window of 340° or less existed. Nothing is excluded by
name: Antarctica is measured like every other row and comes out quiet because its
parts touch all 36 bands, which is the honest reason a continent round the pole
keeps a full-width box — an exclusion by id would also hide a real defect in that
row. It sweeps
`COALESCE(hull_geom, geom)` and takes the 350° threshold from `near_global_deg()`
— sharing the trigger's *input* and its constant is not sharing its arithmetic,
and sweeping the geometry alone would report a hull region whose box is right,
since a concave hull covers longitudes the parts it wraps do not. It reports
nothing today, since #671; Fiji's box forced back to
global answers "340° of longitude hold no part of it", which is what a
regression of the trigger would look like here.

**Anchor far from its region** is a watch, and reading its 18 rows as a
traveller says why. The United Kingdom's anchor is 2 932 km from its nearest
edge because the Falklands and Saint Helena are in the box and its centre is the
Atlantic; France's is 2 224 km out for Réunion and French Guiana; Japan's for
the Ogasawara islands; Antarctica's continent row because the centre of a box
round the pole is the Southern Ocean. Those anchors are right — a crossing box
is framed from its anchor, and the frame is right — so there is nothing to
answer for, and what carries meaning is a *mainland* name appearing: the Far
Eastern Federal District (off Shetland) and Fiji (off Namibia) were on this list
until #671. It is measured on the 3857 low rung with the tolerance scaled by
latitude, a quarter of a second where the exact distance on geography costs
sixteen; Mercator puts a row within a few kilometres of the line on either side
of it (Tasmania at 510 km, Portugal at 509), which a watch tolerates.

**Parent short of its children** reads from the stored `geom_area_km2` rather
than `ST_Area` on the fly — the stored area is stale exactly when the geometry
is, which is the question, and it costs milliseconds where the measurement costs
a minute. Today it reports #667's class: North America at 18.3 % of its children,
Europe 41.2 %, Asia 58.2 % — three of the four it opened with, South America
having been repaired once its union finished inside the timeout. Nine tenths, because a parent's
union legitimately loses slivers and holes its children's outlines carry. A row
has a second possible cause, and the panel's own sentence says so: summing the
children double-counts a division two of them hold, nothing enforces a partition
within a world view, and the Wikivoyage import accepts a match its own coverage
check flagged as a conflict. That case wants the children checked for a shared
member rather than a recompute — the parent's own area is the union and is
right, so recomputing will not clear it. No such pair exists on the dev catalogue
today (measured: 0 sibling pairs share a division).

**Region without geometry** asks only of a world view *most* of which has been
computed — the qualifier is what separates a hole from an import that never ran,
and it has to measure the world view rather than the existence of one computed
region: geometry is computed one region at a time on demand, so a curator's
first click on the in-flight Wikivoyage import (4 301 regions, none computed)
would otherwise turn this rule into four thousand rows of the wrong question. The
Administrative world view sits at 99.9 % and answers Canada, one row of its
3 831. A region awaiting recompute appears here too, and should. Any write to
`regions.geom` nulls the derived ancestors above it — the database does that,
from `trg_regions_geom_invalidates_parent` ([ADR-0035](../decisions/0035-ancestor-geometry-invalidation-lives-in-the-database.md)),
since a parent is the union of children one of which has just changed — and
editing a region's members nulls that region's own geometry too, which is the
same kind of write and so reaches the same ancestors. So a continent parks on this
rule whenever anything under it is computed, and stays there until the next
world-view run takes it bottom-up. That is the design and not a defect: a region
with nothing on the map is exactly what the panel should say out loud, and the
count falls back on its own.

**A rung unlike its source** asks something exact rather than a proportion —
as `region-without-geometry` does, where the nine tenths is a scope and the
violation is `geom IS NULL` — and it can: simplification makes an outline coarser,
it does not add rings to it, and the rungs at 5 km and finer keep every part
(rule 12). The pass that #685 removed failed the same shape both ways — it
carried 1,933 interior rings across the eight root regions of the Administrative
world view where they hold 610, and it dropped 436 of Asia's 26,151 pieces at the
1 km rung — so the rule is asked twice, once for holes gained and once for pieces
lost. The two cheap rungs are asked only the first: dropping a piece below their
own scale is
[ADR-0031](../decisions/0031-a-display-rung-drops-what-a-reader-cannot-see.md)
decision 1, not a defect.

The pieces half is also what a *library* change would trip.
`ST_CoverageSimplify` drops neither a piece nor a hole on PostGIS 3.5.6 /
GEOS 3.14.1 — measured, a 100 m speck 50 km from a square and a 200 m lake inside
it both survive a 5 km pass — but that is a measurement rather than a documented
guarantee, and `docker-compose.yml` pins `postgis/postgis:17-3.5-alpine`, which
floats GEOS. This rule is what notices the day it stops holding
([ADR-0036](../decisions/0036-a-rung-carries-the-holes-its-source-has.md)).

It counts rings and parts rather than re-deriving a rung, so it cannot agree with
a broken writer, and it compares each rung against the shape *that rung* is made
from: a hull region's low and medium rungs come from its hull, and a concave hull
can enclose a lagoon the geometry leaves open, so measuring them against
`geom_3857` would report every hull region whose rungs are right. Ten questions
off one bad pass are one defect, so the report names the worst rung of a region
rather than ten lines of it.

It is also the only rule that reads a full-resolution column for *every* row, and
that is the whole of its cost: one PostGIS call over `regions.geom_3857` detoasts
11.7 M points and takes 2.6 s, against 0.35 s for all six rungs together. Two of
the rules above read a geometry column as well — `framed-as-the-world` dumps
`COALESCE(hull_geom, geom)`, but only for the rows whose stored box is already
global, and `anchor-far-from-its-region` measures on the 5 km rung — so what
separates this one is not that it touches geometry but that nothing narrows it
first. And there is no stored ring count to read instead, the way
`parent-short-of-its-children` reads `geom_area_km2`, so what can be avoided is
reading it *again per rung*, which `MATERIALIZED` does: 8 s a run rather than 20.
Hoisting each column's two calls into a lateral so they might share one detoast
does not help (8.1 s against 8.4 s), because each call detoasts on its own. That is what this
rule adds to a report that answered in 2.5 s without it.
`administrative_divisions` is not covered and comes off the same function:
reading its full-resolution column would cost this report an order of magnitude
more than it answers in today, its eight root divisions weighing 386 MB between
them, so what holds the rule there is `renderedRungTopology.test.ts` over the
schema text.

**The two boundary rules** watch the set everything else is built on.
`administrative_divisions` is GADM, loaded once, and a region's geometry is the
union of the divisions it holds — so a defect there is not one wrong row but a
hole in every polygon above it, in every world view built on it, at every zoom.
That is #665: the loader folded 2831 rows whose deepest name GADM left empty into
their parents, and 86 divisions ended up stored as leaves holding one tambon's
polygon while their real children hung beneath them, reaching no ancestor.
Thailand's country polygon carried 54 interior rings, 20 742 km² of them, and the
map showed white patches inside the region fill around Nakhon Ratchasima and
Surin. Every run had reported success; a person looking at the map found it.

They ask that defect two ways on purpose, and today they answer with the same
rows. The first reads the **flag** — a division marked as having no children that
has them — and the second reads the **geometry**: a division still carrying the
`gadm_uid` of one source polygon while children hang beneath it, where a parent's
geometry is a union and has no source row of its own. The two come apart the
moment something repairs one half: a `has_children` corrected in place leaves the
polygon where it was, so the map keeps its hole while the first rule reports
clear.

Neither compares areas, which is how the same question is asked of regions.
`administrative_divisions.geom_area_km2` is declared and never written — nothing
fills it — and measuring 392 112 polygons on the fly costs eight seconds, which is what one
rule reading a full-resolution column already costs this report. It would also
not fire: a country is
short by its holes, and Thailand's 20 742 km² are 4 % of it, well inside the nine
tenths the region rule allows. What separates these rows is exact and costs an
index lookup, so that is what is asked — about a second for the pair, measured.
`db/migrations/034-unnamed-gadm-rows.sql` is the repair, and both rules name it.

**The danger rule** is about one fact stored twice. A World Heritage site in
danger is written into the row as the `in_danger` tag and as the
`metadata.inDanger` flag the badge keys on, and the two disagreed on every row
for four years while every sync run reported success — a run compares what it
fetched against what it stored, and both halves were stored exactly as the
importer meant them. The tag was right on 58 sites, the flag was false on all
1272, and the badge appeared for nobody (#600). It asks the two stored columns
rather than UNESCO's own field, which is what keeps it a rule about this
catalogue instead of a second copy of the importer's reading — the copy that
would rot — and it asks in **both** directions, because the halves fail
differently: tagged with no flag is the danger-listed site showing nothing
that `035-in-danger-flag.sql` repaired, while flagged with no tag tells a
traveller a place is in peril on no evidence at all. It reports nothing today;
the migration left the two agreeing on every row. One window is left out on
purpose: a row whose held proposal holds the flag itself. Under a gated
category the run writes `tags` past the gate — labels nothing renders, derived
from facts the row stores by name (#570) — and holds the flag with the rest of
the row, so a site the Committee has just listed carries the tag ahead of the
flag until a curator publishes the card, and one just delisted the other way
round. That is the two halves apart by design and invisible to readers, since
the badge follows the flag; reporting it would fill the screen after every
Committee session with rows the import did not break. The exclusion asks the
changeset `pending_change_sync_log_id` points at whether it holds
`metadata.inDanger`, not merely whether a pointer is set: any held field sets
the pointer, and on the dev database every one of the 1272 UNESCO rows carries
one (the criteria and a credit are held on all of them) while 58 hold the flag
— a bare pointer test would have switched the check off for the whole category
it was written for. Since #722 it asks one thing more: whether that held flag is
still **unanswered**. A curator who says "not this" to the proposed flag has
settled it, and no card will ever come round to reconcile the two halves — which
is the disagreement this check exists to report rather than one to go on
excusing. `picture-with-nobody-credited`'s `credit_waiting` arms narrowed alongside it,
though on a refusal alone rather than on any answer — see its own section for why.

The last is a licence obligation rather than a consistency rule. Most Commons
files are CC BY or CC BY-SA, which of a page that merely shows a photograph ask
that its author be named wherever it appears — and every picture the product
draws is a Commons file (ADR-0043), so that is the only term in play.
`imageCredit.ts` captures the credit at sync time and `ImageCreditLine` renders
it, so a row holding a picture the product draws and no credit is a picture
displayed with nobody named. It asks nothing about lifecycle: the curation
screens show pending rows to curators, and working on the catalogue rather than
publishing it does not change whose photograph it is.

Its two halves got there differently, and the line says which a row is. When it
landed (2026-08-24) it counted 1590 of 1604 objects, and 1414 of those had a
`held` change naming `imageCredit` waiting in the queue — the portal's own
photographer, fetched for a photograph the product has since stopped drawing.
The World Heritage rows carry a Commons picture *with* its credit now, written by
the repair rather than proposed, so on the dev database the count fell to the 330
Commons pictures that really lack one (2026-09-02). What `credit_waiting` still
tells apart is a credit a run fetched and the gate is holding — publishing that
change names them — from one nobody has fetched. The arm reads **both
record shapes**, because both are live: since ADR-0039 the credit is an entry of
its own (`metadata.imageCredit`, whose value is the credit), and a card filed
before it carries the credit as a key inside the `metadata` catch-all's payload.
Asking only the older shape would answer "go and fetch one" for every card a run
files from here — measured mid-transition on the development catalogue, 1315 of
the 1514 it reports. On the works nothing had fetched one when the check landed
(1321 of 1321): `treasureWriter` writes a work's credit straight into its row, a
museum run is what writes these, and the runs since have brought that to 77
(2026-09-02). The one case where a work's credit
*is* waiting is a held picture: since ADR-0037 the treasures upsert holds a visible
work's picture under a gated museum, and the credit the run fetched for it rides in
the museum's contents record beside the held `image_url` — so the work arm asks the
museum's pointer for a held `metadata.imageCredit` naming the work, through this
venue's link, and says "waiting" only there. A credit fetched for the picture the
row already shows is written, not held. "Publish what is waiting" and "go and
fetch it" are different afternoons.

Both arms ask for a held credit the curator has not **refused** since #722. A
refused credit is not waiting on anybody: the curator has said no to that value,
the queue has dropped the row, and nothing will come round to write it — so the
line has to stop saying "publish what is waiting" and let the row be reported as
the credit-less picture it is. The one that reaches a reader arrives this way,
and **only on a card filed before ADR-0039**: refuse an object's source data and
then publish its held picture, and `picture-with-nobody-credited` is what names
it. On anything a run files from here the combination is unreachable — where the
run holds both, `partnerOf` refuses the picture along with the credit; where it
holds the credit alone there is no picture row to publish.

Refused and not merely *answered*, which is where this parts company with
`danger-flag-disagrees-with-its-tag` — that one excuses a row on any answer,
because a published flag is a flag that landed. A published credit is not. On a
card **filed before ADR-0039** whose picture is still open and offers a different
file, publishing the source-data row deliberately withholds the run's credit — the stored one names a
photograph nobody will see, and the run's may not be written under a picture the
row does not yet show — and publishing the picture afterwards finishes what that
call had to leave (`publishHeldFields.ts`, `creditPin`). So the credit really is
still waiting, and treating "answered" as settled would send an admin to go and
find a photographer the queue is one click from naming.

## Adding an assertion

Write a `CatalogueAssertion` — an id, an area, the sentence a person reads,
`invariant` or `watch`, what a matching row means and who has to do what about
it, the query, and how to say one of its rows out loud — and put it in the
`catalogueAssertions` array in
`backend/src/controllers/admin/dataAssertions/catalogueAssertions.ts`. Nothing
else needs touching: the panel groups by area on its own, and the new assertion
arrives with no accepted number, so its first appearance states the debt it
found.

A rule need not live in that file. Where a subject brings several at once, they
go in a file of their own beside it, exporting an array the registry imports and
spreads — `regionGeometryAssertions.ts` is the first, five rules about a
region's shape, its focus box, its anchor and the rungs the map draws it from. Two things follow for that shape:
the type and the row helpers come from `assertion.ts` rather than from the
registry, so the two files do not import each other; and the tests live beside
the rules, with `catalogueAssertions.test.ts` keeping only what it asserts about
the set as a whole (unique ids, an area each, which rules are watches).

Two rules about the SQL:

- **Compose the predicates the product already composes.** An assertion about
  what a reader sees imports the fragments from `experienceLifecycle.ts`; one
  about placement uses placement's own predicate; one about the curation queue
  composes `heldWaitingSql` — and, where it asks about one *field* rather than
  about the row, `heldDecisions.ts`'s own fragment, so a proposal a curator has
  already settled stops being reported as waiting on one (#722) — where "settled"
  is the answered fragment for the danger flag and the *refused* one for the
  credit, since publishing a credit does not always write it.
  An assertion that asks a slightly different
  question than the read it guards is worse than no assertion, because it
  reports clear while the screens disagree. This is why the assertions live in
  the controller layer: the service layer may not import a controller, and these
  have to read the real predicates rather than copies of them. The one
  exception is deliberate and is the opposite rule: an assertion that exists to
  catch a *writer* being wrong must not compose that writer's own logic, or it
  agrees with it on every row it got wrong. The world-frame rule reads the
  geometry by its longitude bands rather than through `geometry_focus()` for
  exactly that reason, and its test pins that it never names the trigger.
- **Say the row the way a person would say it.** "A museum's place is marked as
  withdrawn while its replacement is 1.2 cm away", not a rule id and two primary
  keys. The sentence is built on the server, so there is one place that knows
  how to say a row out loud.

## Where it sits

Two endpoints, both admin-only, rate-limited apart from each other:

- `GET /api/admin/data-assertions` — every assertion, what it found, up to ten
  rows of it as sentences, and what was accepted. About 2.5 seconds over 1604
  objects, 6693 places and 8132 regions until the rung rule was added, and about
  11 with it — that rule alone is 8 s, because it reads a full-resolution
  geometry column for every row. `framed-as-the-world` reads one too, but only
  for the rows that already failed a cheap predicate on the stored box. Either
  way the panel reads it when somebody opens the section rather than polling.
- `POST /api/admin/data-assertions/accept` — record what one assertion currently
  finds. Refuses an unknown id, refuses a `watch`, and records nothing for an
  assertion whose query could not run.

The report carries `expensiveAdminLimiter` (5/min), with the other expensive
admin work; the acceptance carries `authenticatedLimiter` (60/min) instead,
because the state this screen exists for is a database where nobody has
answered for anything — a press per invariant — and five a minute is
five for the whole address an admin works from. See
`docs/tech/rate-limiting.md`.

Until `db/migrations/031-data-assertion-acceptances.sql` is applied, the ledger
does not exist. The report says so in a sentence naming the file, reports every
check with no accepted number, and refuses an acceptance with the same sentence
— rather than answering the screen with a stack trace at the moment somebody
opens it for the first time.

## What this is not

Two neighbouring lanes are tracked separately and neither is replaced by this
one. #522 is an executable SQL lane that would catch a predicate meaning the
wrong thing *before* it ships. #497 is a per-run anomaly report that would catch
a defect *as it happens*, per object, for a curator. This one watches the
resting state — what the database holds right now, whoever put it there and
whenever.

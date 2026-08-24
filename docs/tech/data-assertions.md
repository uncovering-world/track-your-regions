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
displayed with nobody credited.

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
| pictures | A picture shown with nobody credited | invariant |

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

The last is a licence obligation rather than a consistency rule. Most Commons
files are CC BY or CC BY-SA, which of a page that merely shows a photograph ask
that its author be named wherever it appears, and UNESCO's syndication terms ask
the same in their own words. `imageCredit.ts` captures the credit at sync time
and `ImageCreditLine` renders it, so a row holding a picture and no credit is a
picture displayed with nobody named. It asks nothing about lifecycle: the
curation screens show pending rows to curators, and working on the catalogue
rather than publishing it does not change whose photograph it is.

Its two halves got there differently, and the line says which a row is. On the
objects the author is already known: 1414 of the 1590 have a `held` change
naming `imageCredit` waiting in the curation queue, so a run fetched the
photographer, the gate refused to write it unread, and the page has been showing
the picture ever since — publishing that change names them. On the works nothing
has fetched one at all: `treasureWriter` writes a work's credit straight into
its row rather than proposing it, no `contents` changeset mentions a credit, and
a museum run is what writes these. "Publish what is waiting" and "go and fetch
it" are different afternoons.

## Adding an assertion

Add an object to `catalogueAssertions` in
`backend/src/controllers/admin/dataAssertions/catalogueAssertions.ts`: an id, an
area, the sentence a person reads, `invariant` or `watch`, what a matching row
means and who has to do what about it, the query, and how to say one of its rows
out loud. Nothing else needs touching — the panel groups by area on its own, and
the new assertion arrives with no accepted number, so its first appearance
states the debt it found.

Two rules about the SQL:

- **Compose the predicates the product already composes.** An assertion about
  what a reader sees imports the fragments from `experienceLifecycle.ts`; one
  about placement uses placement's own predicate; one about the curation queue
  composes `heldWaitingSql`. An assertion that asks a slightly different
  question than the read it guards is worse than no assertion, because it
  reports clear while the screens disagree. This is why the assertions live in
  the controller layer: the service layer may not import a controller, and these
  have to read the real predicates rather than copies of them.
- **Say the row the way a person would say it.** "A museum's place is marked as
  withdrawn while its replacement is 1.2 cm away", not a rule id and two primary
  keys. The sentence is built on the server, so there is one place that knows
  how to say a row out loud.

## Where it sits

Two endpoints, both admin-only, rate-limited apart from each other:

- `GET /api/admin/data-assertions` — every assertion, what it found, up to ten
  rows of it as sentences, and what was accepted. About 1.5 seconds over 1604
  objects, 6693 places and 8132 regions, so the panel reads it when somebody
  opens the section rather than polling.
- `POST /api/admin/data-assertions/accept` — record what one assertion currently
  finds. Refuses an unknown id, refuses a `watch`, and records nothing for an
  assertion whose query could not run.

The report carries `expensiveAdminLimiter` (5/min), with the other expensive
admin work; the acceptance carries `authenticatedLimiter` (60/min) instead,
because the state this screen exists for is a database where nobody has
answered for anything — six invariants, one press each — and five a minute is
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

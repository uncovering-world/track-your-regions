# ADR-0027: A point the source rewrites more precisely is the same point

**Date:** 2026-08-16
**Status:** Accepted

---

## Context

`writeExperienceLocations` decides whether a stored point is the one the source is offering by
comparing two things: the reference, and the geometry **exactly**.

```sql
AND el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
AND el.external_ref IS NOT DISTINCT FROM i.external_ref
```

A coordinate differing in its last float digits is therefore a different place. The stored row is
marked `missing_since`, a row is inserted beside it, and everything a withdrawal drags with it
follows — the pin leaves every reader-facing read (ADR-0022), the row's `auto` region assignments
are dropped, the changeset records a departure and an arrival (ADR-0026), and under a gated source
the pair holds the old pin visible until someone publishes the new one.

**This is a quarter of the catalogue waiting for one re-publication, not one row.** 1642 of the
6680 stored points — **24.6%** — sit on a coordinate rounded to exactly six decimals, 889 of them
with six significant digits rather than fewer. That is what UNESCO's own data looks like: the World
Heritage list publishes each property's coordinates as degrees, minutes and seconds, and a
conversion to decimal degrees lands on six places. Every one of those points is a float rewrite away
from being read as a departure, and the rewrite arrives per source rather than per point — one
re-publication at full precision withdraws a thousand pins in a single run, drops their region
assignments, and raises a thousand cards that have no true answer. Bilbao is not the size of this
defect; it is the first instance of it.

**The catalogue's only withdrawal is this, and nothing else.** Bilbao Fine Arts Museum
(`Q127064`, experience 1592) holds two rows under one reference: 13211 at latitude `43.265974`,
marked on 2026-08-10, and 13398 at `43.265973888`, offered. The geography distance between them is
**0.01244 m** — the stored value had been rounded to six decimals, and the run of 2026-08-10 wrote
the source's own. So the whole live evidence of the withdrawal machinery is one false positive, and
a curator answered it: the audit log carries `location_marked_former` against a point that never
left.

**The object level already draws this line and the point level does not.** `changeSet.ts` has
`LOCATION_UNCHANGED_METERS = 10` and applies it to the experience's own coordinate, so the same
source jitter is *noise* one level up and a *departure* one level down.

Four measurements decide the shape, taken on the live catalogue 2026-08-16.

**A reference is what identity can rest on.** 6679 of 6680 points carry `external_ref`; one does
not, and it is alone in its object.

**A distance-only match would be catastrophic.** 4172 pairs of points of the *same* experience lie
within a kilometre of each other, and many are at **0.000 m** — Rock Art of the Mediterranean Basin
carries components `874-523` and `874-525` at one coordinate. A tolerance applied without the
reference would let an incoming point match a stored row belonging to a different component.

**Inside a reference the separation is five orders of magnitude.** Nine
`(experience_id, external_ref)` pairs hold more than one point. One is Bilbao at 0.012 m. The other
eight are the domain's own doing, and worth reading rather than counting: a UNESCO reference is a
*component number* within a nomination — `874-523` is component 523 of property 874 — and the
`bis` / `ter` / `quater` / `rev` markers are the extension mechanism, which is how one component
number comes to hold two places. Seven of the eight are transboundary properties extended across a
border under the same component: Waterton Glacier (`354rev-001`, US and Canada) at 37.8 km,
W-Arly-Pendjari (`749ter-001`, Benin, Burkina Faso and Niger) holding **three** points across
47–63 km, Maloti-Drakensberg (`985ter-001`, South Africa and Lesotho) at 71.5 km, iSimangaliso and
Maputo (`914bis-001`) at 158.6 km. The eighth is not transboundary at all — Historic Centre of
Mexico City *and Xochimilco* (`412-003`) is one country and two parts of one city, 14 057 m apart,
and it is the closest of them. 331 experiences carry extension-marked references, so this shape is
ordinary rather than exotic. There is no tolerance between 1 m and 1 km that gets any of them wrong.

**The repair costs nothing.** 13211 carries zero visit records and zero `experience_location_regions`
rows; 13398 carries the ordinal and all three region rows.

## Decision

**1. Identity is the reference first, and geometry within a tolerance second.** A stored row is the
point the source is offering when `external_ref` matches and the two coordinates are within
`LOCATION_UNCHANGED_METERS` of each other. This narrows ADR-0022's "point together with the
reference" rather than replacing it: the reference still decides *which* row is a candidate, and the
geometry still decides whether the source is talking about the same place.

**2. The tolerance is the constant the object's own point already uses.** Ten metres, imported from
`changeSet.ts` rather than spelled again, because it answers the same question — is this the same
place, written differently — and two numbers would be two answers. The measured gap says any value
between 1 m and 1 km behaves identically on today's data; the reason to pick this one is that it is
already the answer elsewhere.

Ten metres is also the right *kind* of number for what this has to distinguish, and deliberately
tight. It is below the width of the things being pointed at — a museum's door against its centroid,
a rock shelter against the cliff it is in — so it cannot swallow a source telling us something. When
a source re-centres a national park by two kilometres, or moves a museum's pin from the building to
its new entrance across the square, that is editorial judgement about a place and the product should
raise a card for it. What ten metres absorbs is arithmetic: a rounding, a datum conversion, a float
written twice. A traveller cannot stand ten metres from a World Heritage component and be in the
wrong place; they can stand two kilometres away and be outside the park.

**3. Where there is no reference, geometry stays exact.** Without a reference there is nothing to
make a candidate *of*, so a tolerance would be a nearest-point search over an object's own points —
which the 4172 close pairs say is unsafe in general, even though the single ref-less row could not
be hurt by it today. A rule that is safe only because of how the data happens to look is not a rule.

**4. A row a write arm touches adopts the source's coordinate. A row the fast path matches keeps the
one it has.** The `kept` and resurrection arms write `location` beside the ordinal, reference and
name they already write. In the case this ADR is about the source's value is the more precise of the
two — it is what the rounding lost — but nothing upstream enforces that: the parser takes whatever
numbers the source publishes, so a source could in principle publish a *coarser* coordinate within
the tolerance and the arm would adopt it too. That is the right behaviour for the same reason: the
row should carry what the source says today, and inside ten metres neither value puts a traveller in
a different place. What the arm adopts is the current value, not the better one. The fast path writes nothing at all, which is the whole of why it is
cheap enough to ask on every object of every run, so an object whose *only* difference is a rewritten
coordinate returns before any arm runs and goes on serving the retired value indefinitely.

Both halves are deliberate, and the asymmetry is here in the decision rather than only in
Consequences because "matched" then means two different things on the two paths. Converging inside
the arms is free — the row is being written anyway. Converging inside the fast path would cost a
transaction per object per run for digits no reader can see ten metres of, which is the churn this
change exists to remove.

**4a. A row whose coordinate the arm moved goes back for region placement, at any distance.** The
arm reports the distance it paired at, and the writer's `unchanged` list — whose contract is
"assignments are still valid" — takes only the rows that paired at nought metres. Ten metres is
nothing to a traveller and everything to a polygon: a region's edge is a *line*, so there is no
distance small enough to be safe beside one, and a component rewritten a centimetre across a
boundary would otherwise keep the `experience_location_regions` row of the country it just left. It
would keep it permanently, because the fast path matches the new coordinate on every run afterwards
and nothing revisits the row. The cost is one placement per moved point on the slow path only, and a
run that merely reorders a components list without rewriting coordinates pays nothing, because every
distance is then nought.

**5. Every site that asks the question composes one fragment, and the writing arms read one
decided pairing.** `samePointSql()` is the fragment, and **two** sites compose it: the `candidate`
relation the pairing is built from, and the fast path's `matched` term. Everything else reads the
*pairing* — the arms that keep, resurrect and insert, the arms that withdraw and hold, the statement
that lets go of a spent pairing, and the withdrawal-to-arrival lookup that decides which point each
arrival replaces. Which is every statement after the one that decides it, stated that way rather than
counted: the count was wrong twice on the branch that introduced it, as statements moved onto the
pairing one at a time. All of them ask whether a row is in the pairing rather than whether the
incoming list has anything near it.

Nearness is the wrong question for every one of them, and for two different reasons. For the arms
that withdraw and hold: a row that lost the pairing *is* near the incoming point, so a nearness test
excludes it from every arm at once and strands it with the negative ordinal the parking step gave it.
For the lookup: the set it withdraws from must cover **every row the mark will mark that a reader can
see**, or a run applies more of those than it holds — a visible pin leaving the map under a gate with
only an invisible `pending` arrival to replace it, which is the one failure the deferral exists to
prevent.

Not "the set the mark will mark", and the qualification is doing work in both directions, because the
two predicates differ by two terms and the terms pull opposite ways.

The lookup passes over only rows held by an arrival *this run keeps*, where the mark passes over any
row an arrival waits on — so the lookup is the **wider** set there, deliberately. Where the two
disagree, a point was moved twice before anybody published the first replacement: that first arrival
is itself unoffered now, so the row it was holding has to be available for the second arrival to pair
with, or the row ends the run with no pointer on it and a reader sees two pins on a one-point site.

The lookup is also **narrower** on the visibility side, and that is where "visible" has to be taken
at its own word rather than approximated. A deferral slot is scarce — one per arrival — so a slot
spent on a row nobody is looking at leaves a visible pin unheld. The lookup therefore asks all three
terms of what a reader is offered: `missing_since IS NULL`, `existence <> 'lost'`, and
`curation_state <> 'pending'`, where the mark asks only the first. The `existence` term is the one
easily left out and it is reachable: a curator answers "no longer exists" on a withdrawn point, the
source offers it again so the resurrection arm clears `missing_since` and deliberately leaves
`existence` alone (decision 5 of ADR-0021's lineage — a curator's `lost` outlives a source that keeps
listing a demolished building), and a later run drops it again. That row is invisible, unpaired and
not pending.

Dropping any of the three to make the coverage total is the edit that rebuilds the chain the writer's
own note calls recoverable only by hand-written SQL: an invisible row takes the deferral slot, and the
visible pin it should have released stays on the map beside its replacement.
Before the tolerance those two questions were one predicate, which is what made the count in that
docblock a derivation rather than a hope; keeping them one is now something the code has to do on
purpose.

They read one pairing built per run, because a tolerance gives away an injectivity the
exact comparison had for free: two rows cannot share a coordinate *and* a reference, but two rows
ten metres apart under one reference both answer the tolerance for one incoming point. Keeping and
resurrecting would then write one ordinal onto two rows, `UNIQUE(experience_id, ordinal)` would
abort, and that experience's write would die on every run afterwards.

**Built once means materialised, not repeated as a CTE.** A CTE would be re-decided by every
statement that reads it, against the state the previous ones left — and the first of them,
`kept`, changes exactly that state: adopting the source's coordinate moves a stored row *off* every
other incoming point it was near. An ordinal that had lost the pairing to that row could then win it
back from a second row, after every arm that would have written its ordinal had already run. The row
would keep the negative ordinal the parking step gave it, stay visible, and collide with the next
run's parking — the same permanent abort the pairing exists to prevent, reached from the other side.
So the pairing is a temp table created after the parking step and dropped on commit, and every
statement below it reads a decision rather than re-deriving one of its own.

**With one addition to it, in the statement that earns it.** The table predates every row the insert
writes, and membership of it is the withdrawal arm's only test of whether a source still offers a
row — so a point the run had just added answered every predicate of the mark: added and withdrawn by
one run, hidden from every reader, its regions never written because placement takes offered rows
only, and under a gate left pending *and* marked, which no publish can release. The insert therefore
extends the pairing in the same statement, at nought metres, the row having been written on the
incoming point.

That is what makes the exhaustiveness argument true, and it is an argument about *stored rows* rather
than about the source's list: every row of this experience that a reader can see is either in the
pairing or reaches the withdrawal arm, and no statement can move the boundary between those two after
another has acted on it. The source's list is a separate question — decision 5b can drop an entry
from it before pairing begins, which is why that cost is stated in Consequences rather than covered
here.

**5a. The pairing is one-to-one from both directions, and prefers the row that is not marked.**
Two passes, each with its own ordering, and both are stated because each decides something
different: `DISTINCT ON (ordinal) … ORDER BY ordinal, (missing_since IS NULL) DESC, metres,
location_id` chooses which row answers for each incoming point, and
`DISTINCT ON (location_id) … ORDER BY location_id, ordinal` decides which ordinal keeps a row two of
them chose. The first order is the product decision: between a
marked row and an unmarked one at the same distance the unmarked one wins, so a run reaches for a
ghost only when nothing live answers.

Unmarked is not the same as *visible*, and under a gate the two come apart in exactly the shape this
ADR is about. In a held false withdrawal both rows carry `missing_since NULL`, so the first term ties
and `metres` gives the pairing to the `pending` arrival sitting on the source's own coordinate, not to
the visible row a centimetre off it — and `kept` then writes onto the row nobody can see. That is
correct: what holds the visible row visible is the arrival's pointer at it, not the pairing. It is
recorded here because "prefers the visible row" is the wrong prediction, and predicting the writer
wrongly is how the migration beside it acquired an arm for a state that cannot occur.

What loses the pairing is withdrawn, and *because* it lost — not on any merits of its own. The
withdrawal and hold arms ask membership of `paired` for the reason nearness cannot serve them, stated
in decision 5: a row that lost is near the incoming point by construction. An unmatched marked row
stays marked; an unmatched offered row reaches the withdrawal arm. Degrading to "the point stays where
it was" is the only failure mode that keeps a reader's map and a curator's queue describing one
catalogue.

**5a-i. The pairing is greedy, and the pairing it can miss is a stated cost rather than an
oversight.** `DISTINCT ON (ordinal)` commits every incoming point to its best row before
`DISTINCT ON (location_id)` finds out that two of them chose the same one, and the second pass drops
the later ordinal instead of sending it to its next candidate. So a complete pairing can exist and go
unfound. Measured against PostGIS rather than argued: one reference, two incoming points 15.0 m
apart, stored rows 7.5 m from both and 7.6 m from the second — the passes return one pair where two
were there for the taking. The ordinal that loses is inserted as a new row, the stored row that loses
is withdrawn, and that is this ADR's own disease in miniature: one departure that did not happen and
one arrival that is not new.

What it does **not** cost is a pin, and that is decision 5's doing rather than luck. Because the
withdrawal-to-arrival lookup reads the pairing and not nearness, the loser is in the set that can be
held — so under a gated source its withdrawal waits for the invisible arrival to be published, and a
reader keeps seeing the point throughout. Under an ungated source the replacement is visible the
moment it lands. Either way the mistake a curator meets is a card, not a hole in the map.

Accepted, on what it takes and what it costs. It takes a source to publish two points under one
reference **between ten and twenty metres apart** — nearer and decision 5b has already made them one
point, farther and neither can reach the other's row. Nothing in the catalogue is shaped that way:
the nine references carrying more than one point are Bilbao's at 1.2 cm and eight transboundary
components standing 14 km apart and more. And it does not accumulate — the run leaves the new row on
the incoming coordinate, so the next run pairs both points at zero metres and the wrongly withdrawn
row stays quietly marked instead of being re-decided every run. A maximum matching would want a
recursive CTE inside the relation five arms read, to recover a pairing no source is asking for;
[#549](https://github.com/uncovering-world/track-your-regions/issues/549) holds it against the day
one does. What the unit lane can pin is the ordering, so a change to it is a decision; the loss
itself needs SQL run against Postgres, which is
[#522](https://github.com/uncovering-world/track-your-regions/issues/522).

**5b. The incoming list is deduped by the same rule.** Two entries carrying one reference within ten
metres of each other are indistinguishable to every rule here, so the first survives and the second
is dropped — the existing exact-key dedupe widened to the matcher's question. Without it the ambiguity
moves to the other side: both entries answer for one stored row, and because the pairing is one-to-one
the lower ordinal takes it while the other is *inserted*. Not silently and not arbitrarily — that is
what decision 5a's ordering buys — but the run then manufactures a second row nine metres from the
first under one reference, which is the pair this ADR exists to remove and decision 6's migration
exists to repair. The next run pairs one of them and marks the other. The cost of deduping instead is
stated in Consequences.

**6. The false withdrawals already recorded are repaired by rule, not by id.** A migration collapses
every pair a run left under one reference within the tolerance — the marked row and the offered one —
onto the offered row, which is the one carrying the ordinal and the region assignments. Written as a
rule rather than as Bilbao's two ids because 1642 rounded coordinates are behind this and another
pair can appear between now and the fix landing on any given database.

Deletion of the ghost rather than marking, against ADR-0022's own rule, and only where that rule has
nothing to protect. In the marked shape that means **no visit record and no
`experience_location_regions` row**. In the held shape the ghost is the pending arrival, whose `auto`
placements are spent on purpose: they are recomputable by the next run, and the row was on no
reader-facing read while it held them. A visit bars the repair in both. Bilbao's
13211 has neither, measured. Where a marked row *does* carry a visit, the migration leaves it
standing and says so in its output: a traveller's record is the thing ADR-0022 exists for, and
re-pointing it at another row by migration would be a second guess about which place a person went
to. Those are for a curator, through the surface #544 is about.

The wrong verdict goes with the row — on the surviving row `source_membership` and `existence` stay
at their defaults, so the point is undecided again because there is nothing to decide. The audit
trail keeps its `location_marked_former` entry: the trail records what a person did, and they did do
it. The migration says in as many words that the entry answers a question the product should never
have asked.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A distance tolerance without the reference (`ST_DWithin` alone) | Decision 1. 4172 same-experience pairs sit within a kilometre and many share a coordinate exactly, so an incoming component would match another component's row — turning a cosmetic bug into a silent identity swap |
| Round every coordinate on the way in, once, everywhere | It makes the comparison exact again by throwing away precision the source paid for, and it moves the pin: rounding to six decimals is up to 5.6 cm at the equator, applied to all 6680 points rather than to the one being compared. It also cannot be undone once written, and #502's coordinate editor is about to write coordinates by hand into the same column |
| Compare in degrees (`abs(lat - lat) < 1e-6`) | A degree is not a distance: the same tolerance is 11 cm of latitude and, at Svalbard, 4 cm of longitude. The catalogue holds points from 78°N to 54°S |
| Keep the exact comparison and let the curator answer the card | The card is honest and the question is not answerable: "the same place written more precisely" is not a verdict about the world. #543 measured it as 100% of the live evidence, and a queue that asks a question with no true answer teaches a curator to answer at random |
| Repair Bilbao by hand in the dev database | It is one row today only because one coordinate has been rewritten so far, with 1642 rounded ones behind it. A migration is what makes the repair reproducible on whatever database the fix lands on — and it is written to collapse *any* pair a run left under one reference within the tolerance, not Bilbao's two ids, because the next run of any source can produce another before the fix ships |
| Mark 13211 rather than delete it (ADR-0022's rule) | That rule protects a visit and a manual assignment, and this row has neither — measured. A marked duplicate would leave the false withdrawal in the record and in the queue's complement for ever |

## Consequences

- The catalogue's withdrawal machinery loses its only live example, which is the point of the change:
  the writer raises no card at all for a rewrite inside ten metres. Not "every card from here on is a
  real departure" — this ADR names two ways one is not. Decision 6's migration leaves a pair standing
  wherever a visit or a manual assignment hangs off the marked row, and answering such a card "false
  alarm" leaves two visible rows a centimetre apart for the next run to withdraw one of again; and
  decision 5a-i's greedy loss writes a departure that did not happen. Both are false withdrawals a
  curator can still meet, which is why the card says so itself rather than promising otherwise.
- **The changeset's contents delta stops carrying departures that never happened** (ADR-0026
  decision 1), by two different routes and worth separating. A rewrite that is the object's *only*
  change takes the fast path, which writes nothing and records nothing — no row, no delta, no card.
  A rewrite arriving beside some other change reaches the keeping or resurrection arm, which updates
  the row in place and so reports neither a withdrawal nor an arrival for it. The old behaviour
  reported both, on either route.
- A point can drift, ten metres at a time, if a source keeps moving it: each run compares against the
  stored value, so ten runs of nine metres walk the point ninety. That is the source's own coordinate
  and adopting it is honest, but it means the object-level `LOCATION_UNCHANGED_METERS` diff and this
  one now share a blind spot, and neither reports a walk. Nothing in the catalogue does this today.
- A move of more than ten metres is still a withdrawal plus an arrival, which is what the eight
  transboundary references would look like if a source ever moved one of their components.
- The tolerance is now a shared constant with two consumers, so changing it changes both — which is
  the property decision 2 is asking for, and the reason it is imported rather than repeated.
- **A point the source offers can go unwritten.** Decision 5b drops an incoming entry whose
  reference and place match one already kept, so a source listing one component twice within ten
  metres has one of them recorded and no delta entry for the other. Nothing in the catalogue does
  this today — the nine references holding more than one point stand 14 km apart and more — and the
  alternative is worse in kind rather than in degree: the run would write both, as a stored row and
  a second row nine metres from it under one reference, which is this ADR's own disease created
  rather than inherited. Losing an entry the product cannot tell from another beats manufacturing a
  pair a curator then has to answer for.
- **A row the fast path matches keeps its stored coordinate** (decision 4). The object whose only
  change is a rewritten coordinate is exactly the object that takes the fast path — 1235 of 1272
  UNESCO rows per run — so in the common case the catalogue goes on serving a value the source
  retired, within ten metres of the published one. Convergence happens only where something else
  about the object's point set sent it to the arms.
- **A pairing that exists can go unfound** (decision 5a-i). Two greedy passes, so an incoming point
  and a stored row can each end up alone while the other was reachable — costing one withdrawal that
  did not happen and one arrival that is not new, once, for one point. It needs two points under one
  reference between ten and twenty metres apart, which no source in the catalogue publishes, and it
  settles rather than repeating. #549 holds the maximum matching; #522 is the lane that could test
  it.

## References

- Narrows: [ADR-0022](0022-locations-are-marked-not-deleted.md) decision 2 — identity survives the
  gap, and "the same point" now admits a coordinate rewritten within ten metres. Its decision 1
  (marked, not deleted) stands, and decision 6 above is the one exception it allows: a row with
  nothing hanging off it, created by this defect.
- Fixes: [#543](https://github.com/uncovering-world/track-your-regions/issues/543)
- Related ADRs: [ADR-0026](0026-a-run-records-what-a-container-holds.md) (the delta that recorded the
  bogus departure); [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) (where
  `LOCATION_UNCHANGED_METERS` came from)
- Related issues: [#502](https://github.com/uncovering-world/track-your-regions/issues/502) — the
  coordinate editor writes into the same comparison, by hand, which is why the tolerance had to be a
  distance rather than a rounding rule
- Related docs: `docs/tech/experiences.md` § Location model

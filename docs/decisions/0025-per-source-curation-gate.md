# ADR-0025: A source is trusted or it is not, and the product says which

**Date:** 2026-08-10
**Status:** Accepted — decision 5 narrowed by ADR-0037

---

## Context

The catalogue is built by sync runs against Wikidata or an official register, and a run's
output is live the moment it lands. Before this decision, nothing between the fetch and the page
a visitor loads asked whether a person had looked at what the run wrote. A curator can create an
experience by hand instead — `curationController.ts` has that path — but measured against the
live database on 2026-08-09, none of its 1603 experiences came any other way: `is_manual` is
true on zero of them.

The catalogue holds 1603 experiences, 6678 locations and 1340 works. Twelve rows carry any
record of a human decision — nine of them the admission verdicts a curator gave in the days
after ADR-0024 shipped, three of them hand-edited text. Measured that day, twelve rows out of
1603 were the entire human contribution to what a traveller was shown.

The sources behind those rows are not one kind of thing. One publishes an official register
under stable identifiers. The others are built from Wikidata's community edits, and among them
the museum importer has already had to correct itself more than once — entering curatorial
departments and dead collectors' estates as museums before the works-first rule replaced that
logic (ADR-0023), and still needing a rule of its own to refuse archaeological sites, natural
history collections and churches that the same query keeps returning (ADR-0024).

A single rule applied to every source is wrong however it is set. Requiring a curator's sign-off
on everything makes a curator the bottleneck in front of a register that a review would rarely
improve. Requiring nothing leaves the community-edited sources open to exactly the kind of error
the same importer has already had to correct, and once a source is wrong the only remedy today
is to switch it off entirely — there is no way to hold one source to a stricter standard than
another. Either setting, applied to the whole catalogue, answers a question that only makes
sense asked one source at a time.

## Decision

**1. The gate is set per source, not once for the whole catalogue.**
`experience_categories.requires_curation` is a boolean on the table that already stands for a
source — each source is one category and one sync service — so trusting one source while
holding another back needs no new concept of what "a source" is. A single global rule is wrong
in both directions at once, for the reasons above: applied everywhere it makes a curator the
bottleneck in front of a register that a review would rarely improve; applied nowhere it leaves
community data unchecked with no lever but switching the source off.

**2. Three states — `pending`, `auto`, `verified` — apply to four things a reader can see, not
to the experience alone.** `experiences`, `experience_locations`, `experience_treasures` and
`treasures` each gains the same three-state column. Curation is not a property of the
experience; it is a property of anything a run writes that a reader can see, and the product
already tracks an experience, a location and a treasure as separate facts elsewhere in the
schema — a visit, a location visit and a viewed treasure are each held in their own table. This
decision extends that same granularity rather than inventing a new one.

The split is measured and load-bearing, not decorative. Complex geometry lives entirely in
UNESCO, the source least likely to be gated, and treasures live entirely in Top Art Museums, the
source the gate exists for. A design that protects an experience's row and leaves its contents
alone protects the wrong thing: it would let a gated museum publish new paintings the moment a
run finds them, through the one table the gate never reached.

**3. The default is `auto`, not `pending`.** This is a safety choice, not a claim about what is
typical. The sync path for a gated source sets `pending` explicitly, because that path already
knows about the gate. A writer that does not — an existing call site this decision does not
touch, or a future one written without reading it — leaves the column at its default and
reproduces exactly today's behaviour, publishing what it writes. Defaulting to `pending` instead
would let that same forgetful writer remove rows from the product silently, by doing nothing.

**4. Admission is asked before publication.** Whether an object belongs in this catalogue at
all is a question a category's own rule answers (ADR-0024); whether anyone has looked at it yet
is a different question, asked only once the first has been answered yes. The gate must not
reuse `admission` to mean "unpublished": "our rule said no" and "nobody has looked" are opposite
statements, and a row carrying both needs to say both.

**5. Contents are held by being written invisible, not by being withheld.** A gated run writes
what it finds in full: the rows exist, carry their geometry, are indexed, and are placed into
regions. One predicate is what keeps them off a reader-facing read. Publishing is an update to
that predicate, not a replay of a proposal that had nowhere to live until a curator asked for
it. The predicate is a claim on every reader-facing read, and the order in which the two halves
arrive is part of the decision: `pending` is a word the writer says and the reader obeys, so no
source may be gated before every such read honours it. Gated first, the rows would reach readers
exactly as they do today while a curator was told they were waiting — the one state this gate
must never produce, because it is the only one in which the gate is believed and absent at the
same time.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| One global gate | Wrong in both directions at once — see Context. |
| Gate the experience only, not its contents | Treasures are 1370 links in `Top Art Museums`, the source the gate exists for; a museum that gained twelve unchecked paintings would publish them. |
| Withhold contents instead of writing them invisible | Up to 77 kB of jsonb proposal for a 758-point site, needs a geometry probe extracted from the writer, holds a whole museum for one new painting, and pending points would not be placed into regions — so a region curator's queue would be empty. |
| Reuse `admission = 'refused'` for "unpublished" | Opposite statements. A refused row and an unread row need different answers from the curator and different words to the reader. |
| A reader-side "only human-checked" filter | Puts the judgement on whoever is least equipped to make it. Rejected as the *mechanism*; not excluded as a later addition. |
| Approve a run rather than an object | A run is ~1900 items. |

## Consequences

**Positive:**

- A source can be held back without the rest of the catalogue waiting on it, and trusted
  without every other source inheriting that trust.
- A run's mistake is caught at the size it actually occurs: a wrong location or a wrong
  treasure link holds only that row, not the whole experience it belongs to.
- The column defaults to the safe side of a mistake — a writer that forgets the gate keeps
  behaving exactly as it always has, rather than silently withholding something no curator ever
  asked it to hold.

**Negative / Trade-offs:**

- Every experience that exists today takes `auto` the moment this ships — all 1603 of them, of
  which 1576 are the ones a reader is offered — and their locations, their treasures and the links
  between them take it with them. That is stated plainly rather than softened: they are
  published, unread, and the product will now say so instead of leaving the question unasked.
- The gate is `curation_state`, the fourth column that can take a row off a reader's screen,
  after `existence`, `admission` and `missing_since`. Each answers its own question — does it
  still stand, does this catalogue accept it, does its source still offer this point, has anyone
  looked at it yet — and they compose rather than collapse: a row can be admitted, extant,
  offered by its source and still unread, all at once. Merging any two of the four into a single
  predicate is forbidden, because collapsing two of those questions into one column would make it
  impossible to ask about either separately again.

## References

- [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) — the changeset and the two
  lifecycle axes, `source_membership` and `existence`, that this gate leaves untouched and sits
  alongside
- [ADR-0021](0021-source-may-restore-membership.md) — a sync may restore `source_membership` in
  one direction only
- [ADR-0022](0022-locations-are-marked-not-deleted.md) — a location a source withdraws is
  marked, not deleted; this gate marks a row `pending` rather than deleting or withholding it,
  for a different reason
- [ADR-0024](0024-a-category-may-refuse-what-the-source-still-lists.md) — `admission`, the axis
  this gate answers a different question from and must never stand in for
- Issue #500 — "Publish a source's content only when a curator has passed it"
- Issue #501 — "Treasures reach readers unchecked"

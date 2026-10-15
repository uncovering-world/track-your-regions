# ADR-0110: A works floor counts the source's own works, less what its fame line decides

**Date:** 2026-10-15
**Status:** Accepted
**Issue:** [#1536](https://github.com/uncovering-world/track-your-regions/issues/1536)
**Narrows:** [ADR-0044](0044-a-work-leaves-a-museum-behind-a-floor-measured-on-works.md) decision 2

---

## Context

ADR-0044 decision 2 measures a works kind's floor over "the works the catalogue offers at the
museums this run admits", and accepts that a legitimate drop of more than a tenth is refused until
a person reads it. Two things have changed what that sentence counts since it was written.

- **Other kinds' works sit at the same venue.** Since places merge (#1247) and each link records
  the memberships that place it (#1252), a venue a source holds also carries works another kind
  placed there. On 2026-10-15 Archaeology counted 528 works at its admitted museums, of which it
  places 279 itself: the rest are the Louvre's paintings and the like, which Art Museums places. An
  Archaeology run cannot place those again however well it reads, so its floor read 46.8 %.
- **The fame count changed under the works already stored.** #1240 (2026-10-03) counts Wikipedia
  editions instead of every sitelink, and 152 of Art Museums' works entered under the old count
  and now have nine editions, *Khafre Enthroned* among them. The first run since reads that its
  own rule refuses them, and the floor reads that as works it failed to see (86.7 %), on this
  run and every later one.

The maintainer's call of 2026-10-15: works below the fame line leave without a curator's question,
because they would never have entered under the right count, and no "accept the withdrawal"
switch is added.

## Decision

**The floor's base is the works the source itself placed and the catalogue still offers at the
museums the run admits, less the works the run no longer places because its own fame line now
refuses them.**

- **The source's own works.** A link counts when one of the source's memberships places it, or
  when no membership places it at all: that is also the scope the withdrawal arm can mark in.
- **A fame decision, Art Museums' alone for now.** A work leaves the base when its Wikipedia editions, counted by the same
  reader the pools count with, are above zero and below the pools' floor. It is then withdrawn like
  any other withdrawal. A work no Wikipedia counts at all stays in the base, so a deleted item or
  a read that returned nothing still holds the floor. Archaeology and Places of worship count
  their own works and keep every one of them in the base: their lines differ by what a work is,
  and each adopts the exemption with its own line when it needs it.

Everything else in ADR-0044 stands: works, not links; per pool; the 90 %; the mark and its
restore.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| An admin switch that accepts one run's withdrawals | It answers the 152 once, and the next fame change the same way. The maintainer judged the fame line a decision the run can be trusted with, and a switch a step nobody needs. |
| Lower the floor for a run whose drop is mostly below the line | A ratio cannot tell a run that refused works from a run that lost them. Naming the refused works removes them from the question instead. |
| Measure each kind on every offered link at its venues, as before | Archaeology would never clear its floor while the Louvre is both an art museum and an archaeology museum. |

## Consequences

**Positive:**
- Art Museums withdraws the 152 works below ten editions on its next run, without a question to a
  curator, and its floor reads its own works only.
- Archaeology's and Places of worship's floors no longer count the works another kind placed at
  the same venue.

**Negative / Trade-offs:**
- A fame line moved by mistake would withdraw everything it refuses. The line lives in code
  (`POOL_MIN_SITELINKS`) and moves only through a reviewed change.
- ADR-0044's statement that every drop of more than a tenth waits for a person no longer holds for
  this one class of drop.

## References

- Related ADRs: ADR-0044 (the floor), ADR-0082 (Wikipedia editions), ADR-0084 (a place belongs to no source)
- Related docs: `docs/tech/experiences.md` § Art Museums
- PR / issue: #1536

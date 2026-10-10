# ADR-0090: A component renumbered by an extension is the same point

**Date:** 2026-10-10
**Status:** Accepted

---

## Context

A World Heritage property is numbered once (`829`) and renumbered when its inscription is revised
(`166rev`) or extended (`829bis`, `829ter`), and the components of a serial property carry the
property's number: `829bis-001` is Pompeii while the property stands at its first extension,
`829ter-001` once it stands at its second. UNESCO's dataset lists the components under the current
numbering, so an extension changes every component's reference in one publication.

ADR-0022 decision 2 made a point's identity the pair `(point, external_ref)`, and ADR-0027 widened the
point half to ten metres. A reference that changes is therefore a new identity: the run withdraws
the stored row and inserts the incoming one, and under a gated source the insert lands `pending` and
holds the withdrawal until a curator publishes the move (ADR-0025, ADR-0027). Measured on the
development catalogue on 2026-10-10: six properties renumbered since August — Pompeii (`829bis` →
`829ter`, seven components), Graz, the Dorset and East Devon Coast, Rock Art of Alta,
W-Arly-Pendjari and the Danube Limes (Western Segment), 77 components — stand as 102 held pairs: the
old row visible, the new one `pending`, each new row deferring the withdrawal of one of the old
ones.

That is the right shape for a point that moved. It is the wrong shape for a point that did not: the
coordinate and the name are the same to the metre and the letter, and what the pair costs is
everything that hangs off the old row. The published move carries nothing — not the Wikidata item,
the picture, the description or a curator's corrections — and the visit a traveller recorded is on
the withdrawn row, where ADR-0022 decision 4 deliberately leaves it: someone who has stood in Pompeii
would stand there no longer. The component-item finder (#1272) asks a curator about both rows of
each pair. And a curator publishes 102 moves of nothing by hand.

The reference reader (#1269) measured the other side of the same fact on the same day (#1344): a
reference under another variant is not an identity *on Wikidata*, because an extension can renumber
the parts — Wikidata's `1591-004` is Boseong's tidal flat where the list's `1591bis-004` is
Gochang's. So the variant cannot simply be dropped from the reference everywhere: what tells
Pompeii's renumbering from Getbol's is that Pompeii's point did not move.

## Decision

**1. Within the tolerance, a reference that differs only by the inscription's variant is the same
reference.** A stored row pairs with an incoming point when the two references are equal, or when
they name the same property number and part under different variants (`whc_ref_bare`, the one SQL
statement of that comparison), and the geometry is within ten metres (ADR-0027). The row is kept
and its `external_ref` rewritten to the incoming one; its id, item, picture, description, curator's
claims, region assignments and visits are untouched, and no move is raised. ADR-0022 decision 2's
`(point, external_ref)` is narrowed to that reading of the reference; the point half is as ADR-0027
left it. A row whose coordinate a curator claimed pairs on the reference alone at any distance
(ADR-0027, `claimedPointSql`), so for it the geometry cannot tell Pompeii from Getbol: it compares the
reference exactly, as before.

**2. Beyond the tolerance it is a different component.** A renumbered reference at another
coordinate is a withdrawal plus an insert, as today: that is Getbol, where the extension renumbered
the parts. The by-position hold (ADR-0027 decision 5) keeps the reader's map through it.

**3. An exact reference wins the pairing over a variant match.** Where a property's rows carry both
numberings — the held pairs the catalogue holds today — the row whose reference equals the incoming
one is the candidate first, so the writer's choice does not depend on centimetres.

**4. The pairs already standing are folded once.** A migration pairs each `pending` arrival with
the visible row of its experience that names the same property number and part within ten metres —
by place, not through the arrival's deferral pointer, which pairs withdrawals to arrivals by position
in the source's list (Herculaneum's arrival holds Pompeii's withdrawal, 13 km away) — rewrites the old
row's reference to the new one, gives it the arrival's ordinal, and withdraws the arrival as an unread
point is withdrawn (marked, never deleted: ADR-0022 decision 1), clearing its deferral. A surviving
arrival whose pointer names a kept row takes over what the folded arrival of that row was holding,
following the chain, so publishing it never withdraws a kept row and no moved row is left unheld. On
the development catalogue that is 98 pairs in eight properties and no crossed pointer; what stays
pending afterwards moved.

**5. The fast path is not fooled.** A renumbering is a change the writer must write once, so the
unchanged-object comparison asks for the reference exactly; the object takes the slow path on the
run that renumbers it and the fast path on every run after.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the move and make its publish carry the item, picture, claims and re-key the visits | Rewrites four tables' rows to arrive where the row already is, and still asks a curator to publish 102 moves of nothing; the pairing already knows the two rows are one place. |
| Drop the variant from the reference everywhere, the reader included | #1344 measured it: 119 of 302 bare-number matches on Wikidata name another place. The variant is dropped only where the geometry says the place is the same. |
| Delete the `pending` arrival in the fold | ADR-0022 decision 1: a location is marked, never deleted; the arrival's proposals and log rows keep their row. |

## Consequences

**Positive:**
- Pompeii stays Pompeii across an extension: one row, one id, every visit and every curator's word on it.
- A renumbering raises no card; the moved-point card is for a point that moved.
- The finder asks once per component.

**Negative / Trade-offs:**
- The reference's grammar is now stated twice: `parseWhcRef` in TypeScript and `whc_ref_bare` in SQL, held together by a parity test over the shapes the list uses.
- A component that an extension renumbered *and* moved within ten metres of another component's old
  row would pair with that row; the pairing's exact-first order and the ten-metre window bound it,
  and the review queue's moved-point card does not see it, since nothing moved by the writer's
  reading.

## References

- Related ADRs: ADR-0022 (narrowed), ADR-0025, ADR-0027
- Related docs: `docs/tech/experiences.md` § Location lifecycle
- PR / issue: #1346, #1344

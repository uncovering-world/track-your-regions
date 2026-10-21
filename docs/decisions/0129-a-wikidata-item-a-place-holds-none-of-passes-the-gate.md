# ADR-0129: A Wikidata item a place holds none of passes the gate

**Date:** 2026-10-21
**Status:** Accepted
**Issue:** [#1794](https://github.com/uncovering-world/track-your-regions/issues/1794)
**Narrows:** [ADR-0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) decision 1

---

## Context

ADR-0099 let three rewrites of a visible place pass a gated source's hold, *and no other*. Each of
them changes nothing a visitor reads. A fourth such rewrite came back as a held card on every run.

The UNESCO run writes no Wikidata item. A World Heritage site it made therefore holds no
`metadata.wikidataQid`, even when a Wikidata kind admits the same place. Each such kind writes the
item it knows the place by. That item is the id on its membership: `external_id`, Q184427 for
Ajanta Caves. Places of worship and Archaeology both gate a published place (ADR-0052, ADR-0058),
so every one of their runs held the item as a proposal.

Measured on the development catalogue on 2026-10-21:

- 195 places held a Wikidata kind's membership and no item, all of them made by the UNESCO run.
  Aachen Cathedral, the Abbey of St Gall and Nalanda Mahavihara are among them.
- On none of the 2293 unmerged places that do hold an item does that item differ from their
  Wikidata memberships' id. No place has two Wikidata memberships under different ids. The item never
  changed: it only arrived.

No reader surface shows the item (`UNSEEN_BY_READERS` in `fieldMeaning.tsx`). Its arrival asked a
curator a question whose answer changed nothing a visitor sees, on every run.

## Decision

**1. An item arriving where the place holds none passes the gate** (`own-item`). On a held row
`metadata.wikidataQid` is written, filed with the written fields and marked with its class, when
the place holds no item and the run writes a well-formed one (`Q` and a number). Every Wikidata kind
writes as the item the id its own membership carries, so that item is the run's own. Like the other
passing classes, it raises no question, sets no held pointer and demotes no verified membership.

**2. An item replaced by another stays a question.** A different item means the row now points at
a different object, or that Wikidata merged two records. The card says "A different Wikidata item —
check the name and the pin" only for that case. An arriving item, on a card filed before this rule,
reads as the item the source knows the object by.

**3. The places the earlier runs held it from are given the item once** (migration 139). The item
is the one id the place's standing Wikidata memberships share: admitted by their kind and still
listed by their source. A refused or withdrawn membership says nothing about the place any more. A
place whose standing memberships name two different items keeps none, and stays a curator's
question. On dev that writes the item onto 190 of the 195 places; the other 5 hold only a refused
membership.

## Alternatives Considered

- **The UNESCO run writes the item.** The World Heritage list carries no Wikidata item, so the run
  would have to look one up in Wikidata. That is a second reading of a fact which the Wikidata kinds
  of the same place already state, as the id on their own membership.
- **Any Wikidata item a run writes passes.** A replaced item is the one change of this key that a
  curator should read: the row may now describe another object.

## Consequences

- A gated Wikidata kind no longer proposes the item of a World Heritage place. On dev the held cards
  it filed for the 195 places all also held Wikidata's one-line description (#1795), so none of
  them is closed by the migration. Each loses its item row with the source's next run.
- A replaced item is still held.

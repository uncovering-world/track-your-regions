# ADR-0133: A subtitle a place holds none of passes the gate

**Date:** 2026-10-21
**Status:** Accepted
**Issue:** [#1795](https://github.com/uncovering-world/track-your-regions/issues/1795)
**Narrows:** [ADR-0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) decision 1

---

## Context

Since #1795 a place has two texts, each with one meaning. Its **subtitle** is one line under the
name that says what the place is. Its **description** is the paragraph a reader opens. Each source
fills the one it has. The UNESCO run writes UNESCO's paragraph as the description and no subtitle.
The Wikidata kinds (Art Museums, Public Art & Monuments, Places of worship, Archaeology) write
Wikidata's one-line description as the subtitle.

A World Heritage site that the UNESCO run made therefore holds no subtitle, even when a Wikidata
kind admits it too. Places of worship and Archaeology gate a published place (ADR-0052, ADR-0058),
so every one of their runs held Wikidata's line as a proposal. Ajanta Caves got the same card on
every run, proposing "2nd century BCE to 1st century CE Buddhist cave monuments located in
Maharashtra, India".

ADR-0099 lets a rewrite pass the gate only when it changes nothing a visitor would notice, and
ADR-0129 added the Wikidata item. A first subtitle *is* seen: it is the line under the name. But
it replaces nothing. Where it is missing, a reader sees no line at all. The gate exists so that a
source cannot quietly replace what a reader sees (ADR-0025). ADR-0089 made the same call for a
part's empty fields, and left the object's own empty fields out of its scope.

Measured on the development catalogue on 2026-10-21:

- 172 unmerged places held no subtitle while their standing memberships reported one, the same
  line from each. Ajanta Caves, Aachen Cathedral and Nalanda Mahavihara are among them.
- No place had two standing memberships reporting different lines.
- 81 held cards proposed only the subtitle, and 75 proposed the subtitle together with the
  website.

## Decision

**1. A subtitle arriving where the place holds none passes the gate** (`first-subtitle`). On a
held row the subtitle is written when the place holds none, empty or null. It is filed with the
written fields and marked with its class. Like the other passing classes, it raises no question,
sets no held pointer and demotes no verified membership.

**2. A subtitle replaced or removed stays a question.** That changes a line a reader already sees.
A curator's claim keeps the stored value, empty or not. Where two sources of the place report
different lines, the place keeps what it holds, as ADR-0084 decision 4 says, and a curator chooses
between the two views.

**3. The places the earlier runs held it from are given the line once** (migration 143). The line
is one that an admitted membership reports, as the run of an admitted kind writes it. It is
contested as the run contests it, by every view still listed by its source, admitted or not
(`viewStandsSql`). A place whose standing views report two lines keeps none, as the run would keep
it. A card is closed
when the run it names held nothing but that subtitle. The source's next run would close it the
same way, since it finds nothing to propose. On dev the migration writes the line onto 172 places
and closes 81 cards.

The description gets no such rule. An empty description is filled only by the UNESCO run and a
curator, and neither proposes one under a gate today.

## Alternatives Considered

- **Hold the first subtitle as ADR-0099 says.** That keeps 156 cards whose answer does not change.
  A curator would read Wikidata's line beside an empty one, and the line comes from the item that
  the source's own membership names.
- **Any empty field of a place passes.** The description and the picture are what a reader looks
  at when the place opens, and a first picture is the place's face. Those questions belong to the
  object's gate (ADR-0025) and are out of scope here, as they were in ADR-0089.

## Consequences

- A gated Wikidata kind no longer asks about the subtitle of a World Heritage place that holds
  none. A card that held the subtitle with something else, such as the website, loses its subtitle
  row with that source's next run.
- Wikidata's line reaches readers without review. Most lines are specific ("ancient Hindu-Buddhist
  monastery in present-day Bihar, India"). Some are only generic, such as "mine" for the Neolithic
  Flint Mines at Spiennes, or "architectural structure" for the Genbaku Dome. A curator who edits
  one claims it.

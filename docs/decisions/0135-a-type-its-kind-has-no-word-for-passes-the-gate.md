# ADR-0135: A type its kind has no word for passes the gate

**Date:** 2026-10-22
**Status:** Accepted
**Issue:** [#1807](https://github.com/uncovering-world/track-your-regions/issues/1807)
**Narrows:** [ADR-0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) decision 1

---

## Context

A membership is filed under a type within its kind (#1253), and each kind has a closed vocabulary
of types (`frontend/src/utils/experienceTypes.ts`). A reader sees the type as a chip on the place
and filters the kind by it.

#1807 split Public Art & Monuments into two kinds. Public art files a `sculpture`, a `fountain`
or `street-art`. Monuments & memorials files an `arch`, a `column`, an `obelisk`, a `memorial` or
a `monument` (`publicArt/kindRules.ts`). Migration 144 copied every membership of the old kind
into the new one with its state, and so with the old kind's two types, `monument` and
`sculpture`. Neither new kind has both words. Nelson's Column was filed `sculpture` under
Monuments & memorials, and a reader saw the raw word on a chip that no filter of the kind
answers to.

Monuments & memorials gates a published place. Each source's first run filed its places in its
own words, and the gate held every retype of a place a reader sees. On the dry runs of
2026-10-22 it held 98, for example Arc de Triomphe `monument` → `arch` and Nelson's Column
`sculpture` → `column`. None of them was a change the source made. Each was a word the split had
left behind.

ADR-0099 lets a rewrite pass the gate only when a visitor would not notice it. ADR-0129 and
ADR-0133 each added a class. A type chip *is* seen. But a type the kind has no word for states
nothing a reader of that kind can use: no filter finds the place by it, and the review card
cannot name it in the kind's words. The gate exists so that a source cannot quietly replace a
fact a reader holds (ADR-0025), and this value is not one.

## Decision

**1. A type replacing none, or one its kind has no word for, passes the gate**
(`type-outside-vocabulary`). The incoming type must be a word of the kind's vocabulary. The
source declares that vocabulary on the record it writes (`typeVocabulary`, from `KindRule.types`).
On a held row the type is written, filed with the written fields and marked with its class. Like
the other passing classes, it raises no question, sets no held pointer and demotes no verified
membership. A source whose kind declares no vocabulary keeps every type change held, as before.

**2. Every other type change stays a question.** That covers a type moved inside the vocabulary,
such as `memorial` → `monument`. That is a retype on Wikidata, and the reader's chip changes from
one word of the kind to another. It also covers a record that proposes no type, which replaces
none. A curator's claim keeps the stored value.

**3. The types the split kinds inherited are cleared once** (migration 146). Every type of
sources 3 and 6 that no curator claimed is set to none, so each source's next run files its places
in its own words past the gate. On dev the migration clears 550 memberships. Until the next run a
reader sees those places with no type chip.

## Alternatives Considered

- **Hold the retypes as ADR-0099 says.** A curator would read 98 cards, and every answer is
  "yes". Each retype comes from the rule of the source's own kind, not from a change on Wikidata.
- **Rewrite the types in the migration.** The type is read from Wikidata's classes by the kind's
  rule in TypeScript. SQL would need a second copy of that rule.
- **Let any type change pass on the first run after the split.** The rule would hold for one run
  only, and it would also pass a real retype that happened to arrive with that run.

## Consequences

- The split kinds file their places in their own words with their next runs, and no curator is
  asked about them.
- A later change of a kind's vocabulary works the same way. A word dropped from it, or renamed,
  leaves stored values the kind has no word for, and the source's next run replaces them past the
  gate.
- Only the two sources of the Public Art pass declare a vocabulary on their records today
  (`landmarkSyncService.ts`). Every other source's type changes are held as before.

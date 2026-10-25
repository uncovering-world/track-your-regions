# ADR-0139: A field no reader sees, and a typographic rewrite, pass the gate

**Date:** 2026-10-23
**Status:** Accepted — decision 2 narrowed by [ADR-0147](0147-the-world-heritage-lists-typesetting-defects-are-mended-on-reading.md)
**Issue:** [#1834](https://github.com/uncovering-world/track-your-regions/issues/1834)
**Narrows:** [ADR-0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) decision 1

---

## Context

A gated source may not overwrite what a reader can already see (ADR-0025). Every rewrite of a field
of a visible place waits for a curator, except the classes ADR-0099, ADR-0129, ADR-0133 and ADR-0135
let pass. On the development catalogue on 2026-10-23 the review queue still asked two kinds of
question whose answer changed nothing a visitor sees or notices.

**A field no reader is shown.** 63 of 532 open held cards held nothing else:
- the place's local names (`nameLocal.<lang>`, 44 fields): no component draws them;
- its area (`metadata.areaHectares`, 9 moved by more than ADR-0099's tenth);
- a monument's year and makers (`metadata.year`, 26; `metadata.creators`, 2).

Macquarie Island's only open question was its name in Arabic, Cologne Cathedral's its area. Many
stored local names are another site's: Mount Pelée's Arabic name is Ha Long Bay's. The held proposals
are the corrections, and nobody sees either version.

The card already said so. `UNSEEN_BY_READERS` in `fieldMeaning.tsx` marked these facts "readers do
not see this", but the gate did not read it. Before this ADR a place's countries were the one field
both of them treated as unseen (#1579), each through a list of its own.

**A rewrite of typesetting alone.** 6 held cards held nothing but such a rewrite:
- Gondwana Rainforests of Australia's description, `Australia’s` → `Australia's`;
- the descriptions of the Jesuit Missions of the Chiquitos and the Historic Centre of Salzburg;
- component names that the World Heritage list once wrote with a literal `\t` at the end, such as
  *Gwangneung Cluster\t* at the Royal Tombs of the Joseon Dynasty. The stored names carry the
  backslash and the `t` as text, and readers see them.

Not every small text change is typographic. Old Village of Hollókő's held description turns
*Hollokö* into *Hollok ö*: a space inside a word is a corruption.

## Decision

**1. Every field of a place a run writes carries one mark: shown to readers, or `unseen`.**
- It is declared once, in `@tyr/shared/readerFields` (ADR-0065). The declaration names the reader
  surfaces it was measured against.
- The gate and the card's "readers do not see this" both read it, so a field returns to curation by a
  change of its mark, together with the backfill decision 3 asks for. `UNSEEN_BY_READERS` and the countries' list are replaced by it.
- A field a run writes with no mark fails a test.
- On 2026-10-23 these are `unseen`: the local names, the tags, the countries, and the metadata keys
  `criteria`, `region`, `transboundary`, `areaHectares`, `wikidataQid`, `year` and `creators`.
  The keys a run computes about its own pass are `unseen` too.

**2. Two classes pass the gate.**
- **`unseen`**: every rewrite of an `unseen` field. The Wikidata item is the exception, because
  ADR-0129 decision 2 stands: a different item means the row may describe another object. A
  metadata key the incoming record lacks is no rewrite the held row can take, and stays a question.
- **`typography`**: a place's name, subtitle or description, or a point's name, whose two values are
  the same text once these are applied (`foldTypography`, `@tyr/shared/labels`):
  - canonical composition (NFC);
  - quote, apostrophe and dash shapes folded;
  - a trailing literal `\t` or `\n` escape dropped;
  - runs of whitespace collapsed to one space, and the ends trimmed.

  Case and accents stay, and a space added or removed between two characters is not typography.
  The escape counts one way only: a rewrite that adds it is asked.

As with the other passing classes:
- on a held row the rewrite is written, filed with the written fields and marked with its class
  (`passedTheGate`);
- it raises no question, sets no held pointer and demotes no verified membership;
- a curator's claim still keeps the field (ADR-0029).

The location writer decides a point's name in SQL, with the rule spelled for Postgres
(`typographyFoldSql`) and pinned to the TypeScript one by a test.

**3. A value passed as `unseen` stays findable.** Its record entry carries `passedTheGate: unseen`
with the old and new values. This is the price of the class. The change that marks a field shown
owes, built from those entries, one held question per place for the values written while it was
unseen; it is built with that change, since none is marked shown here. So the first review covers what accumulated, not only the next rewrite, and nothing reaches
a reader unreviewed. Before `metadata.year` is marked shown, what it means has to be settled.
Monuments & memorials read it as the item's inception, which for the Genbaku Dome is 1915, the
year the building was built.

**4. Migration 154 closes the cards the earlier runs held only for these classes.** It writes what
they hold, as a run now would, and files each field as passed. A card is closed only when all of
these hold:
- the place still holds what the card proposed to replace;
- no curator claims or has answered any of its fields;
- every field it holds passes.

It also renames a component's part place that carries the old name of its point.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep asking, and close the cards by hand | 47 cards on dev whose answer changes nothing a visitor sees, and the next runs file more. |
| Pass the four fields #1834 names and keep the card's list beside the gate | Two declarations of one fact drift. The card's list already disagreed with the countries' list. |
| Pass an `unseen` field without recording its class | Once a surface shows the field, nobody could find the values written unreviewed. |
| Fold case or accents as typography | A case change of a name is visible, and an accent can be a different word: *Kapikaya* and *Kapıkaya*. |
| Treat every text within a small edit distance as typography | *Hollok ö* is one character from *Hollokö*, and it is a corruption. |

## Consequences

**Positive:**
- On dev, 47 open held cards are closed, and the queue loses its rewrites of local names, areas,
  years and makers. 21 more held only a removal of a year or makers, which a Wikidata kind that never
  writes them proposes about another kind's value. They stay questions (#1879).
- Whether a field is shown to readers is one declaration, which the gate and the card both read.

**Negative / Trade-offs:**
- A wrong local name or area is written unreviewed while no surface draws it. The values stay
  findable for the review the first surface brings.
- A curator's refusal of an `unseen` value does not stop the next run from writing it. Only a claim
  keeps a field.

## References

- Related ADRs: ADR-0099 (decision 1 narrowed), ADR-0025 (the gate), ADR-0029 (claims), ADR-0065
  (shared rules), ADR-0129 (the Wikidata item), ADR-0133, ADR-0135 (the other passing classes)
- Related docs: `docs/tech/experiences.md` § Review Queue (the gate's passing classes)
- Code: `packages/shared/src/readerFields.ts`, `packages/shared/src/labels.ts` (`foldTypography`),
  `backend/src/services/sync/changeSet.ts` (`passesAsUnseen`, `passingColumns`),
  `backend/src/services/sync/locationWriter.ts`, `db/migrations/154-a-field-no-reader-sees-and-typography-pass-the-gate.sql`
- Issues: #1834, #734 (the local names), #1579 (the countries)

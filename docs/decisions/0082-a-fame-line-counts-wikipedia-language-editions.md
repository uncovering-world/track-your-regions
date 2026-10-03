# ADR-0082: A fame line counts Wikipedia language editions

**Date:** 2026-10-03
**Status:** Accepted

---

## Context

Every kind the catalogue fills from Wikidata decides what to admit by a fame line: the works
pool's floor (10), the iconic mark (22 to enter, 18 to keep), each kind's place line (22 and 18
by default, set per source in the admin panel), the public-art pool's floor (15). ADR-0023 stated
the first of them as "22 Wikipedia-language sitelinks", the admin panel's line controls say "the
Wikipedia-language count", and the review card calls the stored number "language editions".

The runs read `wikibase:sitelinks`, which counts every Wikimedia site linking the item: a
Commons category, a Wikivoyage, Wikiquote or Wikisource page as well as the Wikipedias. On the
catalogue's 3,996 items with a Wikidata id (2026-10-03, #1234), 3,454 carry a Commons link, 828 a
Wikivoyage page and 533 a Wikiquote page, and the stored count stood above the Wikipedia count
by one for most rows of every kind. *Saint Elizabeth of Portugal* by Zurbarán entered the works
pool at its floor of ten on eight Wikipedias, a Commons category and an Indonesian Wikiquote page.

The lines are about to be told to visitors as rules: "written about in at least 22 languages".
A rule told that way has to be the rule the run applies.

## Decision

**Every fame line reads the number of Wikipedia language editions holding an article about the
item, and the lines keep the numbers they have.**

The collecting questions keep reading `wikibase:sitelinks`: it is stored and range-indexed, which
is what makes the fame bands answerable within the query service's limits, and it is never smaller
than the Wikipedia count, so a band or a floor on it gathers a superset. Every fetcher then
recounts what it gathered (`inWikipediaEditions`, `wikidataQueries.ts`, a `COUNT` over
`schema:about` articles whose site's `wikibase:wikiGroup` is `"wikipedia"`) and holds it to the
floor it was asked for, before any line is compared and before anything is stored. One count, for
the works, the places and the venues a fold or a door reads.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep `wikibase:sitelinks` and say in the docs and the panel what it counts | The rule a visitor is told would be "linked from N Wikimedia sites", which describes Wikidata's bookkeeping rather than how widely a place is written about. |
| Count Wikipedia editions and lower every line by one | Keeps what each kind admits almost unchanged, but the lines were never chosen as "N editions plus one"; lowering them restates the old count under a new name. |
| Count Wikipedia editions inside the collecting questions | A join per item in the banded scans is the shape that timed out before the bands were cut (ADR-0023's measurements); the stored count is what keeps the bands affordable. |
| Count Wikivoyage as well, as a travel signal | Worth weighing, and a separate decision: a Wikivoyage page says a traveller wrote about the place, not that it is widely known, and it would make the rule harder to tell. |

## Consequences

**Positive:**
- The rule a visitor is told and the rule a run applies are the same sentence.
- The stored count (`treasures.sitelinks_count`, `metadata.sitelinksCount`) is what the review
  card already calls it, language editions.
- ADR-0023's "22 Wikipedia-language sitelinks" is what the code does.

**Negative / Trade-offs:**
- A real tightening at every line. Measured on 2026-10-03 (#1234): 178 of the 1,580 works stand
  in the pool at its floor of 10 only on the difference; at the place line of 22, 116 places of
  worship and 88 archaeology places; 35 iconic works at 22. The next run of each kind takes
  them out or proposes taking them out, through the gate a kind has.
- One more question per collection: a recount of 400 items at a time, a second or less each.

## References

- Related ADRs: ADR-0023 (works-first museum selection, the 22-sitelink line), ADR-0048 (the two
  tiers of a kind), ADR-0052, ADR-0058 (the place lines of worship and archaeology)
- Related docs: `docs/tech/experiences.md` § What a fame line counts
- Issue: #1234

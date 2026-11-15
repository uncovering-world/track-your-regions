# ADR-0214: A place carries its lifetime, and only the place's own end hides it

**Date:** 2026-11-15
**Status:** Draft
**Issue:** [#1719](https://github.com/uncovering-world/track-your-regions/issues/1719), Epic #2115
**Narrows (once accepted):** [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) decision 2
(the `existence` axis), [ADR-0153](0153-a-field-belongs-to-the-place-or-to-one-kind.md) decision 1
(for `metadata.year` alone)

---

## Context

A place on the map has a lifetime, and the catalogue holds none of it. Its one statement about
whether a place stands is `experiences.existence`, which only a curator writes: on the
development catalogue on 2026-11-15 all 24,992 places read `extant`. A place Wikidata says is
gone is refused from its kind instead (#2259, #2280), and the date survives only in the
refusal's wording ("destroyed in 1966"). The maintainer decided on 2026-10-25 that a place that
ended stays in the catalogue with its dates, that today's catalogue offers only what stands
today, and that a gone place is seen in the catalogue of a past date (#2008) and under a virtual
kind of gone places (#2009).

What Wikidata holds for the 4,019 offered places, all of them with an item in the subset
(measured 2026-11-15):

- **A start** (`P571` inception, `P1619` official opening, `P580` start time) on 2,270. 194 of the
  inceptions are BC, 346 are known to the century, 12 to the millennium, and 44 are circa.
  Göbekli Tepe's is −9999 to the millennium, circa; 17 places begin before 4713 BC, where a
  Postgres `date` stops.
- **An end** (`P576` dissolved or demolished, `P3999` official closure, `P582` end time) on 200,
  and almost none of them is the end of what a traveller visits:
  - most end a use: abbeys dissolved around 1539 (Glastonbury, Fountains, Bath), settlements
    abandoned or sacked (Göbekli Tepe about 7000 BC, Carthage 146 BC, Herculaneum AD 79), a
    capital moved (the Registan, Nagaoka-kyō);
  - some end an earlier building that was rebuilt, 12 of them with the rebuild stated: the
    Cathedral of Christ the Saviour in Moscow (opened 1883, blown up 1931, inception 2000),
    Ponte Santa Trinita, Coventry Cathedral;
  - a few are the end of the place and no rule reads them: Babri Masjid (1992), the Great Mosque
    of Gaza (2023).
- **One value for two owners.** The inception year Public art, Monuments & memorials, Towers,
  Bridges & engineering marvels and Squares & streets keep as a kind fact (`facts.year`, ADR-0153)
  equals the item's earliest inception on 600 of the 613 places that have one.

The Wikidata subset gives years as Wikidata's JSON numbers them: 250 BC is −250, with no year
zero, and a work's year (`treasures.year`) and the kind facts' year hold that numbering where
they were read from the subset. The query service numbers a BC year at a year's precision or
finer astronomically, one higher (−249), and the live readers of a work's and a public work's
inception still store its `YEAR()` unshifted. Wikidata's JSON also keeps a date to the day in the
calendar its source used: Julian for most dates before 1582, and Russia's before 1918. `@tyr/shared/approximateDates` (ADR-0202
decision 2) says a place's lifetime reads dates the way a trip's date does.

## Decision

**1. A place holds four dates, each by what it says.**

| slot | what it says |
|---|---|
| `began` | the place first stood or was founded |
| `rebuilt` | what stands now was built again after an end |
| `use_ended` | what it housed or was used for ended |
| `ended` | the place itself stopped standing |

Each is a row of `place_dates`, keyed by the place, and each source's view of them is a row of
`record_dates`, keyed by its record (ADR-0084), so a disagreement between two sources is asked
like a picture's. Both are written by `db/placeDatesWriter.ts` alone, under the place's lock
(ADR-0069). The slots and their words are `@tyr/shared/lifetime`, held to the schema's CHECK
lists by a type.

**2. A date is a trip's approximate date with a span and "circa".** A year, with a month and a day
where known (a month only within a year, a day only within a month the month has); a span of a
decade, a century or a millennium where the source knows the year no closer, with no month then;
and whether it is circa. The year is numbered as the subset gives it: 250 BC is −250, and there
is no year zero. A reader of the query service shifts a BC year it reads at a year's precision or
finer back by one before writing it. A day is a day of the proleptic Gregorian calendar, the one
`isValidPlaceDate` counts in: a reader turns a Julian date to the day into the Gregorian one
(`julianToGregorian`) before writing it, as the query service does, and writes nothing of a day
the Julian calendar does not have, for which the conversion answers null. Only `ended` may hold no
year: a curator can know a place is gone without knowing when. Each date names the source it was
taken from (Curators for a curator's), and the Wikidata property and statement it was read from.

**3. Only the place's own end hides it from today's catalogue.** `ended` is written by the rules
that read a place as gone (#2259, #2280) or by a curator, never from a bare end statement, which
is kept as `use_ended` or as the end before a rebuild. `ended` replaces `existence`.

**4. A date filled where the place held none passes the gate** (the maintainer, 2026-11-15), as a
Wikidata item, a subtitle and a picture's credit do (ADR-0129, ADR-0133, ADR-0151). A change to
a date the place holds is asked under a gated source, and so is every `ended`, since it takes the
place off today's lists.

**5. The inception year is the place's `began`,** not a kind fact: one value on the place, each
source's view on its record. The kind facts keep their own decision (#2127).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A Postgres `date` per end | It stops at 4713 BC: Göbekli Tepe, Tell es-Sultan, Byblos and 14 more offered places begin earlier, and a `date` has no way to say "to the century". |
| Columns on `experiences` (`began_year`, `began_month`, …) and `reported_*` columns on the record | Four dates of seven fields each are 28 columns on the place and 20 on the record, each date spelled again in every select, comparison and write. One row per date keeps one shape and one set of checks. With two dates the columns would have been as good. |
| The astronomical year (250 BC = −249) | It suits arithmetic, which nothing does with these years; ordering, which a comparison with a trip needs (#2008), is the same in both. A second numbering beside the subset's, and the years read from it into `treasures.year` and `facts.year`, would have to be converted at every meeting. |
| Every end statement as the place's end | It would take Göbekli Tepe, Bath Abbey, Hagia Sophia, the Registan and the Cathedral of Christ the Saviour off today's lists. |
| A free list of dated events per place | Nothing would say which event hides the place, and a card would have to guess which events to show. |

## Consequences

**Positive:**

- A place that ended keeps its dates, and the catalogue of a past date (#2008) and the gone kind
  (#2009) read them.
- A gone refusal no longer loses its date into a sentence.
- One numbering with every year the catalogue reads from the subset, so `yearLabel` prints a
  place's year as it prints a work's.

**Negative / Trade-offs:**

- "Stands today" becomes a read of another table, where `existence` was a column of the place.
- The years of a source's view are compared as dates, field by field, so two sources that state
  one year to different precisions disagree and a curator is asked.
- Wikidata's own words for a coarse date ("10th millennium BC") are not the catalogue's; the
  card writes "c. 10,000 BC".

## References

- Related ADRs: ADR-0020 (the lifecycle axes), ADR-0084 (each source's view), ADR-0069 (closed
  writer lists), ADR-0153 (a field's owner), ADR-0202 (an approximate date), ADR-0129, ADR-0133,
  ADR-0151 (a field a place holds none of passes the gate)
- Related docs: `docs/tech/experiences.md` § A place's lifetime
- Issues: #1719, #2008, #2009, #2127, #2128, #2259, #2280

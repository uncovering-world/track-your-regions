# ADR-0217: Time in the catalogue is held as periods, and the catalogue is read as of a date

**Date:** 2026-11-16
**Status:** Draft
**Issue:** [#2578](https://github.com/uncovering-world/track-your-regions/issues/2578), Epic #2115
**Narrows (once accepted):** [ADR-0214](0214-a-place-carries-its-lifetime-and-only-its-own-end-hides-it.md)
decisions 1 and 3, and the slot sentence of decision 2;
[ADR-0020](0020-experience-lifecycle-and-run-changeset.md) decision 2 (the `existence` axis);
[ADR-0021](0021-source-may-restore-membership.md) and
[ADR-0216](0216-a-withdrawn-part-stays-shown-until-a-curator-answers.md) decisions 2 and 3 (who
writes `source_membership`: a trigger derives it from the listing periods)

---

## Context

Time reached the catalogue one issue at a time: a place's lifetime (#1719, ADR-0214), closures
and seasons (#2128), an event's occurrences (#1676), a visit's date (ADR-0202). The pieces do not
form one model, and an independent review of the plan (2026-11-16) found what falls between them.

- **A lifetime cannot hold a gap.** ADR-0214 gives a place four dates, one per slot (`began`,
  `rebuilt`, `use_ended`, `ended`). The Cathedral of Christ the Saviour in Moscow stood from 1883
  to 5 December 1931 and stands again since 2000; its 1931 fits no slot, so a traveller marking a
  trip of 1980 would be offered a cathedral where a swimming pool was. Ponte Santa Trinita in
  Florence has two gaps (1557–1569 and 1944–1958).
- **A membership has no dates.** Liverpool was a World Heritage Site from 2004 to 2021, and
  *former* says only that it no longer is.
- **A season is a pair of month-days**, which cannot hold Holy Week in Seville.
- **"Gone" has four owners:** `experiences.existence`, the curator's *lost* verdict, the gone
  refusals of the admission rules, and the `ended` slot.

The maintainer decided on 2026-11-16 (#2578): a delisted World Heritage site is in the catalogue
like every other, with the dates of its listing; the catalogue is read as of a date, so that
past-travels mode shows places and memberships as they were on the trip's date; and what is no
longer there is a section at the end of each list, not a kind of its own. Earlier decisions stand:
a gone place stays in the catalogue with its dates (2026-10-25), a new place that has already
ended arrives with an arrival card, an end on a place readers see is asked of a curator, and a
date filled where the place held none passes the gate (2026-11-15, 2026-11-16).

Measured on the development catalogue and the Wikidata subset on 2026-11-16, read-only. *Offered*
is a place with an admitted, published record in a kind (4,019 places, 4,017 with an item in the
subset); *arriving* is a place with a pending record whose id is a Wikidata item (15,144).
Statements are the best-ranked ones unless said otherwise.

| | offered | arriving |
|---|---:|---:|
| a start (`P571` inception or `P1619` official opening) | 2,249 | 8,135 |
| an end (`P576` or `P3999`) | 184 | 551 |
| a start statement later than an end statement | 12 | 19 |
| a dated destruction or demolition event (`P793`) on an item with no end statement | 13 | 26 |
| a gap readable at all (a later start, or a rebuilding event after an end or a destruction) | 21 | 31 |
| two or more gaps readable | 1 | 1 |
| a past coordinate (`P625` with an end time) | 2 | 11 |

- Nine of the 21 gaps are stated only as dated significant events, with no end statement: the Old
  Bridge in Mostar (destroyed 9 November 1993, rebuilt 2001–2004) and the Kintai Bridge among
  them. A reader of inceptions and ends alone reads Mostar's bridge as "built 1566".
- No offered place carries an open period (`P3027`, `P3028`) or a *temporarily closed* state of
  use; the Pergamon Museum's item says nothing of its closure.
- No membership of a kind is *former* or missing; the only formers are 11 parts of serial sites.
  Every World Heritage record carries its inscription date as a kind fact.
- The subset holds 3,415 World Heritage designations (`P1435` = Q9259) on 3,407 items. Ten carry
  an end time, three of them at deprecated rank. Of the seven others, two are lines that exist
  today under the same list id (the Cave of Altamira, the Côa Valley), two were absorbed into a
  larger property and their id is no longer given (the Burgess Shale, the Château de Chambord),
  and three are the delisted sites: the Arabian Oryx Sanctuary (Q2015257, 1994–2007, id 654), the
  Dresden Elbe Valley (Q663836, 2004–2009, id 1156) and Liverpool – Maritime Mercantile City
  (Q2021552, 2004–21 July 2021, id 1150). None of the three is in the catalogue. On Liverpool and
  Dresden the ended designation is at normal rank beside a preferred *no value* statement, so a
  best-rank read sees no designation.
- `place_dates` and `record_dates` (ADR-0214, migration 255) hold no row, and no trip is stored.

## Decision

**1. Time is held as periods.** A period says that something was so from one date until another.
Each end is a date of ADR-0214 decision 2 (a year with a month and a day where known, a span,
circa, BC as the subset numbers it), or is not known. A period also says whether it has an end: an
open period holds with no end in sight, and an end may have no date ("gone, when is not known").
Beside its ends the period keeps the outer days it may cover, the first day its start may be and
the last day its end may be, written by the one writer from the shared rule of dates (`periodOf`,
`@tyr/shared/lifetime`); every read compares those. One shape and one CHECK serve every table
below.

**2. A place holds its periods** (`place_periods`, which replaces `place_dates`), each saying one
of four things:

| says | example |
|---|---|
| `stood` | Christ the Saviour: 1883 → 5 Dec 1931, destroyed; 2000 → open. Nelson's Pillar in Dublin: 1809 → 8 Mar 1966, destroyed, and no open period. |
| `used` | Hagia Sophia: a church 537 → 1453, a mosque 1453 → 1931, a museum 1935 → 2020, a mosque 2020 → open. Göbekli Tepe: about 10,000 BC → about 7000 BC. |
| `closed` | The Pergamon Museum: October 2023 → 2027. |
| `held` | Holy Week in Seville: 21 → 28 March 2027. |

A place's standing periods do not overlap, and none ends in the future; a closure may. A use's
name is a curator's words, and runs propose none: Wikidata dates an item's classes on 49 to 129
offered places, and Hagia Sophia's are two "current" values at once. A run still reports the end
of a use, unnamed and with a start that is not known, as ADR-0214 had it. A closed place stays in its lists with its mark. The words
a card prints (built, destroyed, rebuilt, in use until) are read from the periods and stored
nowhere.

**3. Each source's view of a place's periods is on its record** (`record_periods`, which replaces
`record_dates`), written whole by its run. The gate of ADR-0214 decision 4 stands, said for a list,
but for the end of a place no reader sees yet, which it asked and this writes:

- a view that leaves every date the place holds as it is, and leaves the place standing or not as
  it was, is a fill and passes: it has no period fewer, and each start the place holds is still a
  start and each end still an end, told the same way. Christ the Saviour held as "1883 → open" and
  reported as "1883 → 1931, 2000 → open" is one;
- any other difference is asked under a gated source on a place readers see, as one question
  showing the place's periods beside the source's. The run files the list as a held field of its
  change set, named by what the list says, and the review queue's held card asks it as it asks a
  held name. Taking the proposed list writes it whole as its source's list, with no curator's claim
  on it; keeping the current one is remembered by value, so the same list is not asked again;
- the end of a place's last standing period is never a fill: under a gated source it is always
  asked on a place readers see, and is written with the arrival on a new place, whose arrival card
  is the question (Nelson's Pillar). ADR-0214 decision 4 asked every end under a gated source, a
  new place's included; the maintainer's decision of 2026-11-16 on #1719 narrows it there.

A run reads every gap an item states, from dated destruction and rebuilding events as well as
from inceptions and ends: Ponte Santa Trinita's two, and the Old Bridge's in Mostar, which its item
states only as a destruction on 9 November 1993 and a reconstruction that ended on 23 July 2004. An
event is read for what it says of the whole place and of what was left of it, and for nothing else:

- a rebuilding or a reopening opens a period only after an end, since the same event is stated of
  work on a building that never fell (Berlin Cathedral's reconstruction of 1975 to 1993), and it is
  never the place's beginning;
- an event with no date is no boundary, and neither is one that names a part of the place (Hirano
  Shrine's worship hall, destroyed in 2018);
- an event that says what happened to a place and not what was left of it, a fire or a
  bombardment, is not an end: Kinkaku-ji, burnt down in 1950 and rebuilt in 1955, reads as
  standing throughout until a curator says otherwise;
- a destruction that no start follows does not end the place, which is the gone rules' to read
  (#2585), and ends no use.

A gap longer than a century is never a fill: it is asked on a place readers see under a gated
source, and written with the arrival on a new one, as the end of the last standing period is. An
item cannot say what stood in so long a gap. What the list says beside such a gap does not wait for
the answer: the same list with the gap closed is written where it only fills, so the Odeon holds
"161 → open" while its gap is asked and after a curator refuses it. The Odeon of Herodes Atticus in Athens states a
destruction in 267 and a reconstruction that ended in 1953, and its ruin was visited for all of
that time: a traveller of 1900 was at the Odeon. Measured on the 40 gaps the reader derives on the
subset (17 offered places, 20 arriving): four are longer than a century (1,686, 249, 171 and 166
years). One of the four is a place truly gone, Bethlehem Chapel in Prague (1786 to 1952); one is
Andreevsky Monastery in Moscow, dissolved in 1764 and founded again in 2013; the fourth, the
Tarikhaneh in Damghan (856 to 1027), was not looked into. The next longest are 86 years. Nothing else in the items separates the Odeon from
the Old Bridge: it carries no state of conservation, both are designated heritage, both gaps are a
*destruction* and an *architectural reconstruction*, and Ponte Pietra in Verona, offered in
Archaeology as the Odeon is, was truly blown up in 1945 and rebuilt by 1959.

**4. A membership holds its listing periods** (`record_listings`), in every kind. A record with
none is listed at every date: a bridge is a bridge whenever it stood. A list kept by a body
outside the catalogue dates its listings: Liverpool's World Heritage record holds 2004 →
21 July 2021, delisted. A membership is *former* when it has listing periods and none is open.
`source_membership` remains the column readers read and is derived from the periods by a trigger:
a curator's *former* closes the open period, with a year where known, and a run that lists the
place again opens a new one. A curator's *former* on a record with no listing period writes one ended period
whose start is not known. A part's record in its whole holds listing periods the same way, so a component a site
dropped (ADR-0216) is *former* by its periods and not by a column written beside them.

**5. A place is gone when it has standing periods and none is open.** That is the one statement.
`experiences.existence` goes; a curator's *lost* closes the place's standing, and on a place with
no standing period it writes one ended period whose start is not known; a rule that reads a
place as gone reports that end on its record's view and the gate decides (#2584 converts the
remaining refusals). `experiences.stands_today` is derived from the periods by a trigger and
written by nothing else, as the place's `missing_since` is derived from its records (ADR-0084).

**6. The catalogue is read as of a date.** One predicate says whether a place is offered in a
kind: it stands and is listed there, on a date, with today as the default
(`db/readerPredicates.ts`).

- Today, it is the two derived columns, on rows the read already holds.
- On a past date, it asks the place's standing periods and the record's listing periods by their
  outer days. A date that does not settle the question offers the place.

For a trip of 2015, Liverpool is a World Heritage Site and the Arch of Reunification in Pyongyang
stands; for a trip of 1980 the Cathedral of Christ the Saviour is not offered. Admission and
publication are not dated: the catalogue's own curation is not history.

**7. What is no longer there is a section of each list, not a kind.** After a kind's list comes
what was offered in it before the date the catalogue is read at and is not offered on it: places
that no longer stand, and places that left a list kept outside the catalogue (World Heritage; the
kinds `KINDS_KEPT_AS_FORMER` names). Each is marked from the period that ended ("destroyed in
1966", "delisted in 2021"), and ticking one opens the past-trip flow. A former membership of a
kind the catalogue fills by its own rule is in no section: the bridge still stands, and only the
catalogue's rule changed. #2009's virtual kind is not built.

**8. A visit counts under a kind when one of its trips' dates falls inside a standing period of
the place and a listing period of its membership there.** A visit with no dated trip counts by
today's state. Liverpool with a trip of 2015 is a World Heritage visit; with a trip of 2023, or no
date, it is a visit to a former site.

**9. What repeats every year is a season** (`place_seasons`): a window from one month, with a day
where known, to another, which may wrap over the new year, saying *open* (Sceilg Mhichíl, mid-May
to September) or *held* (the Gion Matsuri, 1 to 31 July). A window that shifts is marked so and
read as "usually" (a mountain pass, June to October). A movable event holds its rule in words
(Holy Week in Seville: March or April) and, where a source or a curator gives them, a year's dates
as a `held` period; nobody is obliged to enter them. A biennale is its dated editions.

**10. A delisted World Heritage site is taken in from Wikidata.** The World Heritage run reads
every World Heritage designation that is not deprecated and carries an end time, on an item whose
list id (`P757`) the dataset no longer gives. Each arrives as a World Heritage record under that
id, held for a curator, with its listing period from the statement's start and end times and its
picture found by the id as any site's is (ADR-0043). A curator publishes the delisted sites and
refuses a site listed today inside a larger property. A site delisted from now on is already in
the catalogue: its record goes missing, and the curator's *former* closes its listing.

**11. A place's past positions are a table of this shape, built with the past-trip map**
(`place_past_positions`: a point, from, until). The Arch of Neutrality in Ashgabat stood at
37.9369, 58.3800 from 1998 to 2010 and stands about 7 km away since; it has one standing period,
since it was moved and not lost.

**12. Of ADR-0214,** decision 2 (the date; its sentence "Only `ended` may hold no year" gives way
to decision 1 here, where either end of a period may be not known), decision 4 (the gate, as decision 3 here says it for
a list) and decision 5 (the inception year is the place's, not a kind fact) stand. Decision 1
(four slots) is replaced by decision 2 here, and decision 3 (the `ended` slot hides the place) by
decision 5: only the end of the place's standing hides it, and the end of a use never does.

**Amended as a Draft, from what its first slice built (#2578):** decision 1 says that a period has an
end, not that it has ended, since a closure's end may lie ahead, and names the two outer days a
period keeps, one per end; decision 2 says that a run's use has no known start; decision 3 says
what "leaves every date as it is" compares, and that the end of the last standing period is asked
under a gated source on a place readers see and written with the arrival on a new place, which
narrows ADR-0214 decision 4, where every end was asked. Accepted with decisions 1, 2, 3 and the
derived column of decision 5 built; `existence` (decision 5), the listing periods (decision 4),
the read as of a date (decisions 6 to 8), seasons, the intake of delisted sites and past positions
(decisions 9 to 11) are built by later slices of #2578.

**Amended as a Draft, from what its second slice built (#2578):** decision 3 says that every gap is
read, which events a run reads and what they may not say, and that a gap longer than a century is
asked; three trade-offs of that reading are named. Read so on the subset of the Context's measurement, 17 offered places and 20 arriving ones
have a gap (6 and 10 from inceptions and ends alone, as the first slice read them), where the
Context's count by a simpler rule was 21 and 31: that rule counted every start later than an end,
Bath Abbey's among them, whose end of 1539 is its monastery's, before the church was built.

**Amended as a Draft, from what its third slice built (#2578):** decision 3 says how a held list is
asked and answered, on the review queue's held card, and that what a list says beside a gap longer
than a century is written without waiting. The second slice's trade-off had the place hold no
standing period until a curator answered; the maintainer's principle of 2026-11-16, that a curator
answers a source's proposal and enters no date, would then leave the Odeon with no beginning after
a curator refuses its gap. Two trade-offs are named: a refusal is remembered with the statements
its dates were read from, and the card's sentence about today's lists runs ahead of the reads.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the four slots and add a table of standing periods | It stores the gap and keeps every line of #1719. The slots then repeat the first start, the last start and the last end of the periods, so "gone" has two owners for good, a curator's correction is made twice, and every other kind of time is still designed apart. |
| Typed, dated events (built, destroyed, rebuilt, closed, reopened, moved), with the standing periods derived | It matches how Wikidata states 9 of the 21 gaps. No reader asks about an event: each asks whether something was so on a date. The pairing of events into periods would move from the run's reader, tested on named items, into a trigger that must also digest a curator's half-entered history, and an end with no date has no place in an order of events. ADR-0214 rejected the untyped form for the same reason. |
| One validity table for places, memberships, positions and closures alike | No foreign key or cascade to the subject, and rows of four writers and four gates in one closed writer list (ADR-0069). A position still needs its point and a season is not an interval, so side tables remain. What is worth sharing is the date and its comparison, which decision 1 shares. |
| A composite Postgres type for a date | The driver returns a composite as text, so the generated row types and every response schema would need a parser. Columns under one CHECK function are what the tables already hold. |
| The stands-today test as a probe of the periods on every read | An index probe on the hot reads for a fact that changes a few times a year. 99.5 % of offered places have one standing period or none (21 of 4,017 have a gap). |
| Listing dates as columns of the record, or as a World Heritage kind fact | Columns cannot hold a second listing, and a fact of one kind cannot be asked "as of a date" by a reader of every kind. |
| A virtual kind of gone places (#2009 as filed) | The maintainer decided against it on 2026-11-16: a traveller looks for what is gone where it was, at the end of its own list. |
| Take in every ended World Heritage designation without a curator | Four of the seven non-deprecated ones are not delistings (above). |
| Read delisted sites from the designation's best rank | Liverpool's and Dresden's is outranked by a preferred *no value*. |

## Consequences

**Positive:**

- The seven places #2578 names are each held: Christ the Saviour's and Ponte Santa Trinita's gaps,
  Nelson's Pillar's end, Liverpool's listing, the Arch of Neutrality's move (when its table is
  built), Holy Week's dates, and the Pergamon Museum's closure.
- One statement says a place is gone and one says a membership is over; each has a derived column
  the hot reads use with no join.
- #2008 and the "no longer there" section read one predicate, and so do the counts.
- #2128 needs no closures table of its own, and #1676's events get their dates without a design
  of their own.
- The tables it replaces are empty, so nothing is migrated.

**Negative / Trade-offs:**

- #1719's merged tables, its slot vocabulary and the part of its reader that picks one date per
  slot are rebuilt; its date, calendar and statement reading, its writer and its gate rule are
  kept. Its two unmerged slices are re-cut.
- `source_membership` changes from a column its writers set to one a trigger derives, which
  touches every writer of *former* and *present* (ADR-0021, ADR-0216).
- A place's periods are asked and claimed as a whole per thing they say, so a curator who
  corrects a start also holds the end against the run, and a later difference surfaces as a
  conflict.
- A place gone at an unknown date is offered in the list of every past date.
- A site once listed in its own right and listed today inside a larger property (the Château de
  Chambord, 1981–2000) keeps no listing of its own unless a curator gives it one.
- An event that is not a place waits for #1676 to say which row its periods hang on.
- A gap longer than a century is asked and not filled, so the place holds the list with that gap
  closed until a curator answers: Bethlehem Chapel in Prague, truly gone from 1786 to 1952, reads
  "1391 → open" until then, and is asked as the Odeon is. A trusted source writes such a gap
  unasked, as it writes any difference.
- A refusal is remembered for the list as filed, the statement each date was read from included,
  so a statement entered anew on Wikidata with the same date asks again.
- The card for an end says that the place leaves today's lists. Until the read as of a date is
  built (decisions 5 to 7) no reader reads the derived column, and a published end changes no
  list.
- A gap of a century or less is filled as the item states it, right or not: the Liberty Bridge in
  Budapest reads as gone from 1945 to 2009, since its item prefers an inception of 2009 to the
  one of 20 August 1946 it also states.
- A destruction its item states as a fire or a bombardment is not read, so Kinkaku-ji is offered
  for a trip of 1952, when the pavilion was ash.

## References

- Related ADRs: ADR-0214 (the date, the gate), ADR-0202 (a trip's date), ADR-0020, ADR-0021,
  ADR-0216 (the lifecycle axes and who writes them), ADR-0084 (each source's view, derived
  listing), ADR-0069 (closed writer lists), ADR-0043 (a site's picture by its list id), ADR-0198
  (a record in a kind or in a whole)
- Related docs: `docs/tech/experiences.md` § A place's lifetime
- Issues: #2578, #1719, #2128, #2008, #2009, #2584, #2585, #1676, #2134, #2127

# ADR-0217: Time in the catalogue is held as periods, and the catalogue is read as of a date

**Date:** 2026-11-16
**Status:** Accepted — decision 7 narrowed by [ADR-0224](0224-the-open-rules-of-adr-0217-to-adr-0219-are-the-maintainers-and-a-tick-paints-only-the-ground-the-traveller-was-on.md): a date offered on a tick of a place that no longer stands is held to its standing, and a trip dated after its end is refused and the traveller asked to correct it
**Issue:** [#2578](https://github.com/uncovering-world/track-your-regions/issues/2578), Epic #2115
**Built by:** #2578, #1719, #2128, #2008, #2009, #2584, #1676, #2622, #2633
**Narrows:** [ADR-0214](0214-a-place-carries-its-lifetime-and-only-its-own-end-hides-it.md)
decisions 1 and 3, and the slot sentence of decision 2;
[ADR-0020](0020-experience-lifecycle-and-run-changeset.md) decision 2 (the `existence` axis);
[ADR-0021](0021-source-may-restore-membership.md) and
[ADR-0216](0216-a-withdrawn-part-stays-shown-until-a-curator-answers.md) decisions 2 and 3 (who
writes `source_membership`: a trigger derives it from the listing periods);
ADR-0214 decision 4 (an end on a new place is written with its arrival, decision 3);
[ADR-0213](0213-a-parts-gate-is-its-record-in-its-whole.md) decisions 1 and 3 (a part's
`existence` goes, and the *former* and *lost* its site's card asks are written as periods,
decisions 4 and 5)

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

Four more rulings of the maintainer followed on #2578, and this Draft is amended to them (the
note under the Decision that names those two dates says where):

- **A museum that closed for good** ends its record's standing. Frick Madison in New York was a
  museum from 2021 to 2024, and its building stands (2026-11-16). A ruling of 2026-11-17 (below)
  says that the standing which ends is that of the place's membership in Art Museums.
- **What a visit counts as.** Four dates are told apart and never merged: a place entered a list,
  left a list, was built, was destroyed. A traveller at Machu Picchu in 1980 visited a World
  Heritage Site, though it was inscribed in 1983 (2026-11-16). Two sentences of that ruling were
  replaced the next day (below): that a visit made while a place was listed keeps counting after
  the place leaves the list, and that a tick made today on a place no longer listed asks when.
- **A temporarily closed place** stays in its list and is no category of its own: the Pergamon
  Museum, "closed until 2027" (2026-11-16).
- **Nothing is put into the model that a curator would have to enter from nothing.** Every fact a
  curator sets has a source that proposes candidates, which the curator confirms, corrects or
  refuses. Named uses stay in the model, proposed from Wikidata (2026-11-16 and 2026-11-17).

Three rulings of the maintainer of 2026-11-17 followed those (#2578, comments of 10:20Z, 10:24Z
and 10:30Z), and the Draft is amended to them as well (the note under the Decision that names those
comments). The
third completes the first two and is the one their wording is read by:

- **A screen of a past date shows a place that already existed then,** whatever the date its
  listing began. A traveller marking Peru in 1980 finds Machu Picchu, inscribed in 1983, and
  ticks it. The one bound is the place's own beginning (10:20Z).
- **A count follows the list of the date shown, never the date of the visit.** When a visit
  happened changes no count as long as the place still stands. What changed when Liverpool left
  the list in 2021 is the list: a traveller reads "10 of 21" where it was "10 of 22". No
  question "when were you there?" is asked for a place that left a list (10:24Z).
- **A list read as of a date is the list as it stood on that date, with two sections beside
  it.** *No longer listed* holds what had left the list by that date (Liverpool, read today),
  and *not yet listed* holds what existed on that date and entered the list later (Machu Picchu,
  read as of 1980). A place in either can be ticked from there. The start and the end of a
  listing are treated alike: neither hides the place from the screen, and both move it out of
  the counted list into a section that says why (10:30Z).

Three more rulings of the maintainer of 2026-11-17 followed, each put to the maintainer from the
audit of ADRs against issues (#2619), and the Draft is amended to them (the last note under the
Decision):

- **A closing belongs to the place's membership in a kind, not to the place**
  ([#2578](https://github.com/uncovering-world/track-your-regions/issues/2578#issuecomment-6949064473)). It ends, or
  pauses, the membership in that one kind, and the place stands in every other kind that offers
  it: the Museum of San Marco in Florence is offered in Art Museums and in Places of worship.
  Standing is kept per membership.
- **A work's link to its museum takes periods**, as a membership does
  ([#2578](https://github.com/uncovering-world/track-your-regions/issues/2578#issuecomment-6949225433)): Vermeer's
  *The Concert* hung in the Isabella Stewart Gardner Museum in Boston until the theft of 1990.
- **A place under construction is offered once it is there to visit as what it is offered as**
  ([#2584](https://github.com/uncovering-world/track-your-regions/issues/2584#issuecomment-6949327510)): the
  Sagrada Família is offered, and the Jeddah Tower is not until it opens.

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

A second read of the same day asked what could propose each fact a curator sets, on the same
catalogue and subset, on the OpenStreetMap layer (`workbench.osm_objects`, joined by its
`wikidata` tag) and on the English Wikivoyage pages the workbench holds. It counts every statement
that is not deprecated, so a figure may differ from the table's by a few. "Read by hand" is a
reviewer's reading of the named places against what each is known for, with no outside page
fetched.

- **Named uses.** 151 offered places carry a class or a use (`P31`, `P366`) with a start or an end
  time, 30 of them two or more. Of five read by hand four read well: Hagia Sophia (a mosque 1453 to
  1931, a museum 1935 to 2020, a mosque from 2020; its church period is deprecated there, and a
  fourth statement, a museum from 2024, is its upper gallery), Saint Sophia Cathedral in Nicosia
  (a cathedral 1209 to 1570, a mosque since), Robben Island and Gloucester Cathedral. St Magnus
  Cathedral states two ends and no start.
- **A museum's closing.** Of the 1,948 museums in the subset with ten sitelinks or more, 47 state
  an end (`P576`) and 11 an official closure (`P3999`); Frick Madison carries both (3 March 2024).
  Of six read by hand three are right (the Newseum, the Deutsche Guggenheim, Frick Madison). The
  other three date the prison or the station the museum is in, and the museum is open (Alcatraz,
  the Hamburger Bahnhof, Fremantle Prison).
- **A closure.** OpenStreetMap's `opening_hours` is `off` or `closed`, or names a year, on the
  objects of 9 offered places, of the 681 whose object carries the tag. Of five read by hand four
  are useful: the Pergamon Museum (`off`, with the note "Wegen Sanierung geschlossen" and no end),
  Turku Cathedral ("2026 Feb 09 - 2028 Dec 02 off"), the Olympiaturm in Munich and Museum Ulm.
  Wikidata's *temporarily closed* stands on two of the 1,948 museums and is stale on both (the
  Ipiranga Museum reopened in 2022).
- **A season.** Wikidata states none (above). OpenStreetMap closes whole months on 4 offered
  places (Verla's mill village, "Oct-Apr: off"). English Wikivoyage has a page of its own for 463
  offered places, and a rough pattern finds season wording on 138 of them: "Boats sail May-Sep"
  for Skellig Michael, "The main season is from March to June" for Tubbataha.
- **An event's dates.** Of nine festivals read, three carry a yearly rule (`P837`: La Tomatina,
  "last Wednesday in August") and none states the dates of a year. The Gion Matsuri and Holy Week
  in Seville carry neither.
- **A listing's dates.** UNESCO's dataset gives the inscription date on all 1,272 offered World
  Heritage records. An end is stated only by the designations with an end time, counted above.

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
| `stood` | Christ the Saviour: 1883 → 5 Dec 1931, destroyed; 2000 → open. Nelson's Pillar in Dublin: 1809 → 8 Mar 1966, destroyed, and no open period. Frick Madison in New York, in Art Museums: 2021 → 2024, closed, and no open period. |
| `used` | Hagia Sophia: a church 537 → 1453, a mosque 1453 → 1931, a museum 1935 → 2020, a mosque 2020 → open. Göbekli Tepe: about 10,000 BC → about 7000 BC. |
| `closed` | The Pergamon Museum: October 2023 → 2027. |
| `held` | Holy Week in Seville: 21 → 28 March 2027. |

**"Stood" means "was there to visit as what it is offered as"** (the maintainer, 2026-11-16,
#2578). For a bridge or a cathedral that is the structure. For a record offered as a museum it is
that the museum was open as one: the museum's closing for good ends the standing of the place's
membership in Art Museums, though its building stands. That ending has a word of its own, *closed*, beside destroyed, demolished,
removed and collapsed, and the card reads "closed in 2024" (Frick Madison). A building whose use
changed is not affected: Hagia Sophia stands, and its years as a museum are one of its uses. The
ending *closed* is not the `closed` period of the table, which is a closure a place comes back
from. #2584 builds the ending.

**Standing is kept per membership** (the maintainer, 2026-11-17,
[#2578](https://github.com/uncovering-world/track-your-regions/issues/2578#issuecomment-6949064473)). A closing
ends, or pauses, the place's membership in one kind, and the place stands in every other kind
that offers it. Were the Museum of San Marco in Florence, offered in Art Museums and in Places of
worship, to close for good as a museum while its church stayed open, it would leave Art Museums,
marked with the year it closed in that kind's section (decision 7), and stay in Places of worship. A
closure until a date pauses one membership the same way and leaves the others untouched. So the
key of `place_periods` carries the kind: a `stood` or `closed` period that names a kind holds for
the place's membership in that kind. That a period which names no kind holds for the place in
every kind, as Christ the Saviour's destruction does, and how decision 5 reads the two, is the
session's reading, open to the maintainer's veto. A curator's controls for it ("end this
membership", "pause this membership") are designed later, with the curator's section of the
place's card, and nothing builds them before.

**A place under construction is offered from when it is there to visit as what it is offered as**
(the maintainer, 2026-11-17,
[#2584](https://github.com/uncovering-world/track-your-regions/issues/2584#issuecomment-6949327510)). That is the
meaning of "stood" applied to a beginning: the Sagrada Família in Barcelona, a basilica in use
while it is still being built, is offered, and the Jeddah Tower, a stump on a building site, is
not until it opens. A standing period may begin in the future, so a place with a known opening
date appears by itself on that day. Which signal tells the two apart (an opening or a
consecration date, visitors), measured on the catalogue with a card for the doubtful ones, and
how many places the rule touches are the session's to settle before #2584 builds it.

A place's standing periods for one kind, or for no kind, do not overlap. None ends in the future,
though one may begin there; a closure may end there.

**A named use is proposed by a run and answered by a curator** (the maintainer, 2026-11-16 and
2026-11-17, #2578). This replaces the Draft's first text, "a use's name is a curator's words, and
runs propose none", which was the session's. A run reads the classes and uses its item dates onto
its record's view as named uses, and none of them is written to the place as a fill: each is a
proposal a curator confirms, corrects or refuses. Hagia Sophia's item proposes a mosque 1453 →
1931, a museum 1935 → 2020 and a mosque 2020 → open; the curator adds the church of 537 → 1453,
which the item deprecates, to a list that is already on the card, and refuses the museum of 2024,
which is its upper gallery. A run still reports the end of a use, unnamed and with a start that
is not known, as ADR-0214 had it.

**A temporarily closed place stays in its list and is no category of its own** (the maintainer,
2026-11-16, #2578; it stood in this Draft as the session's rule until the maintainer confirmed it). It is
shown as temporarily unavailable, greyed or with a mark: the Pergamon Museum, "closed until 2027".
A closure alone never puts a place in the section of decision 7. #2128 builds the mark.

The words a card prints (built, destroyed, rebuilt, closed, in use until) are read from the
periods and stored nowhere.

**3. Each source's view of a place's periods is on its record** (`record_periods`, which replaces
`record_dates`), written whole by its run. The gate of ADR-0214 decision 4 stands, said for a list,
but for the end of a place no reader sees yet, which it asked and this writes:

- a view that leaves every date the place holds as it is, and leaves the place standing or not as
  it was, is a fill and passes: it has no period fewer, and each start the place holds is still a
  start and each end still an end, told the same way. Christ the Saviour held as "1883 → open" and
  reported as "1883 → 1931, 2000 → open" is one;
- any other difference is asked under a gated source on a place readers see, as one question
  showing the place's periods beside the source's;
- the end of a place's last standing period, or of the last standing period of one of its
  memberships, is never a fill: on a place readers see it is always asked, whatever the source
  and whether or not it is gated, and on a new place it is written with the arrival, whose
  arrival card is the question (Nelson's Pillar). ADR-0214 decision 4 asked every end under a gated source, a
  new place's included; the maintainer's decision of 2026-11-16 on #1719 narrows it there. That
  such an end is asked under a source that is not gated too is the session's, closed on
  2026-11-17 on a measurement (#2619 line 1.6): of six museum end dates read, three date the
  prison or the station the museum is in, and the Hamburger Bahnhof in Berlin, whose item dates
  the station's end, is open. It carries the maintainer's rule of 2026-11-15 on #1719, that an
  end which would hide a place is always asked, to its reason. A museum's closing for good is
  such an end (decision 2);
- a named use is never a fill, on any place: it is written only by a curator's answer
  (decision 2).

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

An end its item dates where the gone rules read no state of use (Nelson's Pillar carries an end
of existence and none) is asked on the ordinary card of a held end, with the source's date
proposed, once #2585 has counted such rows so that the queue is not flooded. That follows from
the maintainer's rule of 2026-11-15 on #1719 that an end which would hide a place is always
asked, and #2619 line 1.12 closed it so on 2026-11-17.

A gap longer than a century is never a fill: it is asked on a place readers see under a gated
source, and written with the arrival on a new one, as the end of the last standing period is. An
item cannot say what stood in so long a gap. The Odeon of Herodes Atticus in Athens states a
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

A listing's dates are the list's and never the place's: entering a list is not the beginning of
the place, and leaving it is not its end (the maintainer, 2026-11-16, #2578; decision 8). Machu
Picchu stood for five centuries before its listing began in 1983. For a list kept outside the
catalogue (World Heritage, the kinds `KINDS_KEPT_AS_FORMER` names) neither date hides the place
from a screen: each moves it between the list and a section beside it (decisions 6 and 7). A
membership of a kind the catalogue fills by its own rule has no listing dates; its standing in the
kind may still end, as a museum's does, and it is then in that kind's section (decisions 2 and 7).
Both dates have a source that
proposes them (decision 13). The start is the list's own: UNESCO's dataset gives the inscription
date on every offered World Heritage record. The end is asked with the *former* question: when
the dataset drops a site, its record goes missing, and the card offers the end time of the item's
World Heritage designation as the date ("UNESCO no longer lists this site. Wikidata says the
listing ended on 21 July 2021", for Liverpool), which the curator confirms or corrects.

**A work's link to its museum holds periods the same way** (the maintainer, 2026-11-17,
[#2578](https://github.com/uncovering-world/track-your-regions/issues/2578#issuecomment-6949225433)). Vermeer's
*The Concert* and Rembrandt's *The Storm on the Sea of Galilee* hung in the Isabella Stewart
Gardner Museum in Boston until the theft of 1990: read as of 1985 the museum's list of works
holds them and they can be ticked, and today they stand in a section of what is no longer there
(decision 7). A move is the same fact: *Guernica* was in New York until 1981 and is in Madrid
since. The dates are proposed from Wikidata's dated location statements (location, P276;
collection, P195) and answered by a curator (decision 13). The first cut may hold only an end
("here until 1990"), and full periods follow with no change of the schema. The link's
`missing_since` (`experience_treasures`) says only when a run stopped seeing the link, which is
not the year the work left. An issue under Epic #2115 builds it.

**5. A place is gone when it has standing periods and none is open.** That is the one statement.
It is read with decision 2's meaning of "stood", and per membership: the periods that name no
kind say whether the place is gone, and a membership stands on a date when the place does and,
where it has standing periods of its own, one of them holds. Frick Madison is not gone: its
membership in Art Museums has ended, as the museum it is offered as, while the building it used
stands. That reading of the ruling of 2026-11-17 (decision 2) is the session's.
`experiences.existence` goes; a curator's *lost* closes the place's standing, and on a place with
no standing period it writes one ended period whose start is not known; a rule that reads a
place as gone reports that end on its record's view and the gate decides (#2584 converts the
remaining refusals). `experiences.stands_today` is derived from the periods by a trigger and
written by nothing else, as the place's `missing_since` is derived from its records (ADR-0084).
A membership's standing today is derived beside its `source_membership` the same way (the
session's reading of "standing is kept per membership").

**6. The catalogue is read as of a date.** One predicate says whether a place is offered in a
kind: its membership there stands (decision 5) and is listed, on a date, with today as the default
(`db/readerPredicates.ts`).

- Today, it is the derived columns of decision 5 and `source_membership`, on rows the read
  already holds.
- On a past date, it asks the place's standing periods and the record's listing periods by their
  outer days. A date that does not settle the question offers the place, and a place with no
  standing period stood at every date.

For a trip of 2015, Liverpool is a World Heritage Site and the Arch of Reunification in Pyongyang
stands; for a trip of 1980 the Cathedral of Christ the Saviour is not offered. Admission and
publication are not dated: the catalogue's own curation is not history.

**The date of a traveller's past trip is in no public address and no shared cache key.** A screen
read as of such a date is the traveller's own, as their own point is. The maintainer ruled on
2026-11-16 (#2579, comment of 19:00Z) that a traveller's own point is in no log and no URL; the
session carries that rule to the trip's date by the same reasoning (2026-11-17, #2619 line 3.6),
open to the maintainer's veto.

**A list read as of a date is the list as it stood on that date** (the maintainer, 2026-11-17,
#2578, comment of 10:30Z, which completes the rulings of 10:20Z and 10:24Z of that day). The
start and the end of a listing are read alike. Where the list is kept outside the catalogue,
neither hides a place from the screen, and both move it out of the list into a section that
says why (decision 7):

- Machu Picchu, inscribed in 1983, is not in the World Heritage list of 1980. The screen of 1980
  shows it in the section of what is not yet listed, and it is ticked from there.
- Liverpool, listed from 2004 until 21 July 2021, is in the list of 2015. Read as of 2023, or
  today, it is in the section of what is no longer listed; read as of 1990, in the section of
  what is not yet listed.
- **The one bound is the place's own beginning:** nothing is shown on a date before it existed.

So the maintainer's sentence of 2026-11-16 (#2578, comment of 13:27Z) that "lists, kinds and
counts are those of that date" stands for the list and its count, and does not say what the
screen leaves out.

The session reads two consequences from that ruling, each open to the maintainer's veto:

- **A place built after the date is on no screen of that date, in the list or in a section.**
  The Sydney Opera House, opened in 1973 and inscribed in 2007, is in the section of what is not
  yet listed for a trip of 1980, and on no screen of 1960.
- **Read as of a date before a list began, the list is empty and its places are in the section
  of what is not yet listed.** The World Heritage List took its first sites in 1978: for a trip
  of 1950, Machu Picchu is shown there as a future World Heritage Site, and the count over the
  list has nothing to run over.

**7. What is no longer there is a section of each list, not a kind, and what is not yet listed
is a second section built the same way** (the maintainer, 2026-11-16, #2578, comment of 13:27Z,
for the first; 2026-11-17, #2578, comment of 10:30Z, for the second). After a kind's list comes
what was offered in it before the date the catalogue is read at and is not offered on it: places
that no longer stand, places whose membership in the kind closed (decision 2), and places that
left a list kept outside the catalogue (World Heritage; the kinds `KINDS_KEPT_AS_FORMER` names).

- Each is grouped under the kind it belonged to and marked from the period that ended: "destroyed
  in 1966" (Nelson's Pillar), "delisted in 2021" (Liverpool), "closed in 2024" (Frick Madison).
- Today's main list never offers such a place.
- Search finds such a place, marked with its end ("destroyed in 1966", Nelson's Pillar), and the
  map shows it only while the section is open. That follows from the maintainer's ruling that a
  place of the section can be ticked (2026-11-16, #2578, comment of 13:27Z), which it cannot be
  if it cannot be found; #2619 line 1.11 closed it so on 2026-11-17, and the reading is the
  session's.
- A place that left a list is ticked there like any other place, and no question "when were you
  there?" is asked (the maintainer, 2026-11-17, #2578, comment of 10:24Z; for such a place it
  replaces the "asks when" of the ruling of 2026-11-16, comment of 13:27Z). Liverpool, ticked in
  the section, is a visited place. The tick carries the date offer every tick carries
  (ADR-0202), which may be left unanswered.
- Ticking a place that no longer stands opens the past-trip flow, which tells the traveller that
  past-travels mode exists and offers to say when they were there (the maintainer, 2026-11-16,
  #2578, comment of 13:27Z; the rulings of 2026-11-17 speak of a place that left a list and
  leave this standing). That the answer is no condition of counting is the session's reading: a
  tick on Nelson's Pillar can only be a visit before 8 March 1966, so no count waits for the
  date. It is offered to file the visit under a trip (ADR-0202), and may be left unanswered
  (decision 8).
- The same section stands in past-travels mode, relative to its date: for a trip of 2015 it holds
  what was already gone by 2015, so Nelson's Pillar is in it and Liverpool is in the main list.
- A temporary closure is never a reason to be in it (decision 2), and takes no place out of it.
  A place that no longer stands or left its list is in the section whether or not it is also
  closed: Liverpool, delisted, would stay in it with a dock closed for works, marked as both.
- There is no category such as "World Heritage 2004–2021", and #2009's virtual kind with its own
  pin colour is not built.
- A membership the catalogue ends by a change of its own rule, while the place stands and is open,
  is in neither section: nothing happened on the ground, and the sections say what happened there.
  The place leaves the kind's list as any refusal takes it out. That is the session's rule of
  2026-11-17 (#2619 line 1.5), open to the maintainer's veto; the ruling of that day replaced the
  session's earlier rule only for a membership whose end is a fact of the world (a museum that closed).

**The section of what is not yet listed** holds what existed on the date the catalogue is read
at and entered the list later (the maintainer, 2026-11-17, #2578, comment of 10:30Z): Machu
Picchu, read as of 1980, "as a future World Heritage Site". A place in it can be ticked from
there, and the visit counts under the list of the date each screen shows (decision 8). The
session reads the rest from the ruling's "built the same way", open to the maintainer's veto:

- It is grouped under the kind and marked from the period that begins: "inscribed in 1983".
- It holds only a place that stood on the date (decision 6), and only in a kind whose list is
  kept outside the catalogue, the kinds the first section holds a delisted place for. A bridge is
  a bridge whenever it stood, so no bridge is "not yet listed".
- No question "when were you there?" is asked on a tick there, as none is in the first section:
  no count depends on the answer.
- Today's screens have none: what will enter a list after today is not known.
- A place in a gap between two listings would be in the section of what is no longer listed,
  marked from the listing that ended. No World Heritage site has been listed twice, so no real
  place tests this.

A membership that closed is in its kind's section, whichever kind it is (the maintainer,
2026-11-17, [#2578](https://github.com/uncovering-world/track-your-regions/issues/2578#issuecomment-6949064473)):
Frick Madison, "closed in 2024", is in the section of Art Museums, a kind the catalogue fills by
its own rule. This replaces the session's rule of 2026-11-16 that a former membership of a kind
the catalogue fills by its own rule is in no section.

**8. A count is read over the list of the date shown, and when a visit happened changes none**
(the maintainer, 2026-11-17, #2578, comments of 10:24Z and 10:30Z). This replaces the text this
decision held from the maintainer's ruling of 2026-11-16 (#2578, comment of 21:06Z): that a visit
made while a place was listed keeps counting under the list after the place leaves it, that only
a visit after the delisting is "a visit to a former site", and that a traveller who ticks today
a place no longer listed is asked when they were there. The Draft's first text, in which a visit
counted only inside a listing period and a visit with no dated trip "counts by today's state",
was the session's and went on 2026-11-16.

- **Four dates are told apart and never merged:** a place entered a list, left a list, was built,
  was destroyed. Entering a list is not the beginning of the place (the maintainer, 2026-11-16,
  #2578, comment of 21:06Z; this part of that ruling stands).
- **When a visit happened changes no count, as long as the place still stands.** A visit before
  the place entered a list counts, and so does a visit after it left. A traveller at Machu Picchu
  in 1980 visited a World Heritage Site, though it was inscribed in 1983.
- **What changes when a place leaves a list is the list.** A count is read over the list as it is
  on the date shown: today the traveller reads "10 of 21" where it was "10 of 22". Liverpool
  stays a visited place; today it is not among the World Heritage Sites the count runs over.
  Read as of 2015, the list holds it and the count includes it.
- **No question "when were you there?" is asked for a place that left a list.** Nothing depends
  on the answer.
- **A place in either section can be ticked from there, and the visit counts on any screen under
  the list of the date that screen shows.** The count on a screen runs over the list as it stood
  on that screen's date (decision 6).

The session reads these consequences from those rulings, each open to the maintainer's veto:

- **"k of N" on any screen is over the list of the date that screen shows.** N is the places
  offered in the kind on that date (decision 6), and k is those of them the traveller has
  visited. No count reads a trip's date or the moment a tick was recorded.
- **Machu Picchu, ticked from the section of what is not yet listed for a trip of 1980,** is in
  today's count of World Heritage Sites, where the list holds it, and in no count of the screen
  of 1980, where it does not. That is how "a visit before the place entered a list counts" and
  "the list as it stood" are read together.
- **Liverpool counts by the screen and not by the visit.** A traveller who was there in 2023,
  two years after the delisting, reads Liverpool as visited among the World Heritage Sites of
  2015, as one who was there in 2015 does; neither reads it in today's count.
- **A traveller who had ticked the place sees both numbers fall.** The ruling's "10 of 21" where
  it was "10 of 22" is the count of a traveller who was never in Liverpool. One who was reads
  "10 of 21" where it was "11 of 22", and finds Liverpool, ticked, in the section of decision 7.
- **A place that no longer stands** is what the ruling's "as long as the place still stands"
  leaves unsaid. A tick on Nelson's Pillar in Dublin can only be a visit before its end on
  8 March 1966, so no date is needed to count it, and none is asked for counting (decision 7).
  The pillar is in no list of today, so no count of today runs over it: it is a visited place in
  the section of what is no longer there. Read as of 1960, the list of its kind holds it and the
  count includes it. The Arch of Reunification in Pyongyang, ticked in 2023 and taken down in
  2024, reads the same way: counted in the list of 2023, and a visited place in today's section.
- **A place that stands again counts whatever its trip's date.** The Cathedral of Christ the
  Saviour is not offered on the screens of 1980 (decision 6), so it is not ticked from the list
  of 1980 by mistake. A tick on it counts in every list that holds the cathedral, today's among
  them, and no count leaves it out because a trip under it is dated 1980. This replaces the
  session's sentence of 2026-11-16 that such a trip "was not a visit to the cathedral": the
  ruling has no count follow the date of a visit. The question #2619 line 1.8 held is closed by
  that ruling (2026-11-17).
- **A visit read through another one** (a whole through a part, a venue through a work seen in
  it, an area through a place inside it) is counted the same way, with no date read. A tick on
  the Pier Head makes Liverpool, once it is taken in, a visited place, counted among the World
  Heritage Sites wherever the list shown holds Liverpool. The part's record in its whole decides
  only whether the part is counted in the whole's own "k of N". #2008 builds the read.

The session's consequence of 2026-11-16 that placed a visit with no trip by the moment its tick
was recorded (`user_visited_experiences.marked_at`) goes with the rule it served: nothing needs
to know when a visit was in order to count it.

**9. What repeats every year is a season** (`place_seasons`): a window from one month, with a day
where known, to another, which may wrap over the new year, saying *open* (Sceilg Mhichíl, mid-May
to September) or *held* (the Gion Matsuri, 1 to 31 July). A window that shifts is marked so and
read as "usually" (a mountain pass, June to October). A movable event holds its rule in words
(Holy Week in Seville: March or April). A biennale is its dated editions.

A season is proposed and never written without a curator, and the dates of a movable event for
one year have no source (decision 13). So the `held` period of a year stays a word of the
vocabulary, and no form, card or reader is built on it until a source is found: Holy Week in
Seville reads "March or April" and no more. That is the session's rule of 2026-11-17, from the
maintainer's principle; it replaces the session's earlier "where a source or a curator gives
them … nobody is obliged to enter them".

**10. A delisted World Heritage site is taken in from Wikidata.** The maintainer decided on
2026-11-16 (#2578) that such a site is in the catalogue like every other, with the dates of its
listing, and asked for a way to take it in and for the plan to name its source; the method is the
session's. The World Heritage run reads
every World Heritage designation that is not deprecated and carries an end time, on an item whose
list id (`P757`) the dataset no longer gives. Each arrives as a World Heritage record under that
id, held for a curator, with its listing period from the statement's start and end times and its
picture found by the id as any site's is (ADR-0043). A curator publishes the delisted sites and
refuses a site listed today inside a larger property. A site delisted from now on is already in
the catalogue: its record goes missing, and the curator's *former* closes its listing.

**11. A place's past positions are a table of this shape, built with the past-trip map**
(`place_past_positions`: a point, from, until). The Arch of Neutrality in Ashgabat stood at
37.9369, 58.3800 from 1998 to 2010 and stands about 7 km away since; it has one standing period,
since it was moved and not lost. The table and its deferral are the session's (2026-11-16, open
to the maintainer's veto). A past position is proposed by a run from a coordinate its item dates
with an end time and answered by a curator; nothing is built on it before the past-trip map.

**12. Of ADR-0214,** decision 2 (the date; its sentence "Only `ended` may hold no year" gives way
to decision 1 here, where either end of a period may be not known), decision 4 (the gate, as decision 3 here says it for
a list) and decision 5 (the inception year is the place's, not a kind fact) stand. Decision 1
(four slots) is replaced by decision 2 here, and decision 3 (the `ended` slot hides the place) by
decision 5: only the end of the place's standing hides it, and the end of a use never does.

**13. The model holds no fact a curator would have to enter from nothing** (the maintainer,
2026-11-16 and 2026-11-17, #2578). Every fact a curator sets has a source that proposes
candidates, which the curator confirms, corrects or refuses.

The session reads the principle as a rule about the model and what is built on it, and not as a
limit on a curator: **the model holds no fact without a source that can propose it, and nothing
is built that needs a curator to enter a fact from nothing.**

- A curator may complete or correct a proposed row: the year on a proposed "gone", the end on a
  proposed "closed now".
- A curator may still give, on their own knowledge, the verdicts the product already has:
  *lost* on a place (decision 5) and *former* on a membership (decision 4). Each is an answer
  about a fact that has a source of proposals, the gone rules for the first and the run's missing
  detection for the second, whether or not that source has spoken on this place.
- A fact with no source keeps its place in the vocabulary, and no form or card is built for it:
  a movable event's dates for one year (decision 9).

Which source proposes each fact below is the session's reading of the Context's second
measurement.

| A curator sets | What proposes it | What is not built yet |
|---|---|---|
| A place's standing periods and their ends (decisions 2 and 3) | The run's view of its item's dates and events: a start on 2,249 offered places, an end on 184 | The card that shows a held difference to a curator |
| An end with no date ("gone, when is not known") | A gone state or class with no dated end, on 9 offered places: the Temple of Artemis at Ephesus. The source proposes the row with no year, and a curator who adds the year completes a proposed row | The same card |
| A museum's closing for good (decision 2) | The end and the official closure its item states. Right on three of six read: Frick Madison's is the museum's, and the Hamburger Bahnhof's is the station's. So it is a proposal. The maintainer's rule of 2026-11-15 (#1719) asks, under a gated source, every end that would hide a place readers see, and decision 3 asks it whatever the source: the session's, closed on that measurement on 2026-11-17 (#2619 line 1.6). The closing ends the membership in Art Museums only (the maintainer, 2026-11-17) | #2584 keeps a dissolved museum's record, which the reader drops today |
| A named use (decision 2) | The classes and uses its item dates, on 151 offered places | Their reader, and the card |
| A closure (decision 2) | OpenStreetMap's `opening_hours` on the place's object in the layer: proposals only. It says "closed now" (the Pergamon Museum) and seldom until when (Turku Cathedral), so the source proposes the row with no end, and a curator who adds the end completes a proposed row; else the end stays not known. Wikidata's *temporarily closed* is not read | #2128: a reader of the tag, the proposal and its card |
| A season of a place (decision 9) | The text of English Wikivoyage read by a model, the sentence quoted on the card ("Boats sail May-Sep", Sceilg Mhichíl): proposals only. The months are facts, and none of the CC BY-SA text is kept. OpenStreetMap closes whole months on four places | The source's record in the register (`docs/sources/global/wikivoyage-see-listings.md`) says `model: none`: the record and the line of `docs/tech/external-services.md` (ADR-0148) are amended before any text is sent to a model |
| An event's yearly window, and a movable event's rule in words (decision 9) | Wikidata's yearly rule, on three of nine festivals read: La Tomatina, "last Wednesday in August" | Nothing before #1676 names the kind and its source |
| A movable event's dates for one year (decision 9) | No source: none of nine festivals states them | No form, no card, no reader. The word `held` stays |
| A listing's start (decision 4) | The list's own dataset: all 1,272 offered World Heritage records | — |
| A listing's end (decision 4) | The run's missing detection proposes *former*, and the end time of the item's designation proposes the date: Liverpool, 21 July 2021 | The date offered on the *former* question |
| The intake of a delisted site (decision 10) | The ended designations: seven candidates, three of them delistings, each an arrival card | The reader in the World Heritage run |
| A past position (decision 11) | A coordinate its item dates with an end time: 2 offered places, 11 arriving | The table and its reader, with the past-trip map |
| A work's time at its museum (decision 4) | Wikidata's dated location and collection statements (P276, P195): *The Concert* at the Gardner Museum until 1990, *Guernica* in New York until 1981 | The periods on the link, their reader and card, and the issue under Epic #2115 that builds them |

**Amended as a Draft, from what its first slice built (#2578):** decision 1 says that a period has an
end, not that it has ended, since a closure's end may lie ahead, and names the two outer days a
period keeps, one per end; decision 2 says that a run's use has no known start; decision 3 says
what "leaves every date as it is" compares, and that the end of the last standing period is asked
under a gated source on a place readers see and written with the arrival on a new place, which
narrows ADR-0214 decision 4, where every end was asked. Built so far: decision 1; decision 2 as
first drafted, which is the four kinds of period and the endings destroyed, demolished, removed
and collapsed (the ending *closed* is #2584's to build, and no slice builds named uses proposed by
a run yet); decision 3; and the derived column of decision 5; `existence` (decision 5), the listing periods (decision 4),
the read as of a date (decisions 6 to 8), seasons, the intake of delisted sites and past positions
(decisions 9 to 11) are built by later slices of #2578.

**Amended as a Draft, from what its second slice built (#2578):** decision 3 says that every gap is
read, which events a run reads and what they may not say, and that a gap longer than a century is
asked; three trade-offs of that reading are named. Read so on the subset of the Context's measurement, 17 offered places and 20 arriving ones
have a gap (6 and 10 from inceptions and ends alone, as the first slice read them), where the
Context's count by a simpler rule was 21 and 31: that rule counted every start later than an end,
Bath Abbey's among them, whose end of 1539 is its monastery's, before the church was built.

**Amended as a Draft, to the maintainer's rulings of 2026-11-16 and 2026-11-17 (#2578):** the
Draft was merged before four of the maintainer's rulings were recorded, and it stated two of the session's
rules as if they were settled. This amendment is written on the text of the second slice's
amendment above.

- Decision 2 says what "stood" means and gives a museum's closing the ending *closed* (Frick
  Madison), from the maintainer's ruling of 2026-11-16 on a museum that closed for good. Decisions 5 and 7
  follow it.
- Decision 2's "runs propose none" for named uses is replaced: a run proposes them from Wikidata
  and a curator answers (2026-11-16 and 2026-11-17), with the measurement in the Context.
  Decision 3 says a named use is never a fill.
- Decision 2's rule for a temporarily closed place is the maintainer's since 2026-11-16, and says so.
- Decision 8 is rewritten to the maintainer's ruling of 2026-11-16 on what a visit counts as. Its sentence
  that an undated visit "counts by today's state" was the session's and goes, with the reading
  that a visit before a listing began does not count (Machu Picchu in 1980). Three sentences are
  added as consequences: a visit read through another takes that visit's trips, a place with no
  standing period stood at every date, and a tick with no date is placed by when it was recorded.
- Decision 13 is new: the maintainer's principle that a curator enters nothing from nothing, with the source
  that proposes each fact this ADR has a curator set. Its reading is the session's: a rule about what
  the model holds and what is built, under which a curator may complete or correct a proposed row
  and still gives *lost* and *former* on their own knowledge. Decisions 4, 9, 10 and 11 name theirs.
  Decision 9 no longer has a curator enter a movable event's dates for a year.
- Decision 7 gains the sentences of the maintainer's ruling the Draft had left out (today's main list never
  offers such a place, the flow asks when, the section in past-travels mode), and marks as the
  session's the rule for a former membership of a kind the catalogue fills itself. Decisions 10
  and 11 say which part is the maintainer's and which the session's.
- The first amendment note said "Accepted with" of a Draft, and now says "Built so far".
- The Consequences name the maintainer's ruling of 2026-11-17 (#2116, #2586) that no curator's decision is
  carried from the development catalogue. The Draft said nothing of carrying one, so no sentence
  is withdrawn.

Not decided by this amendment, and the maintainer's to decide before the ADR is accepted:

- whether the closing of a museum ends the standing of a record that another kind offers as
  well, as a building;
- whether the session's reading in decision 13 stands, that a museum's closing is asked under a
  source that is not gated. Art Museums is not gated on a database migrated from before #2335, and by decision 3 such a source writes a
  difference unasked: the Hamburger Bahnhof's item dates the station's end, and the museum is
  open;
- the time of a work in its museum: *The Concert*, stolen from the Gardner Museum in 1990, which
  #2578 asks to be decided before this ADR is accepted, or in an ADR beside it.

**Amended as a Draft, to the maintainer's three rulings of 2026-11-17 on lists and counts (#2578,
comments of 10:20Z, 10:24Z and 10:30Z):** the session of queue #2458 asked the maintainer the
two questions the note above had left open, and the answers change what decisions 6, 7 and 8
said. The ruling of 10:24Z replaces the maintainer's ruling of 2026-11-16 (#2578, comment of
21:06Z) in two of its four points, and says so itself. The ruling of 10:30Z completes the other
two, after the session pointed out that they treated a listing's start and its end differently.

- **Why.** The rule of 2026-11-16 made a count depend on when a visit was. A traveller who
  cannot say when they were in Liverpool had no answer to give, and two travellers with the
  same ticks could read different counts over the same list. Now the count follows the list of
  the date shown, and a place the list does not hold on that date is still on the screen, in a
  section that says why.
- Decision 6 keeps its predicate, which reads both ends of a listing, and says what the rulings
  add: the list of a date is the list as it stood, neither end of a listing hides a place from
  the screen, and the one bound is the place's own beginning. Machu Picchu is not in the list of
  1980 and is on its screen. It gains the sentence that a place with no standing period stood at
  every date, which stood in decision 8. Two consequences are the session's and marked so: a
  place built after the date (the Sydney Opera House), and a date before the list began.
- Decision 7 gains the section of what is not yet listed (the ruling of 10:30Z), with the
  session's reading of "built the same way" marked. Its bullet "ticking one opens the past-trip
  flow, which asks when" is split. For a place that left a list no "when were you there?" is
  asked (the ruling of 10:24Z). For a place that no longer stands the flow of the ruling of
  2026-11-16 (13:27Z) stays, and the session reads its date as an offer that files the visit
  under a trip and is no condition of counting (Nelson's Pillar).
- Decision 8 is rewritten to the rulings of 10:24Z and 10:30Z. Gone: that a visit made while a
  place was listed keeps counting after the delisting, the "visit to a former site", and the
  "when?" asked on a tick of a place no longer listed. Kept from the ruling of 2026-11-16: the
  four dates told apart, and that a visit before a listing began counts. The session's
  consequences are rewritten and marked: "k of N" is over the list of the date a screen shows,
  Machu Picchu ticked for 1980 counts today and not on the screen of 1980, a place that no
  longer stands counts in the lists of the dates it stood on, and a visit read through another
  one reads no date. Two of the session's consequences of 2026-11-16 go: a visit placed in time
  by when its tick was recorded, and a trip of 1980 that "was not a visit" to the Cathedral of
  Christ the Saviour.
- Decision 4 says that neither date of a listing hides a place from a screen, for a list kept
  outside the catalogue; a kind the catalogue fills by its own rule keeps the session's rule
  under decision 7.
- The Context names the three rulings; the alternatives hold the rule of 2026-11-16 and the
  first wording of the ruling of 10:20Z, each with the reason it was replaced; the consequences
  no longer say that a visit keeps counting after a delisting or that a tick on Liverpool asks
  when.
- The note above listed two questions as not decided: whether past-travels mode for 1980 lists
  Machu Picchu among the World Heritage Sites, and what "I do not remember" counts as. The first
  is answered by the ruling of 10:30Z (in the section of what is not yet listed), and the second
  no longer arises, since the question is not asked. Both are taken off that list.

Not decided by this amendment, and the maintainer's to decide before the ADR is accepted:

- whether a tick on a place that stands again counts when the only trip under it is dated inside
  the gap: the Cathedral of Christ the Saviour with a trip of 1980. Decision 8 counts it, as the
  session's reading;
- whether ticking a place that left a list still tells the traveller that past-travels mode
  exists, with no question: Liverpool, ticked in today's section. Decision 7 says only that
  nothing is asked.

**Amended as a Draft, to the maintainer's rulings of 2026-11-17 put from #2619 (#2578, #2584),
and to the lines of #2619 the session closed the same day:** the session of queue #2458 put to
the maintainer the questions the two notes above had left open, with others its audit of ADRs
against issues found (#2619, group 1). Each change below names its line there.

- **Decision 2, standing per membership (line 1.5).** A closing ends or pauses the place's
  membership in one kind, and the place stands in every other kind that offers it (the
  maintainer, 2026-11-17, [#2578](https://github.com/uncovering-world/track-your-regions/issues/2578#issuecomment-6949064473)).
  The key of `place_periods` carries the kind. Why: the Museum of San Marco in Florence is
  offered in Art Museums and in Places of worship, and a museum's closing that ended the place's
  standing would take its church out of Places of worship. The sentence that a museum's closing
  "ends the record's standing" now says it ends the membership's. The curator's controls are
  designed later, with the curator's section of the card.
- **Decisions 4, 5, 6 and 7 follow decision 2**, since each read standing as the place's alone,
  which the ruling makes false. Decision 4 no longer says that a membership of a kind the
  catalogue fills by its own rule has no section. Decision 5 reads the place's own periods and a
  membership's apart, and derives a membership's standing today; both are the session's reading.
  Decision 6's predicate asks the membership's standing. Decision 7's section holds a membership
  that closed, and the session's rule of 2026-11-16 that a former membership of a kind the
  catalogue fills by its own rule is in no section is replaced.
- **Decision 2, a place under construction (line 1.10).** A place is offered from when it is
  there to visit as what it is offered as, and a standing period may begin in the future (the
  maintainer, 2026-11-17, [#2584](https://github.com/uncovering-world/track-your-regions/issues/2584#issuecomment-6949327510)).
  The sentence that no standing period "ends in the future" now says that one may begin there.
- **Decision 3, an end under an ungated source (line 1.6).** An end that would take a place
  readers see out of a list is asked whatever the source, gated or not. The session closed this
  on the measurement in the Context: three of six museum end dates read were the prison's or the
  station's (the Hamburger Bahnhof). Decision 13's row says so.
- **Decision 3, an end the gone rules cannot classify (line 1.12).** It raises the ordinary card
  of a held end once #2585 has counted the rows, which follows from the maintainer's rule of
  2026-11-15 on #1719.
- **Decision 4 and decision 13's table, a work's time at its museum (line 1.7).** A work's link
  to its museum holds periods, proposed from Wikidata's dated location and collection statements
  (the maintainer, 2026-11-17, [#2578](https://github.com/uncovering-world/track-your-regions/issues/2578#issuecomment-6949225433)).
  The first cut may hold only an end.
- **Decision 6, the date of a past trip (line 3.6).** It is in no public address and no shared
  cache key: the session's rule, by the reasoning of the maintainer's rule on a traveller's own
  point (#2579).
- **Decision 7, search (line 1.11).** Search finds a place of the section, marked with its end,
  and the map shows it only while the section is open. It follows from the maintainer's ruling
  that such a place can be ticked; the reading is the session's.
- **Decision 8, a trip dated inside a gap (line 1.8).** The consequence that a tick on the
  Cathedral of Christ the Saviour counts whatever its trip's date is settled by the ruling of
  10:24Z, under which no count reads the date of a visit.
- **The header (line 6.21)** names ADR-0214 decision 4, which decision 3 already said it narrows,
  and ADR-0213 decisions 1 and 3, whose `existence` and written *former* decisions 4 and 5
  replace by periods. Read against the header as PR #2617 left it.
- The Context names the three rulings. The alternatives gain the closing of the whole place and
  the refusal of a place under construction, and lose the reason that a closed museum's
  membership "is in no section". The consequences gain what follows.

The questions the two notes above listed as not decided are all answered: the closing of a
museum another kind offers as well (line 1.5), a museum's end under an ungated source (line 1.6),
a work's time in its museum (line 1.7), a trip dated inside a gap (line 1.8), and whether a tick
on a place that left a list tells the traveller that past-travels mode exists (line 1.9, closed
as an interface detail drawn in #2009's mock, so decision 7 does not change).

Not decided by this amendment, and the session's to settle before the slices that build them:
the signal that tells a place under construction open to visitors from a building site, and the
count of places it touches (decision 2); the curator's controls that end or pause one membership,
designed with the curator's section of the card (decision 2).

**Accepted on 2026-11-17** (#2619 line 4.9), after the maintainer's rulings of 2026-11-16 and
2026-11-17 recorded on #2578, #2577 and #2579 and in #2619. No decision changes with the
acceptance. What is still to design is the session's and is named in the note above: the signal
that tells a place under construction open to visitors from a building site, and the curator's
controls that end or pause one membership (decision 2).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the four slots and add a table of standing periods | It stores the gap and keeps every line of #1719. The slots then repeat the first start, the last start and the last end of the periods, so "gone" has two owners for good, a curator's correction is made twice, and every other kind of time is still designed apart. |
| Typed, dated events (built, destroyed, rebuilt, closed, reopened, moved), with the standing periods derived | It matches how Wikidata states 9 of the 21 gaps. No reader asks about an event: each asks whether something was so on a date. The pairing of events into periods would move from the run's reader, tested on named items, into a trigger that must also digest a curator's half-entered history, and an end with no date has no place in an order of events. ADR-0214 rejected the untyped form for the same reason. |
| One validity table for places, memberships, positions and closures alike | No foreign key or cascade to the subject, and rows of four writers and four gates in one closed writer list (ADR-0069). A position still needs its point and a season is not an interval, so side tables remain. What is worth sharing is the date and its comparison, which decision 1 shares. |
| A composite Postgres type for a date | The driver returns a composite as text, so the generated row types and every response schema would need a parser. Columns under one CHECK function are what the tables already hold. |
| The stands-today test as a probe of the periods on every read | An index probe on the hot reads for a fact that changes a few times a year. 99.5 % of offered places have one standing period or none (21 of 4,017 have a gap). |
| Listing dates as columns of the record, or as a World Heritage kind fact | Columns cannot hold a second listing, and a fact of one kind cannot be asked "as of a date" by a reader of every kind. |
| A visit counts only when its trip's date falls inside a listing period, and a visit with no date counts by today's state (this Draft's first text, the session's) | The maintainer replaced it on 2026-11-16 (#2578, comment of 21:06Z). A traveller at Machu Picchu in 1980 would not have visited a World Heritage Site, and 645 of the 1,272 offered World Heritage records were inscribed in 2000 or later. |
| A visit counts by when it happened: one made while the place was listed keeps counting under the list after the place leaves it, and a tick made today on a place no longer listed asks when the traveller was there (this Draft's text of 2026-11-16, from the maintainer's ruling of that day, #2578, comment of 21:06Z) | The maintainer replaced it on 2026-11-17 (#2578, comment of 10:24Z). A traveller who cannot say when they were in Liverpool has no answer to give, and the count would hang on it. Two travellers with the same ticks would read "11 of 21" and "10 of 21" over one list, the eleventh being a site that is not among the 21. |
| Leave a place off the screen of a date before its listing began (this Draft's reading of "lists, kinds and counts are those of that date") | The maintainer ruled otherwise on 2026-11-17 (#2578, comment of 10:20Z). A traveller marking Peru in 1980 would not find Machu Picchu, though the visit counts as one to a World Heritage Site. |
| Put a place listed later into the list of the earlier date (the first reading of the ruling of 10:20Z) | The maintainer completed the ruling on 2026-11-17 (#2578, comment of 10:30Z). The start of a listing would be ignored and its end read: the list of 1980 would hold Machu Picchu, and the list of 2023 would not hold Liverpool. A section of what is not yet listed treats the two alike, and the list stays the one of its date. |
| A museum that closed for good read as the end of a use | Frick Madison would stay in today's list as if it were open. |
| A museum's closing ends the place's standing in every kind (this Draft's text of 2026-11-16, from the maintainer's ruling of that day) | The maintainer completed the ruling on 2026-11-17 (#2578): the Museum of San Marco in Florence, closing as a museum, would leave Places of worship though its church stayed open. Standing is kept per membership (decision 2). |
| A place under construction is refused (#2584 as filed) | The maintainer ruled otherwise on 2026-11-17 (#2584): the Sagrada Família, visited daily while it is built, would be missing. |
| Named uses entered by a curator alone (this Draft's first text, the session's) | A curator would enter Hagia Sophia's four uses from nothing, where its item states three of them with their years. The maintainer's principle of 2026-11-16 and 2026-11-17 refuses it. |
| Write what a source proposes for a use, a closure or a museum's closing without a curator | Hagia Sophia's item deprecates its church period and dates a museum from 2024 that is its upper gallery; three of six museums' ends are the prison's or the station's; both museums Wikidata calls temporarily closed are open. |
| A form for a movable event's dates of a year | No source states them for any of nine festivals read, so a curator would enter Holy Week's dates from nothing, every year. |
| A virtual kind of gone places (#2009 as filed) | The maintainer decided against it on 2026-11-16: a traveller looks for what is gone where it was, at the end of its own list. |
| Take in every ended World Heritage designation without a curator | Four of the seven non-deprecated ones are not delistings (above). |
| Read delisted sites from the designation's best rank | Liverpool's and Dresden's is outranked by a preferred *no value*. |

## Consequences

**Positive:**

- The places #2578 names are each held: Christ the Saviour's and Ponte Santa Trinita's gaps,
  Nelson's Pillar's end, Liverpool's listing, the Arch of Neutrality's move (when its table is
  built), the Pergamon Museum's closure, and Frick Madison's years as a museum. Holy Week in
  Seville holds its rule in words, and its dates of a year when a source gives them.
- A closing takes a place out of one kind's list only: a museum that closed in a church stays a
  place of worship. *The Concert* is in the Gardner Museum's list of 1985, and the Sagrada
  Família is offered while it is built.
- No count depends on a date the traveller may not remember: a visit made before a place was
  listed counts, Liverpool stays a visited place, and "k of N" is read over the list of the date
  the screen shows.
- A list of a past date is the list as it stood, and nothing that existed then is missing from
  its screen: Machu Picchu is ticked for a trip of 1980 from the section of what is not yet
  listed.
- Nothing is built that needs a curator to enter a fact from nothing: each fact a curator sets
  has a source that proposes it.
- One statement says a place is gone and one says a membership is over; each has a derived column
  the hot reads use with no join.
- #2008 and the "no longer there" section read one predicate, and so do the counts.
- #2128 needs no closures table of its own, and #1676's events get their dates without a design
  of their own.
- The tables it replaces are empty, so nothing is migrated. Nothing a curator decided on the
  development catalogue is carried to the fresh database either (the maintainer, 2026-11-17,
  #2116 and #2586), so no period, use or listing a curator answered there needs a path into
  these tables: each is asked again from its proposal (decision 13).

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
- The word *closed* names two things: a closure a place comes back from, and the ending of a
  museum's standing.
- A closure's end, a season outside English Wikivoyage's pages and OpenStreetMap's month
  closures, and a movable event's dates have no source, so the Pergamon Museum may read "closed" with no "until", and Holy Week in Seville shows
  no dates for next year.
- A count falls with no act of the traveller when a place leaves a list: one who had ticked
  Liverpool read "11 of 22" and reads "10 of 21", and finds the site in the section of what is
  no longer there.
- A tick made on a screen may change no count on it: Machu Picchu, ticked for a trip of 1980,
  is counted today and not among the World Heritage Sites of 1980.
- Read as of a date before 1978, the World Heritage list is empty, and every site that stood is
  in the section of what is not yet listed.
- A tick on the Cathedral of Christ the Saviour counts though its only trip is dated 1980, when
  a swimming pool was there: no count reads the date of a visit.
- A gap longer than a century is asked and not filled, so the place holds no standing period of
  that source until a curator answers: its beginning waits with its gap. Bethlehem Chapel in
  Prague, truly gone from 1786 to 1952, is asked as the Odeon is. A trusted source writes such a
  gap unasked, as it writes any difference.
- A gap of a century or less is filled as the item states it, right or not: the Liberty Bridge in
  Budapest reads as gone from 1945 to 2009, since its item prefers an inception of 2009 to the
  one of 20 August 1946 it also states.
- A destruction its item states as a fire or a bombardment is not read, so Kinkaku-ji is offered
  for a trip of 1952, when the pavilion was ash.
- Standing is read per membership as well as per place, so a membership's standing today is one
  more derived column to keep in step with the periods.
- Every end that would take a place readers see out of a list is a curator's question, under an
  ungated source too, so the runs of a kind that is not gated (Art Museums on a database migrated
  from before #2335) add cards where they wrote ends unasked.
- Which signal tells a place under construction that is open to visitors from a building site is
  not measured yet, nor how many places it touches.

## References

- Related ADRs: ADR-0214 (the date, the gate), ADR-0202 (a trip's date), ADR-0020, ADR-0021,
  ADR-0216 (the lifecycle axes and who writes them), ADR-0084 (each source's view, derived
  listing), ADR-0069 (closed writer lists), ADR-0043 (a site's picture by its list id), ADR-0198
  (a record in a kind or in a whole)
- Related ADRs, for decision 13: ADR-0048 and ADR-0148 (a source's record and its terms before it
  is read), ADR-0059 (what is taken from OpenStreetMap)
- Related docs: `docs/tech/experiences.md` § A place's lifetime,
  `docs/sources/global/wikivoyage-see-listings.md`, `docs/tech/external-services.md`
- Issues: #2578, #1719, #2128, #2008, #2009, #2584, #2585, #1676, #2134, #2127, #773, #2116, #2586,
  #2579, #2619, Epic #2115

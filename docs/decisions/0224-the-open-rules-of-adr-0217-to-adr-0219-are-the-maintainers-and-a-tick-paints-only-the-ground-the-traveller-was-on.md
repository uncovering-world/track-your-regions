# ADR-0224: The open rules of ADR-0217 to ADR-0219 are the maintainer's, and a tick paints only the ground the traveller was on

**Date:** 2026-11-17
**Status:** Accepted — decisions 2, 5 and 6 narrowed, and its open questions answered, by [ADR-0225](0225-the-catalogue-has-one-model-of-records-sources-time-relations-works-regions-and-visits.md): an event held at one place with no dated period answers that place on any trip, undated too; a view's own tree is read as ground in that view; a record gone before 1900 takes no undated tick; and each open question has the session's answer
**Built by:** #2619, #2579, #1169, #587, #2594, #2580, #2135, #1676, #2008, #2009, #2631, #2633, #2634
**Narrows:** [ADR-0219](0219-a-visit-is-one-row-on-what-the-traveller-met-and-a-tick-on-a-region-moves-or-asks-when-the-region-goes.md)
decision 3 (a region drawn by hand that holds no division is placed on the canon by its outline,
decision 4 here), decision 4 (no tolerance by area: a region covers another only where it holds
all of it, and a region drawn by hand is read through the canon regions its outline lies on,
decisions 4 and 5 here), decision 5 (an event counts the region it was held in at the trip's
date, decision 2 here) and decision 9 (its read takes that date for an event, and its table's
#2008 row: the date of a trip is held to the place's standing, decisions 2 and 6 here);
[ADR-0217](0217-time-in-the-catalogue-is-held-as-periods-and-the-catalogue-is-read-as-of-a-date.md) decision 7 (the date offered on a tick of a place that no longer stands is
held to its standing and no longer merely files the visit, decision 6 here)

---

## Context

ADR-0217, ADR-0218 and ADR-0219 were accepted on 2026-11-17 with some of their rules marked as
the session's, or the design's, "open to the maintainer's veto". #2619 lists them in three lines:
2.22 (seven rules of ADR-0219), 2.23 (five of ADR-0217) and 2.24 (three of ADR-0218). Each
recommended a nod.

The maintainer answered all fifteen on 2026-11-17, one comment on #2619 per rule, from 20:20Z to
21:00Z, each headed "Decision, the maintainer, 2026-11-17 (#2619 line 2.2N, rule N of M)":

- twelve are confirmed, two of them with a condition that changes what the ADR says (2.22 rules 6
  and 7);
- three are vetoed and replaced by the maintainer's rule (2.22 rules 3 and 5, 2.23 rule 4);
- two answers bring a new rule (2.22 rule 2, 2.23 rule 3), each filed as an issue (#2631, #2633).

The last comment (21:00Z) totals them as "11 rules confirmed (two with a condition), 4 vetoed (2.22
rules 3 and 5, 2.23 rule 4; 2.22 rule 6's condition)", counting the condition on rule 6 as a veto
too. This ADR records rule 6 as confirmed with a condition, and narrows ADR-0219 where the
condition changes it.

An Accepted ADR changes only through an ADR that narrows or supersedes it
(`docs/decisions/README.md`). The three ADRs keep all their other decisions, so this one narrows
the sentences the answers change and supersedes none. It also takes the mark "open to the
maintainer's veto" off each rule confirmed, which the three ADRs cannot do in their own text.

Every decision below is the maintainer's, with the comment it is recorded in. Where the session
had to read an answer to place it in an ADR, the reading is named; what the answers leave open is
listed after the decisions, and nothing there is decided.

## Decision

**1. These rules are confirmed as their ADR states them**, and none of them is open to veto any
longer:

| #2619 | ADR and decision | The rule | Example | The answer |
|---|---|---|---|---|
| 2.22, rule 1 | ADR-0219 decision 5 | A tick on a place paints the region of the place's own point | A Struve Arc station ticked in Finland paints Finland, and the Arc reads "1 of 34" | [20:20Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6959859462) |
| 2.22, rule 2 | ADR-0219 decision 3 | A region with neither bricks nor an outline cannot be ticked | 4,000 of the Wikivoyage view's 4,301 regions on the development database | [20:22Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6959922282) |
| 2.22, rule 4 | ADR-0219 decision 5 | A place listed in several counted regions paints their common region lighter while the side is not said, and asks which side | The Øresund Bridge paints Scandinavia lighter; the answer "Malmö" paints Sweden | [20:44Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960487795) |
| 2.23, rule 1 | ADR-0217 decision 7 | A membership the catalogue ends by a change of its own rule, while the place stands and is open, is in no section of the kind's list | The Guggenheim Bilbao, leaving Art Museums by a change of the rule, simply leaves it | [20:50Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960622232) |
| 2.23, rule 2 | ADR-0217 decision 11 | A place's past positions are kept with their periods and drawn on the map of past trips; today's map shows where it stands now | The Arch of Neutrality in Ashgabat, moved in 2010: a trip of 2005 sees it in the centre | [20:51Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960645056) |
| 2.23, rule 3 | ADR-0217 decision 9 | A movable event keeps its rule in words and no year's dates ("confirmed for now", decision 8 here) | Holy Week in Seville | [20:52Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960680439) |
| 2.23, rule 5 | ADR-0217 decision 6 | A place built after the date a screen is read as of is not on that screen at all | The Sydney Opera House, opened in 1973, is absent from the map as of 1965 | [20:57Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960812654) |
| 2.24, rule 1 | ADR-0218 decision 11 | Below the zoom where an outline reads, an area is its pin, so it stays on the map of its country | Naqsh-e Jahan Square in Isfahan, 560 m long, on a map of Iran | [20:58Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960825490) |
| 2.24, rule 2 | ADR-0218 decision 9 | A type-to-place relation starts as "one can be seen here" and is asked of a curator only on a pair a source proposed | Noratus is not tied to the khachkar until the type article's own links are read (#2248) | [20:59Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960846607) |
| 2.24, rule 3 | ADR-0218 decision 14 | A source's statement that a place is part of a record already confirmed as having parts is a claim taken without a curator; toward a record with no part yet it is a proposal a curator answers | Housesteads and Hadrian's Wall; it narrows ADR-0150 decision 1, as ADR-0218 records | [21:00Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960871192) |

The answer on 2.24 rule 1 also stands in for the ruling of 2026-11-16 that the first text of
ADR-0218 cited and no comment recorded.

**2. An event counts its place's region in full only where the catalogue knows where it was held
on the trip's date** (2.22 rule 6, [20:47Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960562896): "confirmed with a condition"). ADR-0219
decision 5 has the Gion Matsuri count Kyoto in full, as a place visited there does. That holds
where the catalogue knows the event was held there. An event can move: Maslenitsa at Bakshevo is
held in Moscow Oblast as a rule, and may one day move to the next oblast. So the region counted is
the event's place at the trip's date, read from its periods (ADR-0217). Where the trip has no date,
or the event's place on that date is not known, the product asks where it was, as it asks for a
place on a border (ADR-0219 decision 5).

ADR-0219 decision 9 said its read of a region's visited state "takes no date". For an event's tick
it now reads the date of the trip under the visit.

**3. An area with a shape of its own is visited by walking it as well as through one of its parts;
a serial object is visited only through one of its parts** (2.22 rule 7, [20:49Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960598905):
"confirmed with a distinction ADR-0218's shapes already draw"). Museum Island is an area, the
island and its ensemble, and not only five museums: walking the island is a visit to it, as is
entering one museum, and the count of its museums seen ("1 of 5") stands beside the tick. The
Struve Arc, a serial object with no shape of its own, is visited only through one of its parts.
Both kinds exist. ADR-0219 decision 9's rule that an area visited only through a part or a place
inside it reads as visited stands, and ADR-0218 decision 2 already tells the two kinds apart (an
extended object is ticked for itself; a serial object is shown by its parts).

**4. A region drawn by hand is placed on the canon regions its outline lies on, and a tick on it
paints upward from them** (2.22 rule 3, [20:43Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960453638), vetoed; the reading confirmed with
rule 4, [20:44Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960487795)). ADR-0219 decision 3's rule that a region drawn by hand with no
division "paints only itself" does not hold. In the maintainer's words, the result must reflect the
truth for a traveller: whoever was at Lake Baikal was in Irkutsk Oblast or in Buryatia. A tick
counts on the canon; a region of a world view that is part of the canon sits in the hierarchy above
it, and a tick on it paints the regions above.

- Such a region is placed on the canon regions its outline lies on (overlaps, not holds whole). Its drawing is read for that;
  ADR-0219 decision 4's "its drawing is not read" and "it covers nothing and nothing covers it" no
  longer hold for it.
- Lying on one canon region, a tick on it paints that region and the regions above it.
- Lying on more than one, the tick is on their common region until the traveller says which side,
  as ADR-0219 decision 5 has it for a place listed in several counted regions: Lake Baikal, ticked,
  paints the common region of Irkutsk Oblast and Buryatia lighter and asks which of the two.
- In its own view the tick still paints the region and the regions above it, as ADR-0219 decision 3
  has it.

What ADR-0219 decision 6 says of a change to such a region (a redrawing marks its ticks and asks;
when it goes, its tick moves to its parent as a lighter tick that asks) is not touched by the
answer, and stands.

**5. A tick paints a larger region only where the ground the traveller was on lies inside it, and
no share of area stands in for that** (2.22 rule 5, [20:46Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960539677), vetoed). ADR-0219
decision 4's tolerance of 95 % by area goes. Where a tick does not say which part of a larger
region the traveller was in, the product asks. In the maintainer's words:

- a traveller who was in Greenland has not thereby ticked Denmark, let alone Europe;
- Russia may be ticked as a whole, but that answers neither Europe nor Asia, since it lies in both,
  so the part is always asked;
- Spain at 98.5 % in Europe is no exception: a tick "somewhere in Spain" does not paint Europe until
  the part is known, since Ceuta and the Canaries are in Africa.

So in ADR-0219 decision 4, the covering region is the smallest region of the view whose bricks hold
all of the ticked region's bricks, and two regions hold the same bricks when each holds all of the
other's. Where no region of a view holds all of it, that view paints nothing for the tick, and the
product asks which part the traveller was in. The cases decision 4 was checked on read so: a whole
Turkey paints neither Europe's nor Asia's Turkey in the Administrative view and asks which, where
decision 4 painted Asia's; a whole Spain paints nothing there and asks, where decision 4 painted
Europe's Spain as "somewhere in". Decisions 6 and 7 of ADR-0219 read decision 4's comparison, so a
tick moved when a view is replaced, and a curator's placement read in another view, follow it too.

**6. A place is visited only while it stands** (2.23 rule 4, [20:54Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960731638), vetoed). The date
offered on a tick of a place that no longer stands does not merely file the visit under a trip: a
place can be visited only while it exists, as the maintainer said before. A trip to Nelson's Pillar
(destroyed on 8 March 1966) dated 1970 is not accepted as it stands; the product says the pillar no
longer stood then and asks the traveller to correct the date or the place.

- A trip's approximate date (ADR-0202) is read as ADR-0217 decision 6 reads a date that does not
  settle the question: a trip of 1966, with no month, is accepted for Nelson's Pillar. That reading
  is the session's.
- A tick with no date still counts, as ADR-0217 decisions 7 and 8 have it: a tick on Nelson's
  Pillar can only be a visit before its end.
- ADR-0219's table of what it leaves said, in the #2008 row, that this date "files the visit under
  a trip, and is no condition of counting". It is now also held to the place's standing.

**7. A world view is not made visible to travellers until every region in it has the geometry it
needs** (2.22 rule 2, [20:22Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6959922282), new). The rule of ADR-0219 decision 3 that a region
with neither bricks nor an outline cannot be ticked would otherwise leave a public view with
regions a traveller sees and cannot tick: the Wikivoyage view, public on the development database,
has 4,000 such regions of 4,301. #2631 builds it.

**8. A movable event's dates are computed from its rule where the rule can be computed, as a
feature of its own** (2.23 rule 3, [20:52Z](https://github.com/uncovering-world/track-your-regions/issues/2619#issuecomment-6960680439), new). The maintainer asks that rules be
computed where they can be (an offset from Easter, Maslenitsa, a lunar calendar) and the dates shown
for any year. #2633 builds it. Until it does, ADR-0217 decision 9 stands as written: Holy Week in
Seville reads "March or April" and no more.

**Not answered by the maintainer's answers, and not decided here.** Each is the maintainer's to
decide before the slice it names builds the rule:

- *Which regions stand for the canon until #587 builds it* (decision 4). ADR-0219 decision 3's
  counting layer is each view's leaves "until a canon marks its own"; decision 4 places a region
  drawn by hand on canon regions, which no view marks yet.
- *What a curator's placement on a region drawn by hand lists in other views* (ADR-0219 decision 7,
  built by #2580). Decision 7 lists such a record "in that view only", stated "as decision 3"; the
  veto of 2.22 rule 3 names the tick and not the placement.
- *Whether ADR-0219 decision 4 keeps any allowance for measurement* (decision 5). The maintainer
  confirmed on 2026-11-17 (#2579) that a tolerance stays on every brick, because "different levels
  of simplified geometry may cause trouble, so an exact match must not be required": a division
  and the divisions under it differ by up to 0.5 % of area in the Administrative view. The veto of
  2.22 rule 5 removes "tolerance by area (ADR-0219's 95 %)"; whether a measuring error of that size
  still counts as "all" is not said. The same question stands for decision 4's read of a hand-drawn
  outline: a simplified shoreline of Lake Baikal straying into a third oblast would put the region on
  three canon regions, and every tick on it would ask.
- *Whether a view's own tree is read as ground* (decision 5). ADR-0219 decision 3 paints a ticked
  region "and what is above it" in the view it was ticked in. The answer has a whole Russia answer
  neither Europe nor Asia, and Greenland not paint Denmark or Europe; it does not say whether that
  holds in a view whose own tree sets the whole of Russia under Europe, or Greenland under Denmark.
- *Whether decision 6 reaches a date before the place's beginning or inside a gap.* The answer
  names a date after the end. "A place can be visited only while it exists" also reads on a trip
  of 1965 to the Sydney Opera House and on one of 1980 to the Cathedral of Christ the Saviour,
  which ADR-0217 decision 8 counts as the session's reading (its cathedral bullet, #2619 line 1.8).
- *What an event's tick paints while the question of decision 2 is unanswered.* The answer says
  the product asks, and not what is painted meanwhile.
- *Whether ADR-0218 decision 2's direct tick on a serial object, read "? of N", stands beside
  decision 3*: a visit "only through one of its parts" may be read as a visit to a part not yet
  named, which is what "? of N" says, or as no direct tick at all.

ADR-0219's other rules marked as the design's and not among line 2.22's (a satisfied lighter tick,
the one refusal of decision 6), ADR-0217's readings marked as the session's and not among line
2.23's, and ADR-0218's not among line 2.24's keep their marks: the maintainer was not asked about
them in these lines.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A region drawn by hand with no division paints only itself (ADR-0219 decision 3, the design's) | Vetoed on 2026-11-17: the result must reflect the truth for a traveller, and whoever was at Lake Baikal was in Irkutsk Oblast or in Buryatia. A tick on such a region that paints no canon region says nothing of where the traveller was. |
| A tolerance of 95 % by area (ADR-0219 decision 4, the design's value) | Vetoed on 2026-11-17: a share of area is not the ground a traveller stood on. Spain at 98.5 % in Europe would paint Europe for a traveller who saw Tenerife alone, and a country that lies in two continents answers neither. |
| The date offered on a tick of a place that no longer stands files the visit and decides nothing (ADR-0217 decision 7, the session's reading) | Vetoed on 2026-11-17: a place can be visited only while it exists, so a trip to Nelson's Pillar dated 1970 is a mistake the product names, not a trip it files. |
| Paint the region of an event's usual place whatever the trip's date | An event can move (Maslenitsa at Bakshevo); the region counted is where it was held on the date. |
| Amend ADR-0217, ADR-0218 and ADR-0219 in place | They are Accepted, and only their Status and Built by may change. |
| Supersede ADR-0219 | Its nine decisions stand but for the sentences named above; superseding it would retire the rules a visit is built on. |
| One narrowing ADR per narrowed ADR | The answers were given together, on one line of #2619 each, and decisions 2, 5 and 6 here reach two of the three ADRs at once. |

## Consequences

**Positive:**

- Every rule of lines 2.22 to 2.24 is the maintainer's, confirmed or replaced, and the slices that
  build them read one answer each.
- A tick claims no region the traveller may not have been in: no Europe for "somewhere in Spain",
  no Denmark for Greenland, no region for an event held elsewhere that year, no visit to a pillar
  that had fallen.
- A region drawn by hand counts on the canon like any other, so a traveller who ticks Lake Baikal
  gains Russia and is asked the side, instead of a tick that paints one view only.

**Negative / Trade-offs:**

- More ticks ask. Every whole country of the 22 the base layer divides between continents (Spain,
  the United States, Portugal, Turkey and Kazakhstan among them), ticked whole in a view that
  keeps it whole, paints nothing in the Administrative view until the traveller says which part.
- A view that lacks one brick of a region (the import's Mali without Bamako, 0.02 %) paints nothing
  for a tick on that region until the brick is matched.
- A region drawn by hand needs its outline read against the canon's regions, as geometry: the read
  ADR-0219 decision 4 avoided for every other region comes back for this one kind.
- An event's region depends on the trip's date, so the visited state of a region reads a date for
  an event's tick, and an undated tick on an event asks.
- A trip's date is checked against the place's standing periods on every write of a trip, so a
  place's periods must be read where a trip is saved.
- Seven questions stay open (above) until the maintainer answers them.

## References

- Related ADRs: ADR-0219 (decisions 3, 4, 5 and 9 narrowed here), ADR-0217 (decision 7 narrowed
  here), ADR-0218 (three rules confirmed, none narrowed), ADR-0202 (a visit's trips), ADR-0150
  (narrowed by ADR-0218 decision 14, confirmed here)
- Answers: #2619, the comments of 2026-11-17 from 20:20Z to 21:00Z, each linked in its decision
- Issues: #2619 (lines 2.22, 2.23, 2.24), #2631, #2633, #2579, #2580, #1169, #2594, #587, #2135,
  #1676, #2008, #2009

# ADR-0179: Archaeology's sites admit by the frame, and its surroundings tier asks the map for a ruin

**Date:** 2026-11-02
**Status:** Accepted

---

## Context

Six place kinds admit by one frame since
[ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md): three quantiles of the kind's
own pool (ADR-0176's pool), a stay at 0.8, the surroundings tier (ADR-0171's regional tier) with the
register's parameters, and ADR-0172's crowding. Archaeology was not one of them. Its sites entered
by doors of their own:

- a line of 22 Wikipedia editions, 18 to stay (ADR-0058 decisions 4 and 5);
- a readership door at the median of the held sites (ADR-0127), with a lower bar for a site a guide
  uses (ADR-0163);
- two visit witnesses for a site that door alone admitted (ADR-0128 decision 2);
- a read of the sites under the pool's floor the world reads (ADR-0152).

No measurement or product call stood behind keeping them apart (#2286). ADR-0175 decision 4 says a
kind that enters later takes the shared levels and is measured on its own canon list first.

Archaeology's sites were measured that way on 2026-11-02. The report is
[2026-11-02 — Archaeology's sites in the admission frame](../research/2026-11-02-archaeologys-sites-in-the-admission-frame.md).

- **The bars.** The pool holds 12,603 sites. The shared levels give 34 Wikipedia editions, 150,543
  readers a year, and 25,421 readers with a guide's mark.
- **The bare frame fails the noise limit.** It holds 2,844 sites against 1,259 today and keeps the
  canon (0.885), but 10.2 % of its additions are noise. Nearly all of it is in the surroundings
  tier: finds spots with nothing to see (Diepkloof Rock Shelter, Lapa do Santo), tells, places gone
  or under water (the Maikop kurgan, Mureybet), and parts of a site already held (the Forum of
  Pompeii).
- **The gone rule (#2259) names none of it.** None of those items carries an end date or a state of
  conservation.

Archaeology's museums are not part of this. They are admitted works-first, through the finds they
hold (ADR-0058 decision 2), as art museums are.

## Decision

This applies ADR-0175 decisions 1 to 4 and 6 to Archaeology's sites, and narrows ADR-0175
decision 3 for Archaeology. It supersedes ADR-0127, ADR-0152 and ADR-0163, narrows ADR-0128
decisions 2 to 4, ADR-0058 decisions 4 and 5, and ADR-0172 decision 2. What a site is stays the
kind's rule.

**1. What a site is stays Archaeology's rule.**
- The classes, the kills, the types and the classifiers that decide whether an item is an
  archaeological site are unchanged (ADR-0058 decision 4, `archaeology/siteTest.ts`).
- OpenStreetMap still judges what the classes cannot. The map's entrance still names a dig no class
  reaches (ADR-0060), and English Wikipedia's category still casts the second vote.
- The rule no longer reads a line. Whether a refusal is named is the frame's: it names a row the
  kind holds or the world reads, as for the six kinds (`namesRefusal`).

**2. Whether a site is famous enough is the frame's.**
- The world tier admits a site at the shared quantile levels over Archaeology's own site pool:
  every item of its site classes with a point and at least three sitelinks that the rule passes.
- A held site stays at 0.8 of any bar. What a run cannot read is ADR-0175 decision 6's.
- The museums are not in the pool, and the frame does not admit them.
- The site door's own admission is retired: its line, its readership door and the guide's lower bar
  there, its witnesses, and its read under the pool's floor.

**3. The surroundings tier (ADR-0171's regional tier) reads Archaeology's sites with the register's
parameters, and two conditions of the kind's own.**
- **The map shows the place.** A site in the surroundings tier needs an OpenStreetMap object that
  carries its item and that the site rule reads as the place: a ruin or a dig, or the village the
  rule lifts a dig over.
- **A part of a place the kind holds is not a place of its own.** A site that is part (`P361`) of a
  place Archaeology holds or admits in the same run is refused there. The Forum of Pompeii is
  Pompeii's visit.
- **Both conditions hold for the surroundings tier alone.** Applied to the world tier, the first
  would cost Palenque, Calakmul, Coba and El Tajín, and the second Giza, Karnak and Stonehenge.
  Each of those is part of a larger whole on Wikidata.
- **The candidates are the regional pool's items of the site classes.** The map's entrance
  (ADR-0060) stays the world tier's: opened to the surroundings tier, it brought 81 places in a
  dry run of 2026-11-02 that the measurement never read, about a fifth of them bridges, dams,
  tunnels, museums and a memorial park mapped as ruins.
- Both conditions are declared in the register with their derivation, evidence and date
  (`ARCHAEOLOGY_REGIONAL_REGISTER` in `places/admissionRegister.ts`), as the guide a tunnel, a dam
  or a lock needs is.

**4. A crowded city counts Archaeology's sites, and never its museums.**
- Archaeology takes ADR-0172's rule: ten per type within 10 km. Its runs' after-step then fills
  `membership_fame`, which a site run that cannot read a signal admits by.
- **The museums are exempt.** A museum enters for what it is and for the finds it holds. A place
  that holds a work a reader is shown is never crowded out (ADR-0173). On 2026-11-02, 62 of the 126
  museums the kind held showed no find yet, among them the Bardo, the Gold Museum and the Grand
  Egyptian Museum. Ranked by their own articles, they would compete for seats they are not admitted
  by.
- A kind names the types it exempts (`experience_kinds.crowding_exempt_types`). An exempt type is
  never scored, never crowded out and takes none of the ten. The coverage report demands every
  survey entry filed under one.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep Archaeology's own doors | No measurement stood behind them. Their line sat at a tail of the kind's pool chosen once (ADR-0058), against the frame's derived levels. |
| The bare frame | 10.2 % noise among the additions, over the maintainer's limit of 7 %. |
| The two conditions on both tiers | They cost canon: Giza, Karnak, Stonehenge by the parts condition; Palenque and Calakmul by the map's. |
| Any OpenStreetMap object instead of a ruin on the map | 4.0 % noise against 3.5 %, and 230 more places for the same canon and demand. |
| The gone rule (#2259) as the filter | It names none of the noise. |
| Readers' and editions' bars of Archaeology's own levels | ADR-0175 decision 4: a level per kind bought little and cost noise. The shared levels keep the canon here. |
| Crowding the museums with the sites | Half of them hold no find the catalogue shows yet, and a museum is not admitted by its article's fame. |

## Consequences

**Positive:**

| | Today | The point |
|---|---|---|
| Sites held (world, surroundings) | 1,259 | 2,062 (1,169, 893) |
| Canon (`calibration/archaeology.jsonl`) | 0.876 | 0.876 |
| Survey demand shown, development regions (of 143) | 64 | 72 |
| Noise among the additions | | 3.5 % (6.2 % counting parts of held sites) |
| Control regions (Bangkok, Lisbon, Cape Town) | 3 shown | 4 shown in the measurement, none lost; 3 as a run admits them |

- One frame for every place kind. A number of it moves only by ADR-0175 decision 5's method.
- The site door asks no readership door, no witnesses and no read under the floor: three
  mechanisms and their tests are deleted.

**Negative / Trade-offs:**
- **About 900 arrivals reach the review queue** (913 in the measurement), all gated.
- **The control's gain is the measurement's alone.** Wat Ratchaburana in Ayutthaya is a wat to
  Wikidata and a dig to the map; the measurement asked it by id as a survey's entry, and a run,
  whose surroundings tier reads the site classes alone, does not reach it. It is under the world
  bars, where the map's entrance does read it.
- **Five sites held today are lost.** The Aqua Claudia and Phnom Kulen fall under the bars.
  Dzibilchaltun, Gemiler Island and Preah Ko have no OpenStreetMap object carrying their item,
  which is a gap in the map's tagging, not proof there is nothing to see. A mapper linking the
  object brings them back.
- **The surroundings tier depends on the map's tagging.** 13 places a person graded worth a visit
  leave with the map test or the parts test (Sirkap, Leluh, Abbasid Samarra, the Forum of Pompeii).
- **The run reads the map of every candidate**, about 15,000 items of the pool against some 1,500
  before, since the bars are read over what the rule passes. On the OpenStreetMap layer that is one
  read. Through the mirror it is one question per hundred items.
- **The coverage report reads Archaeology's line as the lower of the two.** Its museums still enter
  by the source's line of 22 and its sites by the frame's 34, so a top is under the line only below
  22 (`SOURCE_LINE_KEPT` in `report.ts`).

## References

- Applies: ADR-0175 decisions 1 to 4 and 6. Narrows: ADR-0175 decision 3 (for Archaeology),
  ADR-0058 decisions 4 and 5, ADR-0128 decisions 2 to 4, ADR-0172 decision 2. Supersedes:
  ADR-0127, ADR-0152, ADR-0163.
- Related: ADR-0171 (the surroundings tier), ADR-0173 (a place holding works), ADR-0176 (the pool),
  ADR-0177 (fame), ADR-0060 (the map's entrance), ADR-0048 (the tiers).
- Research: [2026-11-02 — Archaeology's sites in the admission frame](../research/2026-11-02-archaeologys-sites-in-the-admission-frame.md)
- Issues: #2286, #2177; #881 (Archaeology's regional tier from the state antiquities registers and
  OpenStreetMap); #2259 (the gone rule).

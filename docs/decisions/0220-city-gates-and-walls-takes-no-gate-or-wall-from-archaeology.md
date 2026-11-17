# ADR-0220: City gates & walls takes no gate or wall from Archaeology, and the Porta Nigra is offered there

**Date:** 2026-11-17
**Status:** Accepted
**Issue:** [#1160](https://github.com/uncovering-world/track-your-regions/issues/1160),
[#1812](https://github.com/uncovering-world/track-your-regions/issues/1812)
**Built by:** #1160, #1812
**Narrows:**
[ADR-0131](0131-a-kind-is-drawn-by-what-a-place-was-made-for.md) decision 2 (the sentence on City
gates & walls: a gate or a wall standing whole is that kind's, "the Porta Nigra included", and
that this narrows the ruling of 2026-10-20 on #1160)

---

## Context

The maintainer ruled on 2026-10-20 (#1160) that a place's kind follows its present use, and that
remains of a past that has ended, kept only as a monument, are Archaeology: "the Theodosian
Walls, the Porta Nigra, the Hippodrome, the Babylon Fortress".

ADR-0131, accepted the next day, drew City gates & walls as a kind and wrote in decision 2: "A
gate or a wall standing whole, passed through or walked, is this kind, the Porta Nigra included".
It says of itself that it narrows the ruling of 2026-10-20 for gates and walls, with the reason
that the ruling, read literally, "would also take the Delhi Gate and Mutianyu and leave this kind
nearly empty".

City gates & walls is not built (#1812 is open). So the sentence has one effect today: it takes
the Porta Nigra out of the kind the maintainer named for it and puts it in none.

Read on the development catalogue on 2026-11-17, read-only:

- The Porta Nigra (Wikidata `Q152339`, articles in 49 Wikipedias) holds no record in any kind.
  Its one record is a part's record in its whole, the World Heritage site *Roman Monuments,
  Cathedral of St Peter and Church of Our Lady in Trier*.
- Archaeology offers what stands whole from antiquity, each admitted and verified by a curator:
  the Arch of Constantine, the Arch of Titus, the Aurelian Walls and Porta Maggiore in Rome, and
  in Trier itself the Roman amphitheatre and the Imperial Baths.

**How Archaeology admits them, read from the code.** A site enters the pool by one of two
entrances, and the rule that judges it is `siteVerdict` (`backend/src/services/sync/archaeology/siteTest.ts`):

- *The class.* The item carries a class in the tree under Wikidata's `archaeological site`
  (`SITE_ROOT` and `SITE_POOL_CLASSES` in `archaeology/siteClasses.ts`). The Aurelian Walls
  (`Q625149`) carry `city walls`, `defensive wall` and `archaeological site`. Porta Maggiore
  (`Q751318`) carries `city gate` and `archaeological site`. The Arch of Constantine (`Q5786`)
  carries `triumphal arch` and `archaeological site`. The amphitheatre of Trier carries `Roman
  amphitheatre`, a class under `archaeological site`.
- *The map.* Where no class of a site is on the item, an OpenStreetMap object names it a dig or
  ruins (`osmNamedVerdict`, ADR-0060), and a fortification named only as ruins is refused there
  (`osmOnlyVeto`).

The rule then refuses what the item is not (a shipwreck, a living town), and the place kinds'
frame asks whether it is known enough (ADR-0179, ADR-0185). It reads no date, and it does not
read whether the structure stands whole. OpenStreetMap maps the Aurelian Walls as
`historic=citywalls` with no ruin tag, and they are admitted on the class alone.

So Archaeology already holds a standing wall and a standing gate, by its own rule. The Porta
Nigra is outside it for another reason: its item carries `city gate` and nothing else, and
OpenStreetMap maps it as `historic=city_gate`. Neither entrance reaches it.

No line by date is available. The study of 2026-10-18 on #1160, made at the maintainer's request
before the ruling, found that "antiquity" is the Mediterranean's periodisation: an inception is
filled on 24 % of the items it read, and a kind by age would hold a few dozen places. The
catalogue's code already says the same of finds (`ANCIENT_CUTOFF_YEAR` in
`archaeology/classes.ts`: a date alone reads the Mediterranean as archaeology and the Americas,
Africa and the North as not). The maintainer's ruling of 2026-10-20 then drew the line by present
use and by no date.

The maintainer decided on 2026-11-17 (recorded on #1160 and #1812): the Porta Nigra is offered in
Archaeology, now. A traveller who opens Archaeology in Trier expects the city's chief Roman
monument beside the amphitheatre and the baths. Whether it is also offered in City gates & walls
is decided when that kind is built: a place may be in two kinds, and each kind admits by its own
rule, so no date cut is needed. ADR-0131's decision on gates is read with this: "a gate standing
whole goes to City gates & walls" does not take an ancient gate out of Archaeology.

## Decision

**1. ADR-0131 decision 2 takes no gate and no wall out of Archaeology** (the maintainer,
2026-11-17). Its sentence says what City gates & walls holds. It does not say what Archaeology
may not hold. The Aurelian Walls and Porta Maggiore stay where Archaeology's rule put them, and
neither is moved or refused when City gates & walls is built.

**2. The Porta Nigra is offered in Archaeology** (the maintainer, 2026-11-17), as the ruling of
2026-10-20 named it. The words "the Porta Nigra included" in ADR-0131 decision 2, and its
sentence that it narrows the ruling of 2026-10-20 for gates and walls, no longer stand.

**3. Each kind admits by its own rule, and a place may be in both** (the maintainer, 2026-11-17).
A place is in a kind through a membership (ADR-0084), and ADR-0131 decision 1 already offers a
place made for both of two kinds in both. Archaeology admits a gate or a wall as it admits any
site: by a class under `archaeological site` on its item, or by a dig or ruins named on the map,
and then by the frame. City gates & walls admits by the rule #1812 writes. Nothing in either rule
reads the other kind.

**4. No rule here reads a date.** ADR-0131's worry, that Archaeology would take the Delhi Gate
and the Great Wall at Mutianyu and leave City gates & walls nearly empty, does not arise: a
membership in Archaeology takes nothing from another kind.

**What this does not decide.**

- Whether the Porta Nigra is also offered in City gates & walls. That is #1812's, with that
  kind's rule.
- Which entrance of Archaeology's run should reach the Porta Nigra. No entrance does today.
  This is the design's note and not the maintainer's: until a rule reaches it, the way that
  exists is a curator's add of the kind on the place's card (`insertCuratorKindMembership`,
  `controllers/experience/kindAddController.ts`), as ADR-0185 decision 4 leaves Aksum a curator's
  to add.
- The other three places the ruling of 2026-10-20 names. The Theodosian Walls and the Babylon
  Fortress wait for the classifier of #1445, as #1160 records. The Hippodrome is recorded on
  #1160 as today a square (the maintainer, 2026-10-20).

**Accepted on 2026-11-17** (#2619 line 4.12): every decision here is the maintainer's, recorded on #1160 and #1812; no decision changes with the acceptance.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| City gates & walls only, as ADR-0131 decision 2 has it | The maintainer decided otherwise on 2026-11-17. The kind is not built, so the Porta Nigra would stay in no kind, and Roman Trier would be offered without its gate. Read as a rule, the sentence would also take the Aurelian Walls and Porta Maggiore out of Archaeology, where Wikidata's own class put them. |
| Archaeology only, and never City gates & walls | Not decided here. A place may be in two kinds, and #1812 decides with that kind's rule. |
| A date cut: a gate older than a given year is Archaeology's | "Antiquity" is the Mediterranean's periodisation (the study of 2026-10-18 on #1160), and the ruling of 2026-10-20 drew the line by present use. The maintainer's decision of 2026-11-17 needs none: each kind admits by its own rule. |
| A rule that tells a Roman gate from a Mughal one | It is the date cut by another name. No rule has to tell them apart once a place may be in both kinds. |

## Consequences

**Positive:**

- Archaeology in Trier reads as a traveller expects: the Porta Nigra beside the amphitheatre and
  the Imperial Baths.
- The Aurelian Walls, Porta Maggiore and the Arch of Constantine are in Archaeology by a rule
  that is written down, and no later kind removes them.
- The classifier of #1445 and the rule of #1812 are each written for one kind, and neither has to
  decide for the other.

**Negative / Trade-offs:**

- A gate may be listed in two kinds once City gates & walls exists, and it counts in each.
- The Porta Nigra enters by a curator's add until a rule reaches it. The maintainer decided on
  2026-11-17 (#2116) that nothing a curator decided on the development catalogue is carried to
  the fresh database, so the add is lost there unless a rule has been written by then.
- Wikidata's class decides who is in by the run: Porta Maggiore carries `archaeological site`
  and the Porta Nigra does not, though a traveller sees the same thing at both.

## References

- Related ADRs: ADR-0131 (decision 2, narrowed here), ADR-0058, ADR-0060, ADR-0084, ADR-0179,
  ADR-0185
- Related docs: `docs/tech/experiences.md`, `docs/tech/catalogue-coverage.md`
- Issues: #1160, #1812, #1445, #2116

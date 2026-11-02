# Archaeology's sites in the place kinds' admission frame

**Date:** 2026-11-02
**Issue:** #2286 (part of #2177)
**Decision:** [ADR-0179](../decisions/0179-archaeologys-sites-admit-by-the-frame-and-its-surroundings-tier-asks-the-map-for-a-ruin.md)

## Question

Archaeology admitted its sites by doors of its own: a line of 22 Wikipedia editions, a readership
door at the median of the held sites (ADR-0127), two visit witnesses for what that door alone
admitted (ADR-0128), a read under the pool's floor (ADR-0152) and a lower bar for a site a guide
uses (ADR-0163). The six place kinds have admitted by one frame since
[ADR-0175](../decisions/0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md): three quantiles
of the kind's own pool, a stay at 0.8, and the surroundings tier of ADR-0171 (its "regional
tier"). The question is whether Archaeology's sites can be admitted by the same frame, at the
shared levels (ADR-0175 decision 4), and what it costs as a traveller reads it.

Archaeology's museums are not in question. They are admitted works-first, through the finds they
hold (ADR-0058), as art museums are, and stay so.

## Method

The measurement follows ADR-0175 decision 5, on the development database of 2026-11-02.

- **The pool.** Every item of Archaeology's site classes with a point and at least three sitelinks
  of any Wikimedia site, that the site rule passes (`siteVerdict`, with the OpenStreetMap layer's
  objects): ADR-0176's pool. The museums are not in it.
- **The signals.** Wikipedia editions by the runs' counter, a year of readers (October 2025 to
  September 2026, the counter the world bars read with), the Wikivoyage editions that use the item,
  and the Atlas Obscura place ID.
- **The tiers.** The world tier at the shared quantiles, the stay at 0.8 for the sites the kind
  held, and the surroundings tier with the register's parameters over the pass's regional pool.
- **The reads.** Canon recall on `calibration/archaeology.jsonl` (113 entries); the survey demand of
  the sixteen development regions, read the way the map shows a city (#2246); the load; and the noise
  among the additions, graded by a person on three samples (two of 40 stratified by tier, one of 60
  uniform), as V (worth a visit), L (lesser, still a place) or N (noise), with a mark for a part of a
  site the kind holds.
- **The control.** Bangkok, Lisbon and Cape Town, read once, after the point was chosen.

The extracts and the scripts are on the development machine under
`data/cache/2177-admission/arch-2286-*` (the extract `arch-2286-extract.mts`, the statements
`arch-2286-v2-extract.mts`, the frame `arch-2286-frame.py`, the shapes `arch-2286-v2-variants.py`,
the control `arch-2286-v2-control.py`, the graded samples `arch-2286-*judgements-2026-11-02.tsv`).

## The bars

The pool holds 12,603 sites. At the shared quantiles its bars are:

| Bar | Value |
|---|---|
| Wikipedia editions (97th percentile) | 34 |
| Readers a year (98th percentile) | 150,543 |
| Readers with a guide's mark (90th percentile) | 25,421 |

With the map's refusals put back into the pool (the class rule alone) the bars would be 36, 161,669
and 25,513: the map moves them little.

## The bare frame

| | Today | Bare frame |
|---|---|---|
| Sites held (world, surroundings) | 1,259 | 2,844 (1,169, 1,675) |
| Canon | 0.876 | 0.885 |
| Survey demand shown, development regions (of 143) | 64 | 75 |
| Noise among the additions | | 10.2 % (14 of 139 graded) |

The bare frame keeps the canon and shows more of what the surveys demand, but its noise is over the
maintainer's limit of 7 %. Nearly all of it is in the surroundings tier:

- finds spots with nothing to see: Diepkloof Rock Shelter, Lapa do Santo, the Hardaway Site;
- tells: Sultantepe;
- places gone or under water: the Maikop kurgan, Mureybet, Alexandria on the Caucasus;
- parts of a site the kind already holds: the Forum of Pompeii, Agrigento's Temple of Olympian Zeus.

**The gone rule (#2259) names none of the noise.** None of those items carries an end date or a
state of conservation.

## The shapes

Each shape takes places out of the bare frame's set; nothing enters. Noise is the share of N among
the additions a shape keeps, per tier, weighted by its additions per tier; the strict figure also
counts a graded part of a held site as noise.

| Shape | Held (world, surroundings) | Canon | Demand shown | Noise | Strict |
|---|---|---|---|---|---|
| Bare frame | 2,844 (1,169, 1,675) | 0.885 | 75 | 10.2 % | 14.7 % |
| Parts of a held site out, both tiers | 2,691 (1,082, 1,609) | 0.805 | 72 | 10.7 % | 12.3 % |
| No map object out, both tiers | 2,181 (1,002, 1,179) | 0.841 | 72 | 3.8 % | 10.3 % |
| No ruin on the map out, both tiers | 1,800 (858, 942) | 0.779 | 65 | 3.2 % | 11.2 % |
| World tier only | 1,169 (1,169, 0) | 0.876 | 61 | 8.3 % | 8.3 % |
| Surroundings: parts out | 2,778 (1,169, 1,609) | 0.885 | 74 | 10.6 % | 12.2 % |
| Surroundings: a map object | 2,348 (1,169, 1,179) | 0.876 | 73 | 3.7 % | 10.1 % |
| Surroundings: a ruin on the map | 2,111 (1,169, 942) | 0.876 | 72 | 3.2 % | 10.9 % |
| Surroundings: parts out and a map object | 2,292 (1,169, 1,123) | 0.876 | 72 | 4.0 % | 6.2 % |
| **Surroundings: parts out and a ruin on the map** | **2,062 (1,169, 893)** | **0.876** | **72** | **3.5 %** | **6.2 %** |

**The same shapes applied to both tiers cost canon.** Parts out in both tiers takes out Giza,
Karnak, Stonehenge, the Valley of the Kings, Abu Simbel, Luxor Temple, Newgrange, the Terracotta
Army, Epidaurus' Sanctuary of Asclepius and Hatshepsut's temple, each part of a larger whole on
Wikidata. No map object in both tiers takes out Palenque, Calakmul, Coba and El Tajín.

"A ruin on the map" is the site rule's own reading of the map: an object carrying the item says
ruin or dig, or names the village a dig lies in that the rule lifts by its own classes (18 of the
893). "Part of a held site" is a `P361` statement naming a place the kind holds or admits in the
same run, its museums and the bare frame's sites among them.

## The point

The maintainer's rule of 2026-11-02 (canon at 85 % or more, noise at 7 % or less, and of those the
fewest places) picks the last row: the surroundings tier only, a site needing a ruin on the map, and
a part of a held site not being its own place. It is a shape for the surroundings tier alone, the way
ADR-0175 decision 3 asks a tunnel, a dam or a lock for a guide.

| | Today | Bare frame | The point |
|---|---|---|---|
| Sites held (world, surroundings) | 1,259 | 2,844 (1,169, 1,675) | 2,062 (1,169, 893) |
| Canon | 0.876 | 0.885 | 0.876 |
| Survey demand shown, development regions (of 143) | 64 | 75 | 72 |
| Noise among the additions | | 10.2 % | 3.5 % (6.2 % counting parts of held sites) |
| Arrivals | | 1,665 | 913 |

The graded additions the point takes out of the surroundings tier are 11 graded noise
(Diepkloof, Lapa do Santo, the Hardaway Site, the Maikop kurgan, Mureybet, Ipsos, Phasis, Kituwa,
the Adena Mound, Kengis, the Ardre image stones), 13 places worth a visit, among them the Forum of
Pompeii and Agrigento's Temple of Olympian Zeus (parts of held sites), Sirkap, Leluh, Abbasid Samarra
and the Prehistoric Cave Sites in Maros-Pangkep (no ruin on the map), and 36 lesser places. Four places the development
regions' surveys demand leave with them: Marbin Fortress in Isfahan, Sayhuite and the Intihuatana of
Urubamba in Cusco, and the Crypta Balbi in Rome.

## What the point drops of today's sites

113 of the 1,259 sites held today are not in the point. Read by name:

- **18 drop only in the measurement.** A real run replays the map's entrance and English
  Wikipedia's category vote, which the extract did not, and admits them: Jerash, the Shore Temple,
  Písac.
- **37 stay in the catalogue another way.** Vijayanagara stays through Hampi, KV63 through the
  Valley of the Kings, Altamira's serial site through the World Heritage site and the cave's own
  record.
- **53 are rightly out**: tells and finds spots with nothing to see, lost cities, cultures that are
  not places, and sites under a living city.
- **5 are real losses.** The Aqua Claudia and Phnom Kulen fall to the bars alone, so the bare frame
  drops them too. Dzibilchaltun, Gemiler Island and Preah Ko fall to the map test, because no
  OpenStreetMap object carries their item: a gap in the map's tagging, not proof there is nothing to
  see.

## The control

Bangkok, Lisbon and Cape Town, Archaeology's entries read once: the point shows 4 against 3 today,
and loses none. The one gain is Wat Ratchaburana in Ayutthaya, through the surroundings tier. Its
class on Wikidata is a wat, which no class of Archaeology holds; the map tags it as an
archaeological site. The extract asked it by id as a survey's entry, and a run does not reach it
(§ Limits, § The dry run).

## Limits

- **The extract asked some items by id** that no class question names: the held sites, the
  surveys' entries and the canon. A run reaches such an item only through the map's entrance or as a
  held row; five of the point's 893 surroundings sites are of that shape: Wat Ratchaburana, Umm
  el-Jimal, the Neolithic flint mines of Spiennes, Werwolf and the Gortyn code.
- **The map's tagging decides the surroundings tier's last step.** A site whose item no object
  carries is out of it until a mapper links one.
- **The readers' half of the bars moves with readership**, as every kind's does (ADR-0175 decision 1).

## The dry run

The branch's code, run read-only on the development database on 2026-11-02 (the place pass's
gather of Archaeology's sites from the local subset, the OpenStreetMap layer, the pass's regional
pool over every place kind's classes and the museum tree):

| | The point | The run |
|---|---|---|
| Pool, bars | 12,603; 34, 150,543, 25,421 | the same |
| World tier | 1,169 | 1,176 |
| Surroundings tier | 893 | 891 |
| Arrivals | 913 | 914 |

- **World, +7.** The run replays the map's entrance and English Wikipedia's category vote, which
  the extract did not (§ What the point drops of today's sites); 1,166 of the 1,176 are the point's.
- **Surroundings, −2.** 886 of the run's 891 are the point's. Seven of the point's are not the
  run's: the five the extract asked by id and no class question names (Wat Ratchaburana, Umm
  el-Jimal, the Neolithic flint mines of Spiennes, Werwolf and the Gortyn code), and Mende and
  Ayn Ghazal, which the run's regional pool does not measure. Five the extract never read come in:
  Fyrkat, Trelleborg, Nonnebakken, Caherconnell Stone Fort and the Eildon Hills.
- **The map's entrance kept to the world tier.** Opened to the surroundings tier too, the run
  admitted 975: Wat Ratchaburana and 81 places the measurement never read came in, about a fifth
  of them bridges, dams, tunnels, museums and a memorial park mapped as ruins (the Iron Gate Dam,
  the Bahia Honda Rail Bridge, the Green Island White Terror Memorial Park). The entrance stays the
  world tier's.
- **The named cases.** Wat Ratchaburana is not reached; the Forum of Pompeii is refused as part of
  Pompeii; Diepkloof Rock Shelter for want of a ruin on the map; Giza, the Cave of Altamira and
  Pompeii are in the world tier.

## How to rerun

On the development machine, from a checkout of the branch:

```bash
cd data/cache/2177-admission
npx tsx arch-2286-extract.mts <checkout> arch-2286-sites.jsonl
npx tsx arch-2286-v2-extract.mts <checkout> .
<venv python> arch-2286-frame.py
<venv python> arch-2286-v2-variants.py
<venv python> arch-2286-v2-control.py
```

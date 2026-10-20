# ADR-0128: A site enters through the readership door only where a travel guide lists it

**Date:** 2026-10-20
**Status:** Accepted

---

## Context

ADR-0127 opened Archaeology's world tier to a site below the sitelinks line that the world reads
at the median of the kind's held sites at the line. Dry run 178 on 2026-10-20 measured it: the
door opened for 105 places below the line and would have created 41, every one held for a
curator. Read as a traveller, those 41 were:

- 20 sites a visitor goes to: the Ancient theatre of Taormina, the Roman Baths, Karahan Tepe,
  Largo di Torre Argentina;
- 6 parts of a site the catalogue holds: the Lupanar, the Propylaea, Saint Peter's tomb,
  Hisarlik Hill;
- 9 places with nothing to see: Stapleton International Airport, the Darien scheme, Rungholt,
  the circus of Nero, Nyenschantz;
- 2 Roman predecessors of a living city: Camulodunum, Augusta Treverorum;
- 4 places of another kind: Jantar Mantar, the London Stone, Po Nagar, Fotheringhay Castle.

A year of reading says that people read about a place, not that they go there. Rungholt is read
because it drowned in 1362. The maintainer judged 16 non-places among 41 arrivals too much for a
curator, and asked for a rule before the door's first real run.

The measurement on #1756 compared the sources that might tell the groups apart. Counts are on the
41, by what a person judged them:

| Signal | Sites (20) | Nothing to see (9) | Predecessors (2) |
|---|---:|---:|---:|
| A Wikivoyage listing names the item, in any of 19 editions | 19 | 0 | 0 |
| 10 or more Commons files in its category photographed within 1 km | 14 | 0 | 0 |
| Wikidata: heritage, opening hours, visitors or website | 14 | 2 | 0 |
| Wikidata says it is gone: dissolved, demolished, a lost or destroyed class | 0 | 7 | 0 |

Wikidata's "gone" statements also mark ruins that stand: the Basilica Julia and the Basilica
Aemilia, among the 92 sites of #1718's set. Of the 510 Archaeology sites already admitted at 18–30
sitelinks, Wikivoyage lists 75%. The unlisted ones mix real sites (the Aqua Claudia, KV63,
Laetoli) with places a guide rightly leaves out (Sarkel under its reservoir, the Comitium).

## Decision

**1. The readership door opens for a place only where a Wikivoyage listing names its item.** A
listing is any `wikidata=` in an article (namespace 0) of any of the 28 Wikivoyage editions. That
covers a See, Do or marker template and the article's own banner, in whichever template the
edition writes. A travel guide's editors sending visitors to a place is the question the
curator's card asks of every door arrival: "Is it a place a visitor goes to see?" On the 41, the
condition keeps 19 of the 20 sites and none of the 11 places with nothing to see or predecessors.
The one site it costs is Kalambo, a remote prehistoric site in Zambia.

**2. The condition guards the door alone, never the sitelinks line.** A quarter of the sites the
line admits have no listing, the Aqua Claudia among them. The line's own judgement of a famous
site stands. The guide answers only the question the reading cannot: whether a place read as much
as the famous ones is somewhere people go.

**3. The listings are read from the editions' dumps, every edition of one date, and swapped in
whole.** `wikivoyage-listings` is a keeping build of the dumps pipeline (ADR-0101, ADR-0106) into
the workbench tier (ADR-0124). It keeps the item, the edition and the article title, and no text
of a listing: Wikivoyage's text is CC BY-SA, and an item naming a place is a fact. An edition
whose run has not finished its articles fails the build, as an edition's tables fail the
redirects build, so a partial guide never stands in for a full one.

**4. Without listings in place the place door is shut,** as it is without a year folded with the
redirects (ADR-0127 decision 4), and the run says so. A place the year reads over the bar that no
guide lists stays out and is named among the run's refusals (`no-guide`), with its reading and the
bar, unless the line keeps it on its own.

**Narrows:** ADR-0127 decision 1. A site below the line whose readership reaches the bar stands
in only where a guide lists it. ADR-0127's other decisions hold.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Leave the curator's gate as the only guard (ADR-0127 decision 4) | 16 of 41 arrivals were not places. The curator reads two non-places for every three sites |
| Refuse what Wikidata says is gone | It refuses the Basilica Julia and the Basilica Aemilia, whose ruins stand. It is a hint for a curator, not a rule |
| Require OpenStreetMap's dig or ruin tag | Measured on dry run 178: it drops seven real sites (Karahan Tepe, Epang Palace, the Tower of Jericho) and keeps Stapleton, the Darien scheme and Rungholt, which mappers tag as digs or ruins |
| Count Commons photographs taken on site | It separates as cleanly but keeps 14 of the 20 sites, not 19 |
| Let Jev refuse what it reads as nothing to see | ADR-0087 keeps Jev's answer a suggestion a curator applies. On the 41 it was also weaker: it read Fadak and Ye as sites |
| Read Wikivoyage through its API, as the source record of 2026-09-06 looked at | Every edition's every article is a bulk read, which is the dumps' (#1312) |

## Consequences

**Positive:**
- A curator reads 26 door arrivals instead of 41 on dry run 178's pool, 7 of them not a site
  instead of 16.
- The door's arrivals are places a traveller can be sent to, which is what the world tier promises.

**Negative / Trade-offs:**
- A real site no guide lists stays out of the world tier: Kalambo. The regional tier (#881) is
  where it can enter.
- Wikivoyage's coverage depends on which editor last walked a city. A listing added later lets the
  place in on the next run after the next build.
- One more build to keep current: 28 dumps of about 400 MB together, rebuilt as Wikivoyage's twice
  monthly runs land.

## References

- Related ADRs: ADR-0127 (decision 1 narrowed), ADR-0056, ADR-0087, ADR-0101, ADR-0106, ADR-0124
- Related docs: `docs/tech/experiences.md` § Archaeology, `docs/tech/dumps.md` § Wikivoyage's
  listings, `docs/sources/global/wikivoyage-see-listings.md`
- PR / issue: #1768, #1756, #1160

# ADR-0056: A work the world reads opens a second door to the world tier

**Date:** 2026-09-11
**Status:** Draft

---

## Context

The art-museum kind's world tier has one door. A museum is admitted for holding a work with
articles in 22 Wikipedia language editions or more, and the same line awards the Iconic badge
(ADR-0023 decisions 1 and 2; ADR-0048 decision 2 keeps it as the world tier's rule). Sitelinks
count how many editions wrote an article, not how many people read one. Tarsila do Amaral's
*Abaporu*, Brazil's best-known painting, has 9 sitelinks and 158,290 views a year. Matejko's
*Stańczyk* has 21 sitelinks and 448,962, and the *Veiled Christ* in Naples has 18 and 269,348. A threshold on the number of editions also favours the large languages that
translations flow through (Ronen et al., *PNAS*, 2014).

#807 measured what a second door would add, over September 2025 to August 2026, on the museum
import's own placement, with the numbers of ADR-0055. In every variant the bar is the median of
the same measure over the world tier's 399 works with views, and the exit is the 35th percentile.
"Halves agree" is the Jaccard index between the lists for September–February and March–August.
Visitors are Wikidata's visitors per year (P1174) for 2015–2025 without 2020 and 2021, as a median
over the added museums that have one. AUC is the chance that a world-tier work outscores a work of
10 to 21 sitelinks.

| Measure | Museums added | Visitors (museums with data) | Halves agree | With the exit | AUC |
|---|---:|---:|---:|---:|---:|
| **Views in every language** | **16** | **295,072 (6)** | **0.61** | **0.78** | **0.913** |
| Every language, trimmed monthly mean | 16 | 295,072 (6) | 0.72 | 0.83 | 0.916 |
| Every language, days capped at five medians | 14 | 295,072 (6) | 0.69 | 0.88 | 0.915 |
| Views in every language except English | 11 | 295,072 (6) | 0.82 | 0.91 | 0.919 |
| Except English, effective languages at least the tier's lowest quarter (5.9) | 3 | 501,290 (2) | 1.00 | 1.00 | 0.919 |
| Except English, effective languages at least the tier's lowest tenth (4.5) | 4 | 501,290 (2) | 0.60 | 0.60 | 0.919 |
| Except English, effective languages at least 2 | 10 | 295,072 (6) | 0.80 | 0.90 | 0.919 |
| Except English, trimmed monthly mean | 12 | 252,514 (7) | 0.69 | 0.85 | 0.921 |
| Except English, days capped at five medians | 11 | 295,072 (6) | 0.77 | 0.92 | 0.920 |
| Pantheon's index with its age term | 9 | 212,893 (3) | 0.12 | 0.50 | 0.900 |

For comparison, the world tier's museums draw a median of 404,150 visitors (26 museums with
data), and the other art museums 61,780 (240).

**What the door adds.** Sixteen museums, ten in Europe, three in North America, two in Asia and
one in South America, each for the work named beside it and its year of views: the Musée Fabre in
Montpellier (Cabanel's *The Fallen Angel*, 754,606), the National Museum in Warsaw (*Stańczyk*,
448,962), the Norman Rockwell Museum (*The Problem We All Live With*, 340,304), the Israel Museum
(Duchamp's *L.H.O.O.Q.*, 296,530), the Cappella Sansevero in Naples (the *Veiled Christ*,
269,348), Tate Liverpool (Picasso's *The Weeping Woman*, 211,456), Kelvingrove in Glasgow (Dalí's
*Christ of Saint John of the Cross*, 192,336), the Sanssouci Picture Gallery (Caravaggio's *The
Incredulity of Saint Thomas*, 174,948), the Kunsthaus Zürich (Mondrian's *Composition with Red,
Blue and Yellow*, 165,095), MALBA in Buenos Aires (*Abaporu*, 158,290), the Pera Museum in
Istanbul (Osman Hamdi Bey's *The Tortoise Trainer*, 153,854), the Autry Museum of the American
West (*American Progress*, 152,176), the Galleria d'Arte Moderna in Milan (Pellizza da Volpedo's
*The Fourth Estate*, 145,946), the Art Mill Museum in Doha (Courbet's *Le Désespéré*, 143,533),
Santa Maria Novella in Florence (Masaccio's *Holy Trinity*, 137,162) and the Harry Ransom Center
(Kahlo's *Self-Portrait with Thorn Necklace and Hummingbird*, 134,312). Wikivoyage lists 7 of the
9 of them that stand in its 40 test cities. The Albertina, which the door without English admits
on Dürer's *Young Hare*, is not among them; it enters the regional tier instead, where the same
work is read 6.4 times the German median (ADR-0057).

**What the corrections did.** The breadth and Pantheon variants below were measured on the reading
without English; the burst corrections were re-measured on the adopted door. The effective number
of languages, Pantheon's breadth term,
removes *Stańczyk* (about 4 languages) and the *Veiled Christ* (4.4) first, and at two languages it
removes only *Abaporu* (1.8), the kind of work the door exists for. Pantheon's full index raises
Leonardo's lost *Leda and the Swan* at Fontainebleau, and it brings in four museums at once through
impressions of Dürer's engraving *Knight, Death and the Devil*, an edition that ADR-0023 decision 4
admits at every holder. Two of the sixteen carry a burst flag, the Pera Museum and the Art Mill
Museum. Both stay above the bar when the year is trimmed to its middle ten months, and both fall
below it when every day is capped at five times the median — which is why the burst is a flag, and
why the level itself sits under *Left to the adoption slice* below. One holds a work younger than seventy
years, Rockwell's *The Problem We All Live With* of 1965, which is what Pantheon's age term
warns about.

**What the same measure says about the line itself.** The tenth of the world tier that is read
least gets under 38,761 views a year, and its floor is startling: *Norra skenet* with 27 sitelinks
and 1,516 views, *Grön eld* with 26 and 2,739, the *Madonna of Kyiv* with 36 and 8,935.

**What a lower door lets in first.** Placement errors that the 22-sitelink line hides rise with
any second door: Arcimboldo's *Vertumnus* credited to Versailles over Skokloster Castle,
Cattelan's *America* credited to the Guggenheim after its theft in 2019, and the lost *Leda*
(#868).

## Decision

**1. A work below 22 sitelinks whose readership reaches the world tier's median is Iconic, and
admits its holder.** Its readership is its user views over twelve months in every counted
edition, English included (ADR-0055). The door reads the pool ADR-0055 measured and nothing
wider: the works the import places, plus every work of 4 to 9 sitelinks that carries a location
or collection statement. The bar is the median of the same
measure over the works at 22 sitelinks or more, and a work this door admits never enters that
bar. A work that reaches it is Iconic and admits its
holder exactly as a work at the sitelinks line does, and ADR-0023 decision 4's rule on holders
applies unchanged.

**2. It leaves below the 35th percentile.** The door has an entry and an exit, as the sitelinks
line has 22 and 18 (ADR-0023 decision 2), so a museum does not flicker with one year's reading.

**3. The bar is a percentile of the world tier, never a number.** This year the median is 133,366
views and the 35th percentile 88,364. The numbers move with the data; the rule does not.

**4. The level is the plain annual sum, and the adoption slice may change it** (see *Left to the
adoption slice* below). A burst is a flag a curator sees (ADR-0055 decision 4), not a correction. Breadth of readership, age and
variation over time are not terms of the rule.

**5. The door opens only after the import stops admitting through works that cannot be seen.**
Works Wikidata records as stolen and not recovered, or as lost, are the first thing a second door
lets in (#868). The door is not switched on before that issue closes. A work that exists and stands
where Wikidata says, but is rarely on view, is not that issue's: Wikidata does not record display,
so a curator flags it on the admission, on either door. A place a visitor cannot enter at all is
the same case: `venueVerdict` (`backend/src/services/sync/museum/venueTest.ts`) refuses a venue
for being shut only when Wikidata records it dissolved (`P576`), so a museum closed for
refurbishment passes and the curator is the guard. So every admission through this door passes
the curator's gate (ADR-0025) with its flags shown, as ADR-0057 decision 5 says of its own door.
That gate is the source's, and only an admin sets it: the Art Museums source publishes unread
today (`requires_curation = false` in `db/init/01-schema.sql`), so adopting either door means
turning its gate on before the first run that opens the door, and every arrival of that run then
waits for a person, as a place of worship's does (ADR-0052). What the curator reads on this door
is one flag the run raises — a burst over every language (ADR-0055 decision 4) — and the two
checks above that no run can make: a museum shut to visitors, a work rarely on view. The other
door's home-language and country flags have no referent here, since this door names no country.
The clearest case sits on the other one:
Dürer's *Young Hare*, which ADR-0057 admits at the Albertina, is a light-sensitive watercolour the
museum shows only for short periods.

**6. Readership removes no badge.** The world-tier works read least are a list for a curator, not
a rule.

**Narrows, once accepted:** ADR-0023 decision 1 (a museum is admitted "for no other reason": a
second reason is added) and decision 2 (one threshold serves both halves: the second door awards
the badge too, with its own entry and exit). ADR-0048 decision 2 holds: the door reads a signal
comparable across the world, with a threshold stated once for the whole world.

**Settled in review (2026-09-12):** the maintainer chose every language, English included — 16
museums — taking the reach of the door over the steadiness of its list. Leaving English out is
recorded as the alternative below.

**Left to the adoption slice, #628:** the level. The sixteen above are the plain annual sum. On the
same door a trimmed monthly mean admits the same sixteen and agrees better between the halves of
the year, 0.72 against 0.61; capping every day at five times the median admits fourteen, dropping
the Pera Museum and the Art Mill Museum, at 0.69 and 0.88 under the exit rule. Decision 4 keeps the
plain sum because that is what the numbers here were measured on, and the choice moves admissions,
so the slice makes it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Every language except English | A steadier list — the halves of the year agree at 0.82 against 0.61, and AUC is 0.919 against 0.913 — but only 11 museums — ten of these sixteen, plus the Albertina, which English pushes below the bar. It leaves out the Norman Rockwell Museum, the Autry Museum, the Harry Ransom Center, Tate Liverpool, Kelvingrove and the Kunsthaus Zürich, whose works the world reads in English, and it follows attendance less closely (0.37 against 0.43). The maintainer chose reach over steadiness on 2026-09-12 |
| The issue's sum of per-million shares over every edition | Small editions decide the top: the *Spoliarium* through Tagalog, the *Hand of Irulegi* through Basque, *Goddess on the Throne* through Albanian; below the line it tracks the sitelink count (ρ 0.36) |
| A breadth gate on the effective number of languages | Keeps 3 museums at the tier's lowest quarter and 4 at its lowest tenth; at two languages it removes only MALBA |
| Pantheon's index with its age term, ln L + ln L* + log₄ A + ln v_NE − ln CV | 9 museums, halves agree at 0.12, AUC 0.900, attendance ρ 0.28; it raises the lost *Leda* |
| Pantheon's index without the age term | 2 museums, halves agree at 0.50 (first pass over the same year): it contains the sitelink count it was meant to complement |
| A trimmed monthly mean, days capped at five medians, or the median month times twelve, as the level | On the adopted door the trimmed mean keeps the same 16 museums at 0.72 and capping keeps 14 at 0.69, dropping the Pera Museum and the Art Mill Museum. On the reading without English the three gave 12, 11 and 13 museums at 0.69, 0.77 and 0.75. The flag keeps what they correct for; the level itself is listed under *Left to the adoption slice* |
| A bar at the 40th or the 60th percentile | 21 museums with halves agreeing at 0.64, or 8 at 0.80 (first pass over the same year); the median gives a short list that holds |
| A lower sitelinks line | ADR-0048's rejected alternative: it reaches what Wikipedia writes about, and the 39 least-read world-tier works show the line already admits works almost nobody reads |
| The museum's own article, its sitelinks or its views | Not works-first (ADR-0023's rejected institutional renown). Its sitelinks correlate with attendance at 0.73, against at most 0.43 for a work-based measure; recorded as evidence for display order and ties, not for admission |

## Consequences

**Positive:**
- Sixteen art museums join the world tier on this year's numbers, each for a work a visitor can be
  told about, and three of them are the first the door reaches in North America.
- The door answers the sitelinks line's bias toward large languages with one measure, one bar
  and one exit, and without a composite index.
- The added museums draw attendance close to the world tier's (median 295,072 against 404,150).

**Negative / Trade-offs:**
- It is the least steady of the language and level variants: the lists for the two halves of the
  year agree at 0.61, and 0.78 with the exit rule, against 0.82 and 0.91 without English. Only the
  breadth gate at the tier's lowest tenth (0.60) and Pantheon's index (0.12) fall lower in the
  table, and they admit four museums and nine. Membership
  will move from year to year more than the sitelinks line does, and the exit at the 35th
  percentile is what keeps it from flickering.
- English reading follows the media more than other languages do (Lemmerich et al., 2019), so a
  meme can carry a work for a year. The burst flag is the only guard, and it is a flag, not a
  filter.
- The Albertina leaves the door when English is counted, because Dürer's *Young Hare* is read
  widely in English too; it enters the regional tier on the same work.
- A year's reading follows events. Works read mainly in Persian read low in 2025–26 while Iran was
  offline; the exit at the 35th percentile absorbs one bad year, not two.
- Four of the sixteen carry a question the curator must answer. The Art Mill Museum in Doha has not opened,
  and Wikidata's only 2025 location for *Le Désespéré* is the Musée d'Orsay's website item.
  Tate Liverpool closed in October 2023 for a refurbishment and is due to reopen in 2027, so a
  visitor sent there today finds a building site — the "closed to visitors" flag of ADR-0057
  decision 5, since the import refuses a venue for being shut only when Wikidata records it
  dissolved; Wikidata puts *The Weeping Woman* in Tate's collection and at Tate Modern as well,
  and only its location statement names Liverpool.
  Wikidata's one item for Duchamp's *L.H.O.O.Q.* is located at both the Israel Museum and the
  Centre Pompidou and names a private collection, so which version the Israel Museum shows needs
  checking. Santa Maria Novella is already a place of worship in the catalogue and meets this
  membership on the place (ADR-0046, ADR-0045 decision 4).
- *Abaporu* has 9 sitelinks and *American Progress* 8, below the import's own pool of 10
  (`POOL_MIN_SITELINKS`, `backend/src/services/sync/museum/queries.ts`, a constant no ADR
  sets). The measurement read them from the wider pool of ADR-0055 decision 1; for the door to
  run inside the import, that constant must go to 4.
- The door is only as sound as placement, and until #868 closes it would admit what cannot
  be seen.
- Adopting the door turns the Art Museums source's gate on (decision 5), and that gate holds the
  source's whole output, not the door's admissions: `treasureWriter.ts` reads the same
  `requires_curation`, so every work a run writes waits with its museum (ADR-0025 decision 2).
  The first gated run's queue is that run's arrivals, works included, on top of the sixteen below.
- A curator's queue of sixteen museums, each with its work and its flags.

## References

- Related ADRs: ADR-0023, ADR-0025, ADR-0045, ADR-0046, ADR-0048, ADR-0052, ADR-0055, ADR-0057
- Related docs: `docs/tech/filling-a-kind.md` § 7.4
- Literature: Yu et al., "Pantheon 1.0", *Scientific Data* 2016, doi:10.1038/sdata.2015.75;
  Ronen et al., "Links that speak", *PNAS* 2014, doi:10.1073/pnas.1410931111;
  Lemmerich et al., "Why the World Reads Wikipedia", *WSDM* 2019, doi:10.1145/3289600.3291021
- Issues: #807, #868

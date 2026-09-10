# ADR-0054: A work's readership cuts a regional tier in its unit's languages, and fills none

**Date:** 2026-09-10
**Status:** Accepted

---

## Context

A kind is filled in two tiers (ADR-0048): a world tier drawn by one global signal, and a regional
tier that completes the kind with what a region holds that a traveller standing there would
visit. Art Museums has only the first — the works-first line of ADR-0023, a museum admitted for
holding a work at 22 Wikipedia-language sitelinks. ADR-0048 decision 3 and
`docs/tech/filling-a-kind.md` § 7.4 name local-language Wikipedia readership as the candidate
*within-unit signal* for the regional tier's cut, and #807 asked for it to be measured on the
works pool before anything is adopted: which museums it would open, per continent, on the six
cities of the canon, with a proposed rule, a cost model, and no admission or sync change.

The issue proposed a shape: for every work, sum its share of readers over every Wikipedia it has
an article in — that edition's views of the work divided by the edition's own views, in parts per
million — and admit a museum holding a work above the median of the same sum over the Iconic
works. It also proposed the work's *reader language* as the edition with the highest share.

**What was measured** (the development catalogue and Wikidata on 2026-09-10; the full numbers,
the queries and the endpoints are in `docs/tech/filling-a-kind.md` § 7.4 and § 8):

- **The pool** is every artwork of the import's seven roots with a current location or collection
  statement — 7,423 works at 4–9 sitelinks, 1,863 at 10–21, 433 at 22 or more — held at 3,944
  venues, of which the catalogue holds 260. Below four sitelinks the same pattern is 1,555,160
  works, which is where the pool stops. It holds 1,374 of the catalogue's 1,411 treasures; the
  other 37, 17 of them Iconic, belong to classes the imports add by hand — painting series,
  polyptychs, altarpieces, reliquaries — which a query over the seven roots does not return.
- **What is read is the works, never the museums.** Readership is twelve months of views
  (September 2025 to August 2026) of the works' own articles — 70,820 article pairs on the 84
  editions above 15 million views a year, each article's year summed with the year of every title
  redirecting into it (40,128 redirects); a museum scores as the best work it holds. The numbers
  come from Wikimedia's monthly `pageview_complete` dumps, filtered to user agents: the English
  edition totals 81.08 billion views there and 81.08 billion through the analytics API, and on
  4,260 titles measured both ways the two agree within 5 % on 4,256 of them.
- **Two readings** were computed for every work: the issue's sum over every edition, and the
  work's share in the official languages of the country it is held in.

**What it showed.**

*The ranking is sound; the reader-language rule is not.* The issue's sum orders the works at 22
sitelinks or more — 433 of them, 336 the catalogue's own treasures — as a guidebook would: the
Mona Lisa, the Statue of Liberty, *The Last Supper*, *The Starry Night*, *Girl with a Pearl
Earring*, *Guernica*, Christ the Redeemer, Michelangelo's *David*, the Rosetta Stone, the
*Vitruvian Man*. But the edition with the highest share is whichever small edition carries the
article: the Mona Lisa's is Wu Chinese, 8,265 views and 422 per million, against English's
1,980,358 views and 24 per million.

*The sum is partly a count of small Wikipedias.* Below the 22-sitelink line its correlation with
the sitelink count is +0.36, against +0.58 for raw views. The share in the unit's own languages
correlates at +0.19 — the least like the world line of any reading measured, and so the one that
adds most to it.

*The two readings answer different questions, and the issue's own examples split between them.*
Tarsila do Amaral's *Abaporu* at MALBA in Buenos Aires scores 63.2 on the sum and 0.9 in
Argentina's Spanish, because it is read in Portuguese (133,572 views): a public elsewhere reads
it, which is #808's Pilgrimage badge, not Argentina's regional tier. Osman Hamdi Bey's *The
Tortoise Trainer* in Istanbul (78.0 and 73.7, Turkish), the Myazedi inscription at Bagan (389.2
both, Burmese) and *Kartlis Deda* in Tbilisi (175.6 and 168.4, Georgian) are read where they
stand. Juan Luna's *Spoliarium* in Manila scores 1.4 in its country's languages only because
Filipino (Q33298) carries no Wikipedia language code in Wikidata; Tagalog readers read it at 231
per million.

*A work's readership reaches the museums whose works are famous, and not the museums whose fame
is the institution.* Of the eight places § 7.6 names as what a regional tier must reach, the
measure reaches two, and both through a famous local work: the Art Museum of Georgia through the
Khakhuli triptych (44.4 per million in Georgian), and the Niguliste Museum in Tallinn through
Bernt Notke's *Danse Macabre* (6 sitelinks, 33.6 per million in Estonian). Wikidata gives 909
artworks the Musée Zadkine as their location or collection and 5,943 the Berlinische Galerie, and
the best of them has one and three sitelinks; it gives none to Manggha in Kraków or to the
Georgian Museum of Fine Arts, and one to the Larco Museum in Lima. The Museo Stibbert's one pool
work has no readers above the floors. Those museums are regional precisely because no single work
of theirs is famous, so a signal read off works cannot see them.

*This is the reading of a museum through its works.* The reading of a museum's own article —
Kumu's 1,889 Estonian views and the Niguliste Museum's 406, measured per unit on 2026-09-04
(`filling-a-kind.md` § 7.4) — is a different within-unit signal. It is not measured here and not
withdrawn by this ADR, and it is the one that can reach a museum whose fame is the institution.

*Three traps would have produced a plausible wrong answer*, and the method keeps their guards:
a sitelink can lead to an article about something else (the German article on Michelangelo's
*Last Judgment* redirects to the article on Michelangelo, five Dürer self-portraits to one
survey article — 142 pairs); one article is recorded in the dumps under three spellings (raw,
percent-encoded and `%uXXXX`); and QLever returns zero rows, not an error, when a sitelink count
is compared without `xsd:integer`.

## Decision

**1. Readership is a signal for a regional tier's cut, never a source of its rows.** It cuts an
enumeration a source has already made for a unit — a national register, a city's list, Wikidata
by class within the unit — and it enumerates nothing. It is not used to find the museums of a
unit, and a unit whose museums hold no famous works is filled from its sources or by a curator.
This restates ADR-0048 decision 3 and `filling-a-kind.md` § 7.4 with the measurement that shows
why: two of the canon's eight places are reachable from works.

**2. It is read in the unit's own languages and cut within the unit.** A work's regional
readership is its share in the official languages of the country it is held in; a museum scores
as its best work, as ADR-0023 admits a museum; the cut keeps what sits close enough to the unit's
best, with a floor on the size of the group, and rolls up to a wider unit or to a curator's list
when the group is too small. No global bar is adopted, on either reading. A bar at the median of
the sum over the works at 22 sitelinks or more (17.7 per million; 17.1 over the catalogue's
measured Iconic treasures alone) is a world rank read lower, which ADR-0048 decision 3 rules out,
and below the line it tracks the sitelink count at +0.36. A bar at the same median of the regional
share is out of reach wherever a unit reads English: no museum in North America clears it at any
view floor measured, because the English edition's own year is 81 billion views.
**This ADR binds the model, not the numbers**: the floors, the distance and the group size
measured on 2026-09-10 are recorded in `filling-a-kind.md` § 7.4, and the adoption slice of #628
sets them.

**3. The measure is a share of one year of user views of the work's own articles.** An edition
counts for a work when it clears three gates: its own traffic (15 million views a year), its views
per article (50 a year, which removes the machine-written Egyptian Arabic, Waray and Cebuano
editions and no other), and the work's own views in it. An article's views include every title
that redirects into it. A sitelink whose target is not about the work, or has no target, is *no
article* — never zero, the ADR-0023 rule — and a work with no article on any eligible edition is
*unmeasurable*, never last. The pool the adoption reads includes the classes the imports pin by
hand, which this measurement's query over the seven roots left out.

**4. A work's reader language is the edition with the highest share among those holding at
least a tenth of its views.** The highest share alone names the smallest edition that carries
the article. Under this rule the Mona Lisa's is English, the Statue of Liberty's French,
*Guernica*'s Spanish and *Hip, Hip, Hurrah!*'s Danish, though it hangs in Gothenburg. The field is
#808's input; the regional tier does not need it.

**5. The numbers come from the pageview dumps, not the per-article API.** Wikimedia allows an
anonymous client ten requests a minute and three concurrent connections; one pass is some
111,000 per-article calls, almost eight days at that rate. Twelve monthly dumps are 61.8 GB, read
as a stream in about four hours, and they carry every redirect title by construction. A monthly
refresh is one new file.

**6. Nothing is adopted here.** No admission, no sync, no schema, and the Iconic badge and the
22-sitelink line of ADR-0023 are untouched.

**Extended by this ADR:** ADR-0023 (a museum scores as the best work it holds, now for the
regional tier's cut as well as the world line) and ADR-0048 decision 3 (the within-unit signal it
names, measured through works and given its shape). **No decision of any earlier ADR is
narrowed.** The issue named ADR-0045; the decisions this touches are ADR-0048's, which already
narrow ADR-0045 §2 and §3.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| The issue's sum over every edition, cut at the median of the works at 22 sitelinks or more, worldwide | A world rank read lower (ADR-0048 decision 3); below the line it tracks the sitelink count at +0.36 |
| A global bar on the regional share | No museum in North America clears it at any view floor measured: the English edition's own year is 81 billion views |
| The highest single share as the reader language | Names the smallest edition carrying the article — Wu Chinese for the Mona Lisa |
| Readership of works as the source that finds a unit's regional museums | Reaches two of the canon's eight places; the best of the Musée Zadkine's 909 works has one sitelink |
| Raw view counts instead of shares | Tracks the sitelink count at +0.58 below the line; a large edition's readers drown every local public |
| The per-article REST API | Ten requests a minute for an anonymous client; the pass is almost eight days and needs a registered token or a breach of the policy |
| No corpus gate, the traffic floor alone | Egyptian Arabic (42 views per article a year) passes any traffic floor and carries more pool articles than German |

## Consequences

**Positive:**
- #628's adoption slice has a measured within-unit signal and knows what it cannot do: rank the
  museums a register or a curator enumerates, not find them.
- The share in a unit's languages is the reading least like the world line (+0.19), so a
  regional tier cut by it is not the world tier with a lower threshold.
- Cut within the unit it is stable: at a view floor of 2,000 the museums it keeps move from 378
  to 509 as the cut widens from one decade to two, where the sum's move from 146 to 621.
- #808 gets a reader-language rule that names a public rather than an edition size.
- The route is inside Wikimedia's published limits and reproducible from the queries in
  `filling-a-kind.md` § 8.

**Negative / Trade-offs:**
- The regional reading depends on a region's languages, which is #809's; until it lands a
  country's official languages stand in, and they are wrong for the Philippines (Filipino has no
  Wikipedia code) and blunt for multilingual countries.
- The readership of works measures what Wikipedia writes about works. It cannot promote a museum
  whose works have no articles, however good — the Larco Museum's collection is one Wikidata item;
  the reading of the museum's own article can, and it is outside this measurement.
- Where Wikidata locates few works the cut has almost nothing to act on: the regional reading
  keeps no African museum in any in-unit cut measured, and Lima holds two pool venues. Those units
  are filled from their sources or by a curator.
- A venue is resolved from Wikidata's location and collection statements, which carry history
  without end dates — Botticelli's *Primavera* still "stands" in the Palazzo Medici Riccardi, and
  the *Gypsy Girl* mosaic in the Gaziantep Museum of Archaeology it left for the Zeugma Mosaic
  Museum in 2011 — and rooms that are not institutions. The measurement approximated the import's
  venue resolution; the adoption uses the import's own.
- The measurement's pool missed 37 of the catalogue's treasures — the Shrine of the Three Kings,
  Strasbourg's astronomical clock among them — whose classes the imports pin by hand; the numbers
  above are without them.
- Four hours and 62 GB a year of reading, where the world tier reads a few hundred queries.

## References

- Related ADRs: ADR-0023, ADR-0030, ADR-0045, ADR-0046, ADR-0048, ADR-0052
- Related docs: `docs/tech/filling-a-kind.md` § 7.4, § 8, § 9;
  `docs/sources/global/wikidata-by-class-per-unit.md`
- Wikimedia policies read: `https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits`,
  `https://www.mediawiki.org/wiki/API:Etiquette`, `https://dumps.wikimedia.org/other/pageview_complete/readme.html`
- Issues: #807 (this measurement), #628 (the regional tier of art museums), #808 (Pilgrimage),
  #809 (a region's languages), #861 and #862 (the regional tiers of public art and places of worship)

# ADR-0057: A work read at home as much as a world masterpiece admits its museum to a regional tier that has no native source

**Date:** 2026-09-11
**Status:** Draft

---

## Context

ADR-0048 decision 3 fills a regional tier from a source native to its unit: an enumeration, then
a cut within the unit, never a world rank. A global source read per unit is admitted only where no
native source exists or can be read, per unit, under three conditions measured before adoption
(`docs/tech/filling-a-kind.md` § 4): coverage of the unit's canon, the share of rows with a known
identity, and a floor on the group for the cut. No regional source is adopted for art museums yet
(#628). On 10 September 2026 the development catalogue showed 4 art museums in Asia and none in
South America or Africa.

A first reading for #807, never merged, concluded that readership "cuts a regional tier and fills
none". It read a work's share per million of an edition in the country's official languages, cut
within the country. That reading failed in two ways. A cut relative to the country's best work
removed nothing where the best work is read less than about 30 per million — in the United
States, the United Kingdom, France, Germany, Italy, Japan and Mexico. And a global bar in shares
per million was out of reach wherever a unit reads English, whose edition's year is 81 billion
views. The full-year recalculation measured a different reading.

**Local fame.** A work's views over twelve months in an official language of the country that holds
it, divided by the median views, in the same language, of the world tier's works that have an
article there. The bar adjusts itself to each edition. The median is 48,983 views in English,
9,074 in Italian, 9,041 in French, 7,797 in German, 7,584 in Spanish, 5,406 in Japanese, 3,187 in
Polish, 3,004 in Chinese, 2,415 in Portuguese, 1,376 in Turkish, 492 in Arabic and 366 in Georgian.
A country's languages are its official languages read through Wikidata (P37, then each language's
Wikipedia code, P424), with known traps corrected — the United States reads English, not Spanish —
until #809 gives a region its own list.

**What it would admit.** The candidates are the 768 art museums outside the world tier and outside
ADR-0056's door. Wikivoyage's "See" sections in 40 test cities are the check on precision; for the
world tier itself they list 58 %, the ceiling of the check.

| Variant | Museums | Wikivoyage lists, of those in the 40 cities | Halves agree | In English-speaking countries |
|---|---:|---:|---:|---:|
| Local fame at least 1 | 171 | 40 % of 40 | 0.79 | 14 |
| **Local fame at least 1, with the country check** | **168** | **40 % of 40** | **0.79** | **14** |
| Local fame at least 1, trimmed monthly mean | 169 | 40 % of 40 | 0.79 | 14 |
| Local fame at least 1, only works read mainly at home | 162 | 41 % of 37 | 0.77 | 14 |
| Local fame at least 0.5 | 270 | 36 % of 59 | 0.81 | 34 |
| All candidates | 768 | 28 % of 113 | | |

The 168 stand in 47 countries: 122 in Europe, 24 in Asia, 10 in North America, 8 in South
America, 3 in Africa and 1 in Oceania. Among them are the Ópusztaszer National Historical Memorial
Park with Feszty's panorama (36.0 times its language's median), the Ipiranga Museum with *Independence
or Death* (17.8), the National Museum of Fine Arts in Rio de Janeiro with Brocos's *The Redemption
of Ham* (13.2), the Art Museum of Georgia with the Khakhuli triptych (8.4), the Bihar Museum with
the Didarganj Yakshi (8.2), the Afrasiab Museum in Samarkand (7.8), the Diego Rivera Mural Museum in
Mexico City (2.5), the National Museum of Fine Arts in Manila with the *Spoliarium* (2.4), Lima's
National Museum of Archaeology, Anthropology and History with the Raimondi Stele (2.0) and the
Bardo Museum with the Virgil Mosaic (1.1). In Florence it adds the Palazzo Medici Riccardi, the
Brancacci Chapel, the Museum of San Marco and the Museo dell'Opera di Santa Croce.

**A language is not a country everywhere.** Over the year, Wikimedia's reader-country data shows
Portuguese Wikipedia read 93 % in Brazil, Italian 98 % in Italy and Japanese 99 % in Japan, but
Spanish only 44 % in Spain, 22 % in Mexico and 14 % in Argentina (Aragón and Sáez-Trumper, 2021).
Requiring the home country to supply half of a work's readers dropped the Albertina, the Academy of
Fine Arts Vienna and the Kunstmuseum Basel. Comparing the country's share of the work's readers
with its share of the edition's readers instead could be checked for 10 of the 171 museums. Seven
passed, among them the Diego Rivera Mural Museum in Mexico City and the National Museum of Fine
Arts in Manila. Three did not: the Bührle collection and the Petit Palais in Geneva, both closed,
and the National Museum of Visual Arts in Montevideo. Eleven of the 168 stand in countries the
data does not publish (ADR-0055), and 21 more in countries where the check applies but the data
has no rows for the work, such as the Sorolla Museum in Madrid and the National Palace in Mexico
City. For the other 129 the language is concentrated at home, and there is nothing to check.

**What it cannot reach.** Museums whose fame is the building or the institution, and whose works
are barely read: the Frida Kahlo Museum, the National Museum of Fine Arts in Buenos Aires, the
Burrell Collection, mumok. Nor the canon places with no famous work at all
(`docs/tech/filling-a-kind.md` § 7.6): the musée Zadkine, the Berlinische Galerie, Manggha, the
Larco Museum, the Georgian Museum of Fine Arts. In English-speaking countries the whole world reads
the English article, so a local museum rarely clears the English bar: the 168 hold 8 places in the
United States, 3 in India, and one each in the United Kingdom, Australia and the Philippines.

**What the list exposes.** Read museum by museum, the list holds works that cannot be seen and
works credited to where they do not hang. Van Gogh's *Poppy Flowers*, stolen from the Mohamed
Mahmoud Khalil Museum in Cairo in 2010 and never found, is Egypt's only entry. Leonardo's lost
*Leda* admits Fontainebleau. Pukirev's *Unequal Marriage* is credited to the Belarusian National
Arts Museum in Minsk, while the Russian article that supplies its readers describes the canvas in
the Tretyakov Gallery. Ruisdael's *The Windmill at Wijk bij Duurstede* admits the Amsterdam Museum
beside the Rijksmuseum, where it hangs. The first two are #868; the other two are placement
questions for the import. Dürer's *Knight, Death and the Devil* also admits every museum that holds
an impression, which is ADR-0023 decision 4 working as decided for editions, not a defect.

## Decision

**1. Local fame is a within-unit signal read in the unit's own languages.** A work's local fame is
its user views over twelve months in an official language of the country that holds it
(ADR-0055), divided by the median of the same views over the world tier's works that have an
article in that language. The world tier's works here are the works at 22 sitelinks or more, 399
of them with views this year, and never the works ADR-0056's door admits: a bar that moved with
its own admissions would chase itself. A language needs at least 20 such works to carry a bar, and a work
needs at least 500 views in a language for that language to count. In the 41 editions whose bar
is under 500 views, the floor rather than the ratio sets the bar: a Georgian work needs 1.37 times
its language's median, an Arabic one 1.02. Where a country has several
official languages, a work's local fame is the highest ratio among the languages that carry a bar
and pass the check of decision 4; a work with no such language has no local fame. A museum scores
as the best work it holds. Local fame compares a work with the world's masterpieces in its
readers' own language, not with the world's readers, so it is not a world rank read lower.

**2. In a country with no adopted native source, a work at local fame 1 or more admits its holder
to the art-museum kind's regional tier.** This is ADR-0048 decision 3's fallback, read per country.
The enumeration is ADR-0055's pool — the works the museum
import places, plus every work of 4 to 9 sitelinks that carries a location or collection statement
— local fame is the cut, and ADR-0023 decision 4's rule on holders applies. Below four sitelinks
the pool stops by design: the same classes hold 1,555,160 works there, which is a different
measurement. The coverage of the country's canon is measured before the
fallback is adopted for it, as § 4 asks, and the source register records the country and the date.

**3. Local fame never makes a country's regional tier complete.** It fills what famous works reach.
When a native source is adopted for the country, that source is the enumeration. Local fame may
stay as its cut where the source has no cut of its own, and a museum that local fame admitted and
the native source does not list goes to a curator.

**4. Where a country supplies less than half of a language's readers, the work must be read in that
country at least in that country's share of the edition.** The check reads Wikimedia's
reader-country data inside the period the country is published (ADR-0055 decision 5). The share
that decides whether the check runs at all comes from the same data, and it reads high: every
country that dataset does not show is missing from every edition's denominator. That is the
sixteen of Wikimedia's protection list, among them China, Iran, Vietnam and Myanmar, and Russia,
Belarus and Saudi Arabia after 25 January, plus whatever the name join loses — Turkey, Czechia,
and the Netherlands for most of the year (ADR-0055 names the set). A country whose true share is under half can therefore read over half, and
then it gets neither the check nor the flag. A work the
data cannot check — in an unpublished country, or with no rows of its own — stands on local fame
and carries the "unverified" flag.

**5. Every admission through this door passes the curator's gate (ADR-0025), with its flags
shown.** The gate is the source's and no run changes it, so an admin turns it on for Art Museums
before the first run that opens this door (ADR-0056 decision 5 asks the same). The run raises
three of the flags: a burst in the language that admitted the museum (ADR-0055
decision 4), a home-language article under 3 kilobytes, and an unverified country. Two more it
cannot raise, because Wikidata records neither whether a work is on display nor a closure that is
temporary, so the curator checks them unaided (ADR-0056 decision 5): whether the museum is shut to
visitors, and whether the work is rarely on view — Dürer's *Young Hare*, which this door admits at
the Albertina, is shown only for short periods. The door does not open before #868 closes.

**6. The bar is a ratio, never a quota.** No country gets a number of places. Italy's 25 admissions
and Tunisia's 2 are what the data holds.

**Narrows, once accepted:** ADR-0048 decision 3, for art museums: the fallback's cut is a bar set
per language, which needs no floor on the group, because it does not rank the unit's museums
against each other. Coverage and identity are still measured per country before adoption.

**Left to the adoption slice, #628** (the maintainer's instruction of 2026-09-12: record both
readings, choose neither now). The bar: 1 keeps 168 museums, 40 % of them named by Wikivoyage in
the 40 test cities, 14 of them in English-speaking countries; 0.5 keeps 270, 36 % named, 34 in
English-speaking countries. The 500-view floor of decision 1: without it six more museums pass,
among them Kumu in Tallinn through its best work, *Lennuk* (328 Estonian views of that work
against a bar of 230; the museum's own article is a different measure), and three museums in
Azerbaijan; the only one the floor keeps out as noise is a Belarusian reading of 65 views, and a
floor of 100 views admits the other five. And the level, as in ADR-0056: before the country check the
plain annual sum keeps 171 museums and a trimmed monthly mean 169, the two fewer being the
National Gallery of Slovenia with Grohar's *The Sower* and Skokloster Castle with Arcimboldo's
*The Librarian*; the check then takes the plain sum to the 168 above.

**Open in review:** whether local fame is only the fallback for a country without a native source,
as decided above, or a door that stays open beside a native source.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| The issue's global bar on the sum of per-million shares over every edition | A world rank read lower (ADR-0048 decision 3); small editions decide its top, such as the *Spoliarium* through Tagalog |
| A global bar on the share per million in the country's languages | On the 2026-09-10 reading, out of reach wherever a unit reads English, whose edition's year is 81 billion views: no museum in North America clears it |
| A cut within the country — a percentile, or "within N orders of magnitude of the country's best" | On the 2026-09-10 reading, removes nothing where the country's best work is read less than about 30 per million, and makes one work the bar for a whole country |
| The first five museums of each country | A quota: in the first pass, 5 of Italy's 127 candidates, and padding where a country holds one famous work |
| "Read at home": half of a work's views in the home languages, and at least 5,000 | In the first pass, 90 museums with 57 % listed, against local fame's 171 with 40 %; no English-speaking country can pass, and it keeps about half as many museums |
| Depth: three or more works at a tenth of the bar | In the first pass, 128 museums with 36 % listed; kept as a tie-break for display, not as a door |
| A z-score on log views | In the first pass, 153 museums, a subset of local fame's 171 with the same precision: a logarithm changes nothing at a median bar |
| Over-representation of the home language, at twice the edition's share | In the first pass, 239 museums with 35 % listed at half the bar; it adds nothing local fame lacks |
| Local fame without English | In the first pass it dropped 11 museums in English-speaking countries (14 to 3) and found none; precision rose from 40 % to 42 % only because the hard countries left the count |
| Only works read mainly at home (effective languages at most the world tier's lowest quarter) | Drops Bruegel's *Dull Gret*, Dürer's *Feast of the Rosary* and Bosch's *Last Judgment*, which are read too widely for the region and too little for the world door, so they are admitted nowhere |
| A trimmed monthly mean, or the median month (the first reading), as the level | 169 museums, and 160 in the first pass by the median month; either changes only museums at the bar, such as Grohar's *The Sower* in Ljubljana. The level itself is left to #628 here as it is for the world door |
| A bar of 0.5 | 270 museums with 36 % listed, and 34 places in English-speaking countries against 14; recorded beside the bar of 1 and left to #628 |
| The museum's own article (Kumu 1,889 Estonian views a year, the Niguliste Museum 406) | Not works-first, and not measured over the pool; it is the reading that can reach institution-famous museums, recorded for display order and for curators |
| Wikimedia's reader-country data as the signal | A year shows 2,203 of 9,967 works, and the countries a regional tier matters most for are unpublished or under its thresholds |

*The first pass* is the measurement over the same twelve months before automated traffic was set
aside and before the country check, when local fame at 1 kept 171 museums with 40 % listed by
Wikivoyage. *The 2026-09-10 reading* measured a work's share per million in the country's languages
instead of local fame. The other rows are this ADR's own measurement.

## Consequences

**Positive:**
- 168 museums in 47 countries on this year's numbers, 24 of them in Asia, 8 in South America and
  3 in Africa, where the catalogue shows 4, 0 and 0.
- Wikivoyage lists 40 % of those in its test cities, against 28 % of all candidates and 58 % of
  the world tier.
- The list barely moves with the season (the halves agree at 0.79) or with the counting details
  (the variants differ by a few museums at the bar).
- Every admission has a reason a visitor understands: a work its own country reads.

**Negative / Trade-offs:**
- The door needs the import's pool lowered from 10 sitelinks to 4, as ADR-0056's door does:
  *Abaporu* has 9 sitelinks and the Khakhuli triptych 6. If only one of the two doors is adopted,
  the pool change comes with it.
- It reaches only museums that hold a famous work. Institution-famous museums and most canon
  places need a native source or a curator.
- English-speaking countries get few places, 14 of 168; national registers and curators are their
  route, and six museums the world door now takes — four of them places local fame had reached in
  English — enter the world tier through ADR-0056 instead.
- The trigger of the country check is measured on a dataset that misses whole countries, so the 129
  whose language is "concentrated at home" is a ceiling rather than a count: the 62 % of English
  readers the United States shows is computed without China, Iran, Vietnam, Turkey, Czechia and
  Russia after January.
- A language stands in for a country. Belarus reads its fame in Russian, which Russia supplies.
  32 of the 168 carry the unverified flag — 11 in unpublished countries and 21 where the data has no
  rows for the work — against 7 that the check confirms.
- Placement errors surface as admissions (#868, and the import's rules on owners and
  locations); the curator's gate carries them until the import is fixed.
- Adopting the door turns the Art Museums source's gate on (decision 5), and that gate holds the
  source's whole output: `treasureWriter.ts` reads the same `requires_curation`, so every work a
  run writes waits with its museum (ADR-0025 decision 2). The first gated run's queue is that
  run's arrivals, works included, on top of the 168 below.
- A curator's queue of 168 museums, each with its work and its flags.

## References

- Related ADRs: ADR-0023, ADR-0025, ADR-0046, ADR-0048, ADR-0055, ADR-0056
- Related docs: `docs/tech/filling-a-kind.md` § 1, § 4, § 7.4, § 7.6;
  `docs/sources/global/wikidata-by-class-per-unit.md`
- Literature: Aragón and Sáez-Trumper, "A preliminary approach to knowledge integrity risk
  assessment in Wikipedia projects", 2021, arXiv:2106.15940; Hinnosaar et al., "Wikipedia
  matters", *Journal of Economics & Management Strategy* 2021, doi:10.1111/jems.12421
- Issues: #807, #628, #809, #868

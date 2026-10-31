# ADR-0171: A global source's regional tier measures a place against what lies within 50 km of it

**Date:** 2026-10-31
**Status:** Accepted

---

## Context

ADR-0048 decision 3 fills a kind's regional tier from a source native to its unit, cut within the
unit. It admits a global source read per unit only as a fallback, where no native source exists
or can be read. It names no unit for that case. A register's unit is its country and a guide's
is its city, but Wikidata has no unit of its own. Binding the tier to a world view's regions is
rejected, because a region with no source would stay empty.

The world line on Wikipedia editions (22 or more) admits most of what guides send a traveller to
in Rome and Berlin, and little of it in Dakar or Addis Ababa. Over the 21 coverage surveys it
admits 35 % of the places three sources other than Wikivoyage name outside Europe and Oceania,
against 79 % in Europe. Wikidata holds an item for nearly all of them. What differs is how much
is written about a place: a main mosque in Dakar has 10 editions, an ordinary church in Rome 25.

A percentile within the country (#761) carries Wikidata's density into the cut. Germany's pool is
359,162 items and Senegal's 82, so the same percentile admits 126–128 places in Berlin and 2–3 in
Dakar. It finds 10–11 % of the missing places outside Europe and Oceania.

A count per area is a quota, which the rules exclude (ADR-0023 decision 3; ADR-0057 decision 6).
The guides show why: Rome's k is 91 inside 35 km, Berlin's 36, Dakar's 9, Zanzibar's 4, and none
of that follows Wikidata's density.

The product calls were settled with the maintainer on 2026-10-30:
- The fallback is wanted.
- Missing a place guides name is worse than offering an unremarkable one.
- No second class: a place a signal can tell apart as unremarkable is not admitted at all, rather
  than admitted with a mark.

The measurement is `docs/research/2026-10-31-a-places-surroundings-as-the-regional-tiers-unit.md`.
It tested nine units, four signals, two reference levels, three coefficients and two kinds of
floor. Every result was checked on tops that Wikivoyage did not help to name, because Wikivoyage
is one of the sources a survey reads.

## Decision

This narrows ADR-0048 decision 3 for a global source read per unit. The rest of decision 3
stands: a native source comes first, the fallback is per unit, and it carries no badge.

**1. The unit is the place's own surroundings: everything within 50 km of it.**
- There is no grid, no country and no world-view region. Each place is measured against its own
  circle, so a place on any edge is compared with what surrounds it.
- The group is every place of the live kinds in that circle, whatever the kind. A kind's
  regional tier measures its places against the area's best of every kind, not only against its
  own.
- An H3 cell of resolution 4 with its ring, and a Wikivoyage region, measured the same. The
  radius needs no library and no extraction, and exists everywhere.

**2. The bar is a ratio to the area's reference, never a count.**
- The reference is the median of the 10 best places within 50 km by the signal. Where fewer than
  10 places there carry the signal, it is the median of those that do: Dakar's 8 places that
  Wikivoyage uses set its reference, and the floor below counts every place of the area.
- A place of a live kind under the world line enters the regional tier when it has a Wikipedia
  article in at least two languages, and either test passes:
  - **Wikivoyage:** the Wikivoyage editions that use it in a guide article reach **a quarter of
    the reference**, in an area of at least 5 places;
  - **editions:** its Wikipedia editions reach **the reference**, in an area of at least 25 places.
- Wikivoyage's use is read as `wikivoyage_usage` holds it, heritage-register lists left out
  (`docs/tech/dumps.md` § The items Wikivoyage uses).

**3. A floor counts the places of the area, not the places that carry the signal.**
- A floor keeps the fifth church of a group of five from being a top, and group size is what it
  measures.
- A floor on the places Wikivoyage uses closed Dakar, Zanzibar and Havana. There, Wikivoyage uses
  only the tops.

**4. The two-language requirement is how the rule keeps out what a traveller would skip.**
- A town's Wikivoyage article that lists every church makes a reference of 1. Any single listing
  clears that, so the 110 km circle around Tula admitted 71 places.
- With an article in two languages required, the Wikivoyage test admits 22 there (31 with the
  editions test), and outside Europe and Oceania it loses no top.
- This is the "no second class" call: a place the requirement can tell apart is not admitted.

**5. Readers in the country's languages are not the within-unit signal.**
- In every unit they ranked within two points of all readers, and below Wikivoyage's use.
- `docs/tech/filling-a-kind.md` § the exception names this rule instead.

**6. A kind adopts the rule through its own issue, calibrated on its own list.**
- This ADR changes no admission. A kind that takes the fallback measures the rule on its
  calibration list first (`docs/tech/catalogue-coverage.md`), as every line is calibrated per
  kind.
- The numbers here (50 km, the 10 best, a quarter, the whole median, 5 and 25 places, two
  languages) are where that calibration starts.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A percentile within the country (#761) | Carries Wikidata's density into the cut: 126–128 places in Berlin against 2–3 in Dakar, and 10–11 % of the missing places found outside Europe and Oceania, against 71 % here |
| A fixed number of places per area | A quota, which the rules exclude; the guides' own k varies tenfold and not with Wikidata's density |
| An H3 grid (resolution 4 with its ring) | Measured the same as the radius (75 % against 76 % at 500 places added). It needs a library and has cell edges, and the ring only repairs them. |
| Wikivoyage destinations as the unit | Measured no better than the radius at their best size (the region). The unit then depends on English Wikivoyage's geography and on an extraction of its articles. |
| A radius of 10 or 25 km | With Wikivoyage's use, 25 km is a point below 50 km and 10 km seven points below; with editions both are lower still |
| Each kind measured only against its own places | Won none of the comparisons at up to 500 places added, and a kind with few places in an area falls under the floor |
| Wikipedia editions or readers alone | Less precise at the same recall: 26–43 % of what they add is named by a guide, against 53–61 % with Wikivoyage's use |
| Wikivoyage's use alone, without the editions test | Misses the places Wikivoyage does not use where the editions are high: Havana's and Salvador's, and one each in Dakar, Addis Ababa and Samarkand |
| Two Wikivoyage editions required instead of two Wikipedia languages | Loses recall: 185 of 264 tops against 202 |
| A floor on the places that carry the signal | Admits nothing in Dakar, Zanzibar and Havana, where the few places Wikivoyage uses are the tops |
| Admitting the unremarkable with a mark | The maintainer's call of 2026-10-30: no second class |

## Consequences

**Positive:**
- **Outside Europe and Oceania** the regional tier and the world line together admit 209 of the
  264 places that three sources other than Wikivoyage name, against 93 for the world line.
  Across the 21 surveyed regions it is 366 of 430.
- **The places missing today:** it finds 145 of the 204 outside Europe and Oceania, 38 of 48 in
  Europe and 8 of 11 in Australia and New Zealand.
- **Volume:** it adds 743 places inside the 21 circles, and some guide names at least 52 % of
  them.
- **The rule exists everywhere:** a village near Tula has 50 km around it as surely as Rome
  has. It needs no canon (#786) and no world view.
- **Lalibela** gets the rest of its rock-hewn group beside Bete Giyorgis (11 more items in
  Wikidata), and Yemrehana Krestos and Na'akueto La'ab nearby, and nothing else.

**Negative / Trade-offs:**
- **Dense areas set high references.** Old Cairo's mosques and churches, each used by one
  Wikivoyage edition, stay out against a reference of 6.5 set by Giza and Saqqara within 50 km.
- **The two-language requirement drops places with no Wikipedia article in a second language.**
  Salvador's *largos*, the Temple of the Sun at Machu Picchu and Dakar's Place du Souvenir
  Africain are among them. A native source (#1337) or a curator's list fills them.
- **Thin Wikidata stays thin.** Saint-Louis has 9 places of the live kinds within 70 km, and
  where Wikidata holds little the rule offers little.
- **Wikivoyage's judgement becomes part of the tier.** Wikivoyage is open, and its guides list
  what travellers visit, but a region its editors have not written about gets the editions test
  alone.
- **A run must read every place within 50 km of each candidate.** That is a spatial query per
  place over the pool, which the local subset can answer.

## References

- Related ADRs: ADR-0048 (decision 3, narrowed here), ADR-0023 decision 3 and ADR-0057 decision 6
  (a bar is a ratio, never a quota), ADR-0126 (the two tiers weigh the same), ADR-0163 (a
  Wikivoyage guide's use as a door)
- Related docs: `docs/research/2026-10-31-a-places-surroundings-as-the-regional-tiers-unit.md`,
  `docs/tech/filling-a-kind.md` § the exception, `docs/tech/dumps.md` § The items Wikivoyage uses
- Issues: #2154; #761 (the country percentile, superseded by #2154); #1337 (native sources); #2146
  (places no class reaches); the kinds' regional tiers #628, #861, #862, #881, #1855, #1861, #1868

---
slug: pl-poland-travel
name: "Poland Travel"
publisher: "Polish Tourism Organisation (Polska Organizacja Turystyczna, POT)"
urls:
  home: https://www.poland.travel/en/
  dataset: none
  api: none
  terms: https://www.poland.travel/en/rules-regulations/
family: tourism-board
kinds: [places-of-worship, squares-and-streets, art-museums, history-museums, world-heritage, neighbourhoods, regional-food, mines-and-industrial-heritage, palaces-and-residences, markets, historical-sites, city-gates-and-walls, intangible-heritage, archaeology, entertainment-venues, historic-hotels-and-restaurants, famous-peoples-places]
tier: regional
unit: { level: country, code: PL, name: Poland }
row:
  identity: "the site's article per city, region or theme (/en/<slug>/); its tourist-attraction pages (/en/tourist-attractions/…) are directories"
  wikidata_link: none
  coordinates: unknown
  languages: [en, ja, pt]
  signal: "being named in its editorial articles: a city's page (Kraków), a city-break page, a voivodeship page (Małopolska), its Top attractions page; its alphabetical directories of monuments carry none"
terms:
  licence: "none named; the footer asserts copyright (\"Copyright © 2023 Polish Tourism Organisation\")"
  database_right: unknown
  attribution: "Polish Tourism Organisation (poland.travel), named with a link to the page quoted"
  agent: allowed
  agent_rests_on: "site-access.md, www.poland.travel, read 2026-11-04: robots.txt opens every path to every agent, read through the fetch tool and as an ordinary client alike; the rules and regulations page is silent on robots, automated access, scraping, mining, AI and copying"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: unknown
  volume: "editorial articles per city, region and theme, beside alphabetical directories of monuments, museums and other attractions"
  rate: none
scorecard:
  date: 2026-11-04
  completeness: unknown
  identity: 1
  coordinates: unknown
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: unknown
  total: unknown
  verdict: provisional
status: looked-at
issue: 2325
looked_at: 2026-11-04
---

# Poland Travel

The official site of the Polish Tourism Organisation, Poland's national tourism board, in English
and other languages. Looked at on 2026-11-04 because the Kraków survey (#2325) read it as the
source from inside the country.

**What it sorts its places into.** Two things. Editorial articles: a page per city (*Kraków*),
city-break pages (*Krakow - city break*), a page per voivodeship (*Małopolskie Voivodeship*), a
*Top attractions* page for the whole country and themed articles such as its World Heritage
pages. And directories under `/en/tourist-attractions/` (monuments, museums and more, paged
alphabetically), which the survey did not count: an index of everything recommends nothing.

**Terms ([the access table](../site-access.md), 2026-11-04).** `www.poland.travel`: `allowed`.
`robots.txt` is `User-agent: *` with an empty `Disallow:` and two sitemaps, read through the fetch
tool and as an ordinary client alike; the Kraków page sends no usage signal and
`/.well-known/tdmrep.json` answers 500. The page the footer links as *Rules & Regulations*
("RULES & REGULATIONS - Poland Travel (EN)") says nothing on robots, automated access, scraping,
mining, AI or copying; the footer asserts copyright.

**What decides it.** Not yet decided: completeness against a region's canon is measured per
survey, so the total is `unknown` and the verdict `provisional`. It has a slug per article and no
identifier for a place; its articles are a selection and its directories an enumeration.

**What the survey measured.** Four pages by fetch, one at a time: the Kraków page, the Kraków city
break page, the Top attractions page and the Małopolskie Voivodeship page, beside its robots file
and its rules page. The Kraków survey of 2026-11-04 counted it on 62 of the 145 entries of
`db/catalogue-coverage/expectations/krakow.jsonl` (54 places, 4 dishes, 2 activities, 1 work and 1 route), and on 11 of them as one of only two sources.
The kinds in the front matter are those under which the survey filed two or more of the entries it
is named on.

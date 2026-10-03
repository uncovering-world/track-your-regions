---
slug: it-travel365
name: Travel365
publisher: "Emade srl"
urls:
  home: https://www.travel365.it/roma-cosa-vedere.htm
  dataset: none
  api: none
  terms: https://www.travel365.it/privacy.htm
family: commercial
kinds: [archaeology, regional-food, places-of-worship, towns-and-villages, neighbourhoods, parks-and-gardens, notable-works, squares-and-streets, public-art, art-museums, world-heritage, viewpoints, historic-hotels-and-restaurants, local-customs, palaces-and-castles, regional-drinks, beaches-and-swimming, theme-parks, festivals-and-events]
tier: regional
unit: { level: country, code: IT, name: Italy }
row:
  identity: "none: a place is a numbered heading of a list article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [it]
  signal: "being one of the numbered attractions of a city's article"
terms:
  licence: "none; its privacy and terms page forbids reproducing, copying, publishing or exploiting the content commercially"
  database_right: reserved
  attribution: Travel365
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the page read carries no date"
  volume: "23 numbered attractions in the Rome article, by its title"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Travel365

An Italian travel site, in Italian, owned by Emade srl. Looked at on 2026-10-02 because the Rome
survey read it as its Italian-language guide.

**What it sorts its places into.** Destinations by continent, travel advice and rankings. A city
has a handful of articles: what to see (a numbered list, twenty-three for Rome by its title),
what to eat, trips around, itineraries of three and seven days, when to go. A place is a
numbered heading with a paragraph.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.travel365.it`: `allowed`
(terms forbid reproduction; silent on automated reading). `robots.txt`: some paths closed
(`User-agent: *` only). Terms: silent on automated reading, at
https://www.travel365.it/privacy.htm. "Privacy Policy e Termini Condizioni": the user accepts
"il divieto di riprodurre, copiare, trasmettere, vendere, pubblicare, o sfruttare
commercialmente i contenuti". Nothing on automated access.

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The terms forbid reproduction: ask first. The footer
reads "Copyright © Travel365.it, tutti i diritti sono riservati."

**What the survey measured.** Six pages by fetch. The Rome survey of 2026-10-02 counted it on
134 of the 353 entries of `db/catalogue-coverage/expectations/rome.jsonl` (by type: place 97,
food 19, work 8, activity 5, drink 2, event 2, route 1). On none of them is the surveyor's own
list the only other source. The kinds in the front matter are those under which the survey filed
two or more of the entries it is named on.

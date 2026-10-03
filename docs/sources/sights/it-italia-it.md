---
slug: it-italia-it
name: Italia.it
publisher: "Ministero del Turismo (MiTur)"
urls:
  home: https://www.italia.it/it/lazio/roma
  dataset: none
  api: none
  terms: https://www.italia.it/it/termini-e-condizioni
family: tourism-board
kinds: [notable-works, archaeology, places-of-worship, regional-food, towns-and-villages, art-museums, public-art, squares-and-streets, world-heritage, parks-and-gardens, neighbourhoods, architecture, palaces-and-castles, viewpoints, local-customs, markets, regional-drinks, natural-landmarks, historic-hotels-and-restaurants]
tier: regional
unit: { level: country, code: IT, name: Italy }
row:
  identity: "none seen: a city's page is a set of articles"
  wikidata_link: unknown
  coordinates: unknown
  languages: [it, en, es, fr, de, pt]
  signal: "being written up in an article under the city's page"
terms:
  licence: "none; terms and conditions: no licence beyond strictly personal use, no reproducing or publishing without MiTur's prior written authorisation"
  database_right: reserved
  attribution: "Italia.it (Ministero del Turismo)"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the page read carries no date"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 2
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

# Italia.it

The national tourism portal of the Ministry of Tourism, in six languages. Looked at on
2026-10-02 because the Rome survey read its Rome pages as the national board's.

**What it sorts its places into.** "Dove andare": cities, regions, tourist areas, sea, mountain,
countryside, and lists of villages, UNESCO sites, national parks and lakes; and "Cosa fare". A
city's page ("Cosa vedere a Roma") is a set of articles: two days in the city, unusual things, a
forum, a museum, terraces for an aperitivo, trips out of town. A place is what an article is
about, or a name inside one; no page per place with an id was seen on the saved copy of the Rome
page.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.italia.it`: `allowed` (terms
reserve reproduction; silent on automated reading). `robots.txt`: open (`*`: `Allow: /`; search
pages and one asset tree disallowed). Terms: silent on automated reading, at
https://www.italia.it/it/termini-e-condizioni. "Fatti salvi gli utilizzi strettamente personali,
all'Utente non è concessa alcuna licenza né diritto d'uso e pertanto non è consentito registrare
tali contenuti […] riprodurli, copiarli, pubblicarli e utilizzarli a scopo commerciale senza
preventiva autorizzazione scritta del MiTur". Nothing on robots, automated access or mining. The
link stands on the Italian pages (Rome's survey found it); the German home page this audit was
served shows only a social-media policy.

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The terms reserve reproduction to the ministry's
written authorisation: ask first.

**What the survey measured.** Fourteen pages by fetch, in Italian: the Rome page, its guide, the
weekend, five unusual things, historic cafes, the catacombs, the Imperial Fora, Caravaggio's
works, the Vatican Museums, aperitivo terraces, trips out of town, seven places an hour away,
the Castelli Romani and the necropolises of Cerveteri and Tarquinia. The Rome survey of
2026-10-02 counted it on 151 of the 353 entries of
`db/catalogue-coverage/expectations/rome.jsonl` (by type: place 103, work 28, food 13, activity
4, drink 2, event 1). On none of them is the surveyor's own list the only other source. The
kinds in the front matter are those under which the survey filed two or more of the entries it
is named on.

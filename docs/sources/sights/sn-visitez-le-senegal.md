---
slug: sn-visitez-le-senegal
name: "Destination Sénégal (visitezlesenegal.com)"
publisher: "Agence Sénégalaise de Promotion Touristique (ASPT)"
urls:
  home: https://www.visitezlesenegal.com/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [regional-food, festivals-and-events, art-museums, markets, natural-landmarks, places-of-worship, neighbourhoods, history-museums, public-art, entertainment-venues, beaches-and-swimming, regional-drinks, harbours-and-marinas, towns-and-villages]
tier: regional
unit: { level: country, code: SN, name: Senegal }
row:
  identity: "none: a place is a heading inside its destination page"
  wikidata_link: none
  coordinates: none
  languages: [fr, en]
  signal: "being one of a destination's 'Sites Incontournables'"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Agence Sénégalaise de Promotion Touristique"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "older than two years: the Dakar page was last modified 2024-06-20"
  volume: "six destinations in the menu; the Dakar page puts forward 37 places and 15 events by the survey's count"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 0
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 6
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Destination Sénégal

The site of the Agence Sénégalaise de Promotion Touristique, the national tourism board, in
French and English. Looked at on 2026-10-02 because the Dakar survey read it in its second pass
as its source from a public body inside the country.

**What it sorts its places into.** Six destinations (Dakar, St Louis, Casamance, Sénégal
Oriental, Petite côte, Sine Saloum) and, beside them, Expériences, Arts et cultures, a
gastronomy page, shopping and natural parks. The Dakar page, the one read for the row, runs "Les
Sites Incontournables à Dakar" as a series of headings, each a place: no page per place, no id,
no map point.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.visitezlesenegal.com`:
`allowed` (robots open; no terms linked). `robots.txt`: open (`*`: /wp-admin/ only). Terms: no
terms page linked. The footer has contact details and a copyright line, no legal link (fetch
tool's reading of the home page). Footer, read for this record: "Agence Sénégalaise de Promotion
Touristique. © 2026 Tout droit réservé."

**What decides it.** Identity 0 and coordinates 0, so the verdict is `curator-list` whatever the
total of 6: a list a curator reads. The survey judged the Dakar page "a broad selection, not an
index of every listing", the state television's seat among its places. No licence is stated: ask
first, at contact@aspt.sn (the footer's address).

**What the survey measured.** It could be read whole: the Dakar page in French and in English,
its Gorée page, the Petite Côte page, gastronomie, art et culture, shopping, expériences and
parcs naturels. The Dakar survey of 2026-10-02 counted it on 56 of the 110 entries of
`db/catalogue-coverage/expectations/dakar.jsonl` (by type: place 35, food 9, event 6, activity
3, drink 2, object 1). On 7 of them nothing else but the surveyor's own list names the entry.
Places among those: Arène nationale de lutte; Village des Tortues. The kinds in the front matter
are those under which the survey filed two or more of the entries it is named on.

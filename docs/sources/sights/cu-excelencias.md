---
slug: cu-excelencias
name: "Excelencias Cuba (Caribbean News Digital)"
publisher: "Grupo Excelencias (the footer: \"Caribe News Digital. Publicado por Grupo Excelencias\")"
urls:
  home: https://www.excelenciascuba.com/
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [squares-and-streets, public-art, architecture, historic-hotels-and-restaurants, history-museums, entertainment-venues, regional-drinks]
tier: regional
unit: { level: country, code: CU, name: Cuba }
row:
  identity: "none: a place is named inside a news article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [es]
  signal: "being written about in an article"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Excelencias Cuba"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: a news site published on weekdays, by its own account; the survey kept no date of the articles it read"
  volume: unknown
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
  cadence: 2
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Excelencias Cuba

The Cuban edition of Caribbean News Digital, "el periódico electrónico del Grupo Excelencias",
which by its own account "está dirigido principalmente a profesionales del turismo, aunque
también es de interés para los viajeros"; the survey records it as a Caribbean travel magazine
with a Havana newsroom. Looked at on 2026-10-02 because the Havana survey read three of its
articles in the second pass.

**What it sorts its places into.** News sections: Turismo, Eventos, Destinos, Economía,
Culturales, Generales, Cuba en el Mundo. It is a trade paper, and a place appears in it when
there is news of it.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.excelenciascuba.com`:
`allowed` (robots open; no terms linked). `robots.txt`: open (`*`: Drupal defaults). Terms: no
terms page linked. The footer links a privacy policy only; the fetch tool read it: privacy
matters only. Footer, read for this record: "TODOS LOS DERECHOS RESERVADOS ® CARIBE NEWS
DIGITAL. PUBLICADO POR Grupo Excelencias."

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. An article is read once by a curator. No address to
write to was read.

**What the survey measured.** Three articles by fetch. The Havana survey of 2026-10-02 counted
it on 32 of the 192 entries of `db/catalogue-coverage/expectations/havana.jsonl` (by type: place
28, drink 2, object 1, food 1). On 4 of them nothing else but the surveyor's own list names the
entry. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.

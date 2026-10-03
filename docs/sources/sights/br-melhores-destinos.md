---
slug: br-melhores-destinos
name: "Guia Melhores Destinos"
publisher: "Melhores Destinos, a Brazilian travel-deals site founded in 2008"
urls:
  home: https://guia.melhoresdestinos.com.br/salvador-bahia.html
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [beaches-and-swimming, places-of-worship, historic-hotels-and-restaurants, squares-and-streets, neighbourhoods, regional-food, palaces-and-castles, history-museums, natural-landmarks, landmarks, art-museums, markets, towns-and-villages, specialty-museums, shows-and-performances]
tier: regional
unit: { level: country, code: BR, name: Brazil }
row:
  identity: "the guide's own page per place; older addresses carry numbers, newer ones a slug only; no id exposed"
  wikidata_link: none
  coordinates: none
  languages: [pt]
  signal: "being given a page under the city's guide"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Guia Melhores Destinos"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the Salvador guide was modified 2026-07-03, a place page 2026-10-01"
  volume: "twelve section pages for Salvador"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 0
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: 7
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Guia Melhores Destinos

The destination guides of Melhores Destinos, in Portuguese: "Mais de 100 guias de destinos
totalmente grátis", written by the staff of a site that calls itself "jornalístico e
independente" and "o maior site de promoções de viagens do Brasil". Looked at on 2026-10-02
because the Salvador survey read it as its Brazilian guide.

**What it sorts its places into.** A guide per destination, with section pages; for Salvador:
Quando ir, Onde Ficar, O que fazer, Passeios, Praias, Pontos Turísticos, Onde Comer, Dicas,
Noite, Atividades, Transportes, Compras. A place has a page of its own, typed
`TouristAttraction` in its structured data, with a history and "o que fazer", "quando ir" and
"como chegar" sections; the one read carries no address and no coordinates.

**Terms ([the access table](../site-access.md), 2026-10-02).** `guia.melhoresdestinos.com.br`:
`allowed` (robots open; no terms linked). `robots.txt`: open (`*`: /admin, /admin/,
/assets/*.svg). Signal: /llms.txt exists: "# Guia Melhores Destinos". Terms: no terms page
linked. The footer links a privacy policy only (on www.melhoresdestinos.com.br); the fetch tool
read it: privacy matters only. `www.melhoresdestinos.com.br`: `allowed` (sister host of the
guide; no terms linked). `robots.txt`: open (`*`: /tag/, feeds, trackbacks, `*.php`; MJ12bot
disallowed). Terms: no terms page linked. No terms link on the home page. Salvador read the
guide on guia.melhoresdestinos.com.br, not on this host. Footers, read for this record:
"Copyright © 2008 - 2026 · Guia Melhores Destinos · Guias grátis produzidos pela equipe do
Melhores Destinos" on the guide, "Todos os direitos reservados." on the main site.

**What decides it.** Identity 0 and coordinates 0, so the verdict is `curator-list` whatever the
total of 7. No licence is stated: ask first. No address to write to was read.

**What the survey measured.** It could be read: o que fazer, pontos turísticos, passeios, onde
comer and vida noturna. The Salvador survey of 2026-10-02 counted it on 101 of the 196 entries
of `db/catalogue-coverage/expectations/salvador.jsonl` (by type: place 90, food 6, activity 4,
route 1). On 4 of them nothing else but the surveyor's own list names the entry. The kinds in
the front matter are those under which the survey filed two or more of the entries it is named
on.

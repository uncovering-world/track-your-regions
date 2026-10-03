---
slug: br-salvador-da-bahia
name: "Salvador da Bahia (Visit Salvador da Bahia)"
publisher: "Prefeitura Municipal de Salvador, Secretaria Municipal de Cultura e Turismo (Secult)"
urls:
  home: https://www.salvadordabahia.com/
  dataset: none
  api: none
  terms: https://www.salvadordabahia.com/wp-content/uploads/2019/02/termo-de-uso_salvadordabahia.pdf
family: tourism-board
kinds: [neighbourhoods, squares-and-streets, historic-hotels-and-restaurants, places-of-worship, palaces-and-castles, history-museums, natural-landmarks, beaches-and-swimming, markets, specialty-museums, public-art]
tier: regional
unit: { level: city, code: BR, name: Salvador }
row:
  identity: "the portal's own page per place (/experiencias/<slug>/); no id in the address"
  wikidata_link: none
  coordinates: address-only
  languages: [pt, en, es, fr]
  signal: "being listed under 'Conheça estes lugares', by category, or in one of 'Nossas Listas'"
terms:
  licence: "none; Termos de Uso § 6.1: no copying, distributing or republishing without Secult's prior written consent (the access table has these terms as unread)"
  database_right: reserved
  attribution: "Salvador da Bahia (Secult, Prefeitura de Salvador)"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the home page was modified 2026-10-01"
  volume: "12 places on the first screen of 'Todos os Lugares'"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 1
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: 9
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Salvador da Bahia

The city's tourism portal, run by the municipality with its secretariat of culture and tourism
(Secult), in Portuguese with English, Spanish and French editions. Looked at on 2026-10-02: the
Salvador survey's first pass met HTTP 500 on two English pages, and its second pass read the
Portuguese ones.

**What it sorts its places into.** "Conheça" (`/experiencias/`, "Todos os Lugares"), with the
categories Afroturismo, Esportes, Gastronomia, História e Cultura, Kids, Música, Nômades
Digitais, Religiosidade and Sol e Mar; the cards also carry finer labels (Galerias, Cafés,
Bares). Beside it Roteiros (itineraries), "Nossas Listas" (lists: galleries, churches off the
tourist route, a religious-tourism guide), an Agenda and a blog. A card gives the place's
category, name and street address and links to a page of its own.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.salvadordabahia.com`:
`allowed` (terms are a PDF the fetch tool cannot show). `robots.txt`: open (`*`: /wp-admin/
only). Terms: not read, at
https://www.salvadordabahia.com/wp-content/uploads/2019/02/termo-de-uso_salvadordabahia.pdf. The
footer links "Termos de Uso" as a PDF; the fetch tool showed it as binary, not text. Not
converted. The table has the terms as unread, because the fetch tool shows the PDF as binary.
For this record the file, ten pages created on 25 January 2019 and not encrypted by `pdfinfo`,
was read as text with `pdftotext`. § 1.2: "O site não tem objetivos de lucro, não existindo
qualquer interesse comercial ou outro na seleção dos conteúdos apresentados." § 5.1 counts
"diretórios, listagens e bancos de dados" among the proprietary information. § 6.1: the content
"não pode ser copiado, distribuído, republicado, carregado (uploaded), publicado ou transmitido
de qualquer forma sem o consentimento prévio por escrito da Secult", except viewing on screen
and one copy for personal use. § 3.1: no other use of the site "sem o consentimento expresso
prévio por escrito da Secult". No clause names robots or automated reading.

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of 9. It is
the shape the regional tier asks for, a city's own selection with an address on every card, and
its terms name its listings and databases and reserve them: ask first, in writing, to Secult.
The terms give no address; the site has no contact page among the pages read.

**What the survey measured.** Second pass, by fetch, in Portuguese: the calendar of popular
festivals, the list of terreiros open to visits, the page on religious tourism of African
matrix, a four-day itinerary, "Salvador além do óbvio", "Sabores de Salvador", outings that cost
little, the Liberdade-Curuzu tour, the summer festivals page and the home page; the English
pages still answer 500. The Salvador survey of 2026-10-02 counted it on 83 of the 196 entries of
`db/catalogue-coverage/expectations/salvador.jsonl` (by type: place 56, food 11, event 8,
activity 5, person 3). On 8 of them nothing else but the surveyor's own list names the entry.
Places among those: Ilê Axé Opô Afonjá; Terreiro da Casa Branca do Engenho Velho; Terreiro do
Gantois; Liberdade and Curuzu. The kinds in the front matter are those under which the survey
filed two or more of the entries it is named on.

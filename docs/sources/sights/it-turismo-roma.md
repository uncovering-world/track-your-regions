---
slug: it-turismo-roma
name: "Turismo Roma"
publisher: "Roma Capitale, Dipartimento Grandi Eventi, Sport, Turismo e Moda"
urls:
  home: https://www.turismoroma.it/it
  dataset: none
  api: none
  terms: https://www.turismoroma.it/it/page/copyright
family: tourism-board
kinds: [archaeology, notable-works, places-of-worship, regional-food, parks-and-gardens, squares-and-streets, art-museums, public-art, palaces-and-castles, towns-and-villages, neighbourhoods, festivals-and-events, world-heritage, viewpoints, local-customs, landmarks, history-museums, regional-drinks, architecture, theme-parks, markets, bridges-and-engineering, natural-landmarks, beaches-and-swimming, on-site-activities, tombs-and-mausoleums, zoos-and-aquariums, historic-hotels-and-restaurants]
tier: regional
unit: { level: city, code: IT, name: Rome }
row:
  identity: "the site's page per place (/it/luoghi/<slug>) and its node number, in the page's short link (/it/node/<number>)"
  wikidata_link: none
  coordinates: some
  languages: [it, en, es, fr, de]
  signal: "being a stop of one of its itineraries; its directories by type of place carry none"
terms:
  licence: "none named; the copyright page lets content be copied for strictly personal purposes or with the source named, and asks written authorisation for commercial reproduction"
  database_right: reserved
  attribution: "turismoroma.it, named as the source"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the place page read was modified 2026-09-25"
  volume: "a directory per type of place (churches, monuments, museums, parks, squares) and itineraries by time and by theme"
  rate: "Crawl-delay: 10 (robots.txt)"
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 1
  coordinates: 1
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: 10
  verdict: adoptable-with-curator-pass
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Turismo Roma

"Sito turistico ufficiale": the city's tourism site, published by Roma Capitale, in Italian with
English, Spanish, French and German editions. Looked at on 2026-10-02 because the Rome survey
read it as the city's own source.

**What it sorts its places into.** Two things. Directories of every place of a type
(`/it/tipo-luogo/<type>`: churches, monuments, museums, parks, squares, and a list of historic
shops), which the survey did not open: an index of everything recommends nothing. And
itineraries, by time (48 hours, 72 hours, five days) and by theme, each a run of places with a
map. A place has a page of its own (`/it/luoghi/<slug>`). The one read for the row, the Trevi
Fountain, carries a text, "Informazioni" with address, opening hours and contacts, a map whose
script holds the point (41.900765, 12.483238), and a short link with the page's node number
(`/it/node/1286`).

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.turismoroma.it`: `allowed`
(copyright page silent on automated reading; crawl delay of 10). `robots.txt`: open (`*`: Drupal
defaults and `Crawl-delay: 10`). Terms: silent on automated reading, at
https://www.turismoroma.it/it/page/copyright. Content may be copied "per scopi strettamente
personali o indicando la fonte turismoroma.it"; commercial reproduction needs written
authorisation. Nothing on automated access.

**What decides it.** The total is 10 and the verdict `adoptable-with-curator-pass`. It is the
regional tier's shape with both of its usual gaps closed on the page read: a number per place
and a point. The directories enumerate; the itineraries are the editorial cut. What is owed
before anyone leans on the verdict: whether every place page carries the point and the address,
how many places the directories hold, and whether "indicando la fonte" is all the copyright page
asks of a reuser who is not commercial. The crawl delay of ten seconds is the rate to keep.

**What the survey measured.** Thirty-one pages by fetch, ten seconds apart: the three
itineraries by time, fifteen themed ones, their index pages, "Roma in breve", the cooking pages,
the sea, the surroundings, Tivoli, the Castelli Romani and the "Unexpected Itineraries". The
Rome survey of 2026-10-02 counted it on 262 of the 353 entries of
`db/catalogue-coverage/expectations/rome.jsonl` (by type: place 184, work 39, food 20, activity
8, event 7, drink 3, route 1). On 8 of them nothing else but the surveyor's own list names the
entry. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.

---
slug: de-visitberlin
name: "visitBerlin"
publisher: "Berlin Tourismus & Kongress GmbH"
urls:
  home: https://www.visitberlin.de/en
  dataset: none
  api: none
  terms: https://www.visitberlin.de/en/legal-notice
family: tourism-board
kinds: [art-museums, parks-and-gardens, history-museums, architecture, squares-and-streets, historic-hotels-and-restaurants, historical-sites, regional-food, festivals-and-events, palaces-and-residences, viewpoints, places-of-worship, markets, beaches-and-swimming, live-music-venues, city-gates-and-walls, public-art, towers, archaeology, notable-works, zoos-and-aquariums, natural-landmarks, entertainment-venues, science-and-nature-museums, neighbourhoods, bridges-and-engineering, national-parks-and-reserves, specialty-museums]
tier: regional
unit: { level: city, code: DE, name: Berlin }
row:
  identity: "the site's page per place (/en/<slug>) and its node number, in the page's short link (/en/node/<number>)"
  wikidata_link: none
  coordinates: some
  languages: [de, en, fr, it, es]
  signal: "being on one of its top lists or itineraries (top 10 attractions, top sights, top museums, 24 hours, 3 days); its directories by type of place carry none"
terms:
  licence: "none named; the legal notice puts the content under German copyright law, allows downloads and copies for private, non-commercial use, and asks that a text be used only as a quotation naming the portal and its operator"
  database_right: unknown
  attribution: "visitBerlin (Berlin Tourismus & Kongress GmbH), named with a link to the article quoted"
  agent: allowed
  agent_rests_on: "site-access.md, www.visitberlin.de, read 2026-10-16: closed paths not read"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "continuous: its event pages are dated to the current season"
  volume: "a directory per type of place (sights, museums, memorials, day trips, street food) and themed lists beside it"
  rate: none
scorecard:
  date: 2026-10-16
  completeness: unknown
  identity: 1
  coordinates: 1
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: unknown
  verdict: provisional
status: looked-at
issue: 1600
looked_at: 2026-10-16
---

# visitBerlin

"Berlin's official travel website", published by Berlin Tourismus & Kongress GmbH, the city's
tourism and convention company, in German, English, French, Italian and Spanish. Looked at on
2026-10-16 because the Berlin survey read it as the city's own source.

**What it sorts its places into.** Two things. Directories of every place of a type, with a map
and a page per entry (sights by architecture, museums, memorial sites, day trips, currywurst
stands, street food), which the survey did not count: an index of everything recommends nothing.
And editorial pages: top-ten lists (attractions, sights, museums, activities), itineraries of 24
hours, 48 hours and three days, theme pages (the Berlin Wall, Berlin cuisine, festivals, the
year's main events, Potsdam) and blog articles. A place has a page of its own (`/en/<slug>`). The
one read for the row, the Brandenburg Gate, carries a text, an "Address" block (Pariser Platz,
10117 Berlin), a type in its breadcrumb ("Architecture"), a map script that holds the point
(52.516286, 13.377700), and a short link with the page's node number (`/en/node/14783`).

**Terms ([the access table](../site-access.md), 2026-10-16).** `www.visitberlin.de`: `allowed`
(legal notice silent on automated reading). `robots.txt`: one group for every agent, closing
Drupal's system paths, search and login; no agent is named. Terms: silent on automated reading,
at https://www.visitberlin.de/en/legal-notice: "Reproduction, processing, distribution, or any
form of commercial exploitation of such material beyond the scope of the copyright requires the
prior written consent of its respective copyright owner. Downloads and copies are, unless
otherwise indicated, only permitted for private, non-commercial use." The German Impressum holds
no reservation of text-and-data mining under § 44b UrhG, and `/.well-known/tdmrep.json` answers
404.

**What decides it.** Not yet decided: completeness against the city's canon is measured when the
Berlin list is merged, so the total is `unknown` and the verdict `provisional`. It has a number of
its own per place and, on the page read, a point; whether every place page carries both is owed.
The top lists and itineraries are the editorial cut; the directories enumerate. The legal notice
asks for written consent before any reproduction beyond quotation, which a sync of its texts
would need; names and points read for a survey are not its texts.

**What the survey measured.** Fifteen pages by fetch, one at a time: the home page, the top-ten
lists of attractions, sights, museums and activities, the pages on street food, Berlin cuisine and
typical recipes, day trips, Potsdam, festivals and the year's main events, the three-day
itinerary, the Berlin Wall and the boroughs (a directory, counted for nothing). The Berlin survey of 2026-10-16 counted it on 133 of the 221 entries of `db/catalogue-coverage/expectations/berlin.jsonl`. The kinds in the front matter are those under which the
survey filed two or more of the entries it is named on.

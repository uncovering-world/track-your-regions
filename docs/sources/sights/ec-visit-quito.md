---
slug: ec-visit-quito
name: "Visit Quito"
publisher: "Empresa Pública Metropolitana de Gestión de Destino Turístico (Quito Turismo)"
urls:
  home: https://visitquito.ec/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [regional-food, places-of-worship, parks-and-gardens, squares-and-streets, viewpoints, neighbourhoods, regional-drinks, monuments-and-memorials, natural-landmarks, art-museums, palaces-and-residences, national-parks-and-reserves, historic-hotels-and-restaurants, history-museums]
tier: regional
unit: { level: city, code: EC, name: Metropolitan District of Quito }
row:
  identity: "the site's page per listing and per article (/<slug>/)"
  wikidata_link: none
  coordinates: unknown
  languages: [es, en]
  signal: "being named in its editorial articles (top places, a four-day itinerary, ten places, the parks route, Quito at night, the seasonal food pages); its listing directories carry none"
terms:
  licence: "none named; the footer reserves all rights to Quito Turismo"
  database_right: unknown
  attribution: "Quito Turismo (Visit Quito), named with a link to the page quoted"
  agent: allowed
  agent_rests_on: "site-access.md, visitquito.ec, read 2026-11-04: robots.txt closes WordPress paths, search, feeds, tags and authors only and names no Anthropic agent; no terms page is linked, a privacy policy only"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "continuous: its blog and seasonal pages are dated 2025 and 2026"
  volume: "listing directories by theme (culture, experiences, restaurants, tours, events) drawn by script, and a blog of articles"
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
  cadence: 2
  total: unknown
  verdict: provisional
status: looked-at
issue: 2325
looked_at: 2026-11-04
---

# Visit Quito

The official visitor site of Quito Turismo, the Metropolitan District of Quito's public tourism
company, in Spanish and English. Looked at on 2026-11-04 because the Quito survey (#2325) read it as
the source from inside the country. Its reach is the Metropolitan District: the historic centre, the
northern city, the valleys (Cumbayá, Tumbaco, Los Chillos), the Mitad del Mundo and Pululahua, and
the north-western cloud forest parishes (Nanegalito, Nono, Tandayapa). Otavalo, Cotopaxi and Mindo
lie outside it, and the site does not cover them.

**What it sorts its places into.** Two things. Listing directories by theme (`/culture/`,
`/experiences/`, `/restaurants/`, `/tours/`, `/events/`), whose content is drawn by script: a fetch
shows their filters and "No listings found", so they were not counted, and an index of everything
would recommend nothing anyway. And a blog of editorial articles: top places, itineraries of one and
four days, ten places, a route of parks, Quito at night, day routes into the rural parishes, and
seasonal food pages such as the one on colada morada and guaguas de pan for the Day of the Dead. A
listing page was not read for its row, so whether one carries a coordinate is owed.

**Terms ([the access table](../site-access.md), 2026-11-04).** `visitquito.ec`: `allowed`.
`robots.txt`, read through the fetch tool and as an ordinary client alike, closes the WordPress
paths, search, feeds, `/tag/`, `/author/` and attachments to every agent and names no Anthropic
agent; the home page sends no usage signal. The footer reads "All rights reserved by Empresa Pública
Metropolitana de Gestión de Destino Turístico - Quito Turismo"; the only legal page it links is a
privacy policy (PDF). Nothing is said of robots, automated access, scraping, mining or AI.

The city's institutional site, `www.quito-turismo.gob.ec`, was tried for its article "Los 10 lugares
que tienes que visitar en Quito" and served a gambling advertisement in its place, so nothing of it
is counted.

**What decides it.** Not yet decided: completeness against the region's canon is not measured, so the
total is `unknown` and the verdict `provisional`. It has a slug per listing and per article and no
identifier beyond it; its articles are a selection and its directories an enumeration.

**What the survey measured.** Nine pages by fetch, one at a time: the home page, the culture
directory (drawn by script), the blog index, and six articles (Quito's top places; Quito in four
days; ten places that make you feel the centre of the world; the route of the best parks; Quito at
night; colada morada and guaguas de pan 2026). The Quito survey of 2026-11-04 counted it on 52 of the
125 entries of `db/catalogue-coverage/expectations/quito.jsonl` (37 places, 6 dishes, 5 activities,  3 drinks and 1 event), and on 12 of them it is one of only
two sources. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.

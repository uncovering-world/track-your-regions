---
slug: ec-ecuador-travel
name: "Ecuador Travel"
publisher: "Ministerio de Turismo del Ecuador"
urls:
  home: https://ecuador.travel/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [natural-landmarks, towns-and-villages, regional-food, wildlife-encounters]
tier: regional
unit: { level: country, code: EC, name: Ecuador }
row:
  identity: "the site's page per destination and per article (/<slug>/)"
  wikidata_link: none
  coordinates: none
  languages: [es, en]
  signal: "being named on its region pages (Andes, with tabs for Quito, Otavalo, the Chocó Andino, Ibarra and Cotopaxi) and in its articles"
terms:
  licence: "none named; the footer reads \"© 2004–2023 Ecuador Travel. Todos los derechos reservados\""
  database_right: unknown
  attribution: "Ministerio de Turismo del Ecuador (Ecuador Travel), named with a link to the page quoted"
  agent: allowed
  agent_rests_on: "site-access.md, ecuador.travel, read 2026-11-04: robots.txt allows every agent but /admin/ and /login/; no terms page is linked"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "irregular: its footer is dated 2023, some articles 2021"
  volume: "region pages with a tab per destination, and press articles"
  rate: none
scorecard:
  date: 2026-11-04
  completeness: unknown
  identity: 1
  coordinates: 0
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 1
  total: unknown
  verdict: provisional
status: looked-at
issue: 2325
looked_at: 2026-11-04
---

# Ecuador Travel

The international promotion site of Ecuador's Ministry of Tourism ("Página Oficial de Promoción
Internacional del Ministerio de Turismo del Ecuador"), in Spanish and English. Looked at on 2026-11-04
because the Quito survey (#2325) read it as a second source from inside the country, for the day
trips beyond the Metropolitan District that the city's own site does not cover: Otavalo and the lakes
of Imbabura, the Chocó Andino around Mindo, Ibarra and Cotopaxi.

**What it sorts its places into.** Region pages (Andes, Amazon, Coast, Galápagos), each with a tab
per destination, and articles on themes and cities. The Andes page names the places of each tab with
a sentence or two; its Cotopaxi tab carries a label and no text. Its Quito page (`/es/quito/`)
answered the fetch tool with an image instead of text, so it was not read.

**Terms ([the access table](../site-access.md), 2026-11-04).** `ecuador.travel`: `allowed`.
`robots.txt`, read through the fetch tool and as an ordinary client alike, allows every agent and
closes `/admin/` and `/login/`; the home page sends no usage signal. No terms page is linked; the
footer reads "© 2004–2023 Ecuador Travel. Todos los derechos reservados" and links the Presidency and
the Ministry of Tourism.

**What decides it.** Not yet decided: completeness against the region's canon is not measured, so the
total is `unknown` and the verdict `provisional`. Its pages carry no coordinate and no identifier
beyond their slug.

**What the survey measured.** Four pages by fetch, one at a time: the home page, the Quito page (an
image), the article "Quito, Guayaquil y Cuenca: ciudades de contrastes" and the Andes region page in
English. The Quito survey of 2026-11-04 counted it on 22 of the 125 entries of
`db/catalogue-coverage/expectations/quito.jsonl` (15 places, 4 activities and  3 dishes), and on 5 of them it is one of only two sources. The
kinds in the front matter are those under which the survey filed two or more of the entries it is
named on.

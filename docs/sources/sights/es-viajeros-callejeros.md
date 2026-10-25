---
slug: es-viajeros-callejeros
name: "Viajeros Callejeros"
publisher: "Viajeros Callejeros 2021 SL (Spain)"
urls:
  home: https://www.viajeroscallejeros.com/
  dataset: none
  api: none
  terms: https://www.viajeroscallejeros.com/aviso-legal/
family: commercial
kinds: [archaeology, natural-landmarks, places-of-worship, towns-and-villages, viewpoints, markets, regional-food, hiking-trails-and-walks, notable-works, outdoor-activities, world-heritage, cultural-landscapes, neighbourhoods, regional-drinks, art-museums, day-trips-and-itineraries, historic-hotels-and-restaurants]
tier: regional
unit: { level: any, code: none, name: "read per destination" }
row:
  identity: "none: a place is a heading of a list article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [es]
  signal: "being one of the numbered places of a destination's article"
terms:
  licence: "none; legal notice: no reproduction, distribution or public communication for commercial ends without authorisation"
  database_right: reserved
  attribution: "Viajeros Callejeros"
  agent: refused
  agent_rests_on: "site-access.md, www.viajeroscallejeros.com, read 2026-10-24: `robots.txt` disallows Anthropic agents by name; it was open on 2026-10-02"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "continuous: the article read was modified 2026-09-28"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-24
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 1
  signal: 1
  terms: 0
  access: 1
  cadence: 2
  total: unknown
  verdict: veto
status: refused
issue: 1951
looked_at: 2026-10-02
---

# Viajeros Callejeros

A Spanish-language travel blog "para viajar por libre", owned by a Spanish company. Two surveys
read it as their Spanish-language guide: the Cusco region's and Mexico City's. It is written in
the language of both places and from neither, so it is not a source from inside the country; it
is recorded because the surveys counted it beside those that are. Its file carries the
publisher's country, and its unit is `any`: it is read per destination.

**What it sorts its places into.** Countries by continent, and "Top 10" lists of cities. A
destination has list articles (so many places to see, a day in the city, the best tours) and
diary pages of a trip, day by day. A place is a numbered heading or a name in the day's text.

**Terms ([the access table](../site-access.md), 2026-10-24).** `www.viajeroscallejeros.com`:
`refused`. `robots.txt` disallows Anthropic agents by name: `ClaudeBot`, `anthropic-ai` and
`Claude-Web` each stand under `Disallow: /`. On 2026-10-02, when the surveys read it, the file
was open and named no Anthropic agent. Terms, as the legal notice read on 2026-10-02 put them:
silent on automated reading, at https://www.viajeroscallejeros.com/aviso-legal/. Reproduction,
distribution and public communication "con fines comerciales" are forbidden without
authorisation.

**What decides it.** The access table: `refused`, on the site's own `robots.txt`. Terms 0, so
the verdict is `veto` and the status `refused`. Nothing of it counts. Identity is 0 as well: a
place is a heading of a list article. What would reopen it is a `robots.txt` that admits an
Anthropic agent again.

**What the survey measured.** The Cusco region survey of 2026-10-02 read ten pages of it by
fetch, readers' comments cut before reading, and the Mexico City survey four, while the site was
open. Nothing of it counts: the surveys withdrew every count taken from it (#1962), and this
record carries no figure but what was withdrawn. The kinds in the front matter are those under
which the surveys had filed two or more of the entries it was named on. The surveys withdrew, by
region:

- Cusco region: 84 counts (`robots.txt` refuses Anthropic agents since 2026-10-24). On 11
  entries it was one of only two sources. Re-judged, 4 are kept on a second source that names
  them, Lonely Planet's Italian site (`www.lonelyplanetitalia.it`), and 7 are dropped, no other
  source read naming them. The list holds 125 entries.
- Mexico City: 77 counts (the same refusal). On 14 entries it was one of only two sources.
  Re-judged, 7 are kept, 5 on México Desconocido (`www.mexicodesconocido.com.mx`) and 2 on Guías
  Viajar, and 7 are dropped. The list holds 245 entries.

Which entries were kept and dropped, and which pages named them, is kept under `docs/local/`,
a guide's selection being its publisher's.

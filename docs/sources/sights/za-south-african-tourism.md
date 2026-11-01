---
slug: za-south-african-tourism
name: "South African Tourism (southafrica.net)"
publisher: "South African Tourism (SAT)"
urls:
  home: https://www.southafrica.net/
  dataset: none
  api: none
  terms: https://www.southafrica.net/za/en/travel/page/terms-and-conditions
family: tourism-board
kinds: [beaches-and-swimming, festivals-and-events, historic-hotels-and-restaurants, history-museums, markets, national-parks-and-reserves, natural-landmarks, neighbourhoods, notable-people, parks-and-gardens, regional-drinks, regional-food, science-and-nature-museums, squares-and-streets, towns-and-villages, viewpoints, wildlife, wineries-and-vineyards, world-heritage]
tier: regional
unit: { level: country, code: ZA, name: South Africa }
row:
  identity: "none seen: a place has an article (/gl/en/travel/article/<slug>) or a destination page (/gl/en/travel/category/places-to-go/<area>/<place>)"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en, de, fr, it, nl, pt, es, ja, zh]
  signal: "being given an article, or named in one"
terms:
  licence: "none; terms and conditions reserve copying (7.1.2, 7.6.5) and bar building a database by download (7.6.6)"
  database_right: reserved
  attribution: "South African Tourism"
  agent: allowed
  agent_rests_on: "site-access.md, www.southafrica.net, read 2026-11-01: a bar on copying is no bar on reading; a few pages, one at a time, names only; closed paths not read"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "unknown: no date on the pages read"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-11-01
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
issue: 2232
looked_at: 2026-11-01
---

# South African Tourism (southafrica.net)

The national tourism body's site, in English with editions by market (`/za/`, `/gl/`, `/au/`,
`/ao/`, …) and in eight more languages. Looked at on 2026-11-01 because the Cape Town survey read
it as its source from inside the country: Cape Town Tourism's own site, `www.capetown.travel`,
answers 403 or a Cloudflare challenge to every page and is refused in the access table.

**What it sorts its places into.** "Places to go" by area (`/gl/en/travel/category/places-to-go/big-city-life/cape-town`)
and articles by theme ("Western Cape highlights", "Top 10 historical sites in the Western Cape",
"Cape Town on a budget", "Awesome things to do in Cape Town in winter"). An article recommends by
name and in prose; there is no listing per place and no identifier beyond the page's slug.

**Terms ([the access table](../site-access.md), 2026-11-01).** `www.southafrica.net`: `allowed`
(a bar on copying is no bar on reading; a few pages, one at a time, names only; closed paths not
read). `robots.txt`: `User-agent: *` closes query strings (`/*?`), `/media/` and the asset
directories; four named crawlers are shut out whole; `Googlebot` is allowed; no Anthropic agent is
named and there is no `Content-Signal`. Terms at
https://www.southafrica.net/za/en/travel/page/terms-and-conditions, undated: 6.4.1 "You may use
this Website to browse and print the Website Content"; 7.1.2 no "incorporate any part of the
Website Content in any other work or publication without consent"; 7.6.5 no "reproduce,
duplicate, copy, sell, resell or otherwise exploit for any commercial purposes, any part of" the
content; 7.6.6 no "create a database by downloading and storing all or any Website Content".
Nothing on robots, automated access, mining or AI.

**What decides it.** Identity 0 (no identifier, no address, no coordinates on the pages read), so
the verdict is `curator-list`; the total is `unknown` because the coordinates were not looked at.
The terms reserve reproduction and bar bulk download: the survey records names and nothing else.

**What the survey measured.** Eight pages by fetch, none on a closed path: the `/za/en/travel`
landing page, the Cape Town destination page and six articles. The Cape Town survey of 2026-11-01
counted it on 60 of the 186 entries of `db/catalogue-coverage/expectations/cape-town.jsonl`
(by type: place 41, species 5, activity 5, drink 2, event 2, food 2, person 2, route 1). On 6 of them the surveyor's own list is the only other source. The kinds
in the front matter are those under which the survey filed two or more of the entries it is named
on.

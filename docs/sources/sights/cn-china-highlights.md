---
slug: cn-china-highlights
name: "China Highlights"
publisher: "Highlights Travel Co., Ltd.; the survey records it as an agency based in Guilin"
urls:
  home: https://www.chinahighlights.com/beijing/attraction/
  dataset: none
  api: none
  terms: https://www.chinahighlights.com/aboutus/terms.htm
family: commercial
kinds: [regional-food, places-of-worship, festivals-and-events, squares-and-streets, landmarks, neighbourhoods, historic-hotels-and-restaurants, world-heritage, parks-and-gardens, tombs-and-mausoleums, shows-and-performances, entertainment-venues, markets, palaces-and-castles, art-museums, intangible-heritage, natural-landmarks]
tier: regional
unit: { level: country, code: CN, name: China }
row:
  identity: "the guide's own page per attraction (/<city>/attraction/<slug>.htm); no id exposed"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en]
  signal: "being one of the ranked 'must-see' attractions of the city's page"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "China Highlights"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the Beijing attractions page was modified 2026-09-29"
  volume: "12 attractions on the Beijing page, 8 of them with a page of their own"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 0
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

# China Highlights

The guide pages of a Chinese travel agency, in English. Looked at on 2026-10-02 because the
Beijing survey read it as one of two guides written by agencies inside the country.

**What it sorts its places into.** Per city, an attractions page that ranks a dozen ("The Top 12
Must-See Tourist Attractions in Beijing"), each with a paragraph on what makes it special and
whom it suits, most with a page of their own; beside it a top-things-to-do page, a food page and
festival pages. The page read carries no Chinese names for the places.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.chinahighlights.com`:
`allowed` (terms are booking terms). `robots.txt`: some paths closed (`*` plus twenty agents
disallowed by name, offline copiers (HTTrack, WebZIP, Teleport and others) and two search
spiders; no AI agent named. /beijing/ guide pages are not disallowed). Terms: silent on
automated reading, at https://www.chinahighlights.com/aboutus/terms.htm. Terms of the tour
contract; nothing on the website's content or automated access. Footer, read for this record: "©
1998-2026 Highlights Travel Co., Ltd. All rights reserved."

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. No licence is stated: ask first, through the site's
contact page (`/contactus/`).

**What the survey measured.** Four pages by fetch: the attractions page, top things to do, food
and restaurants, and the temple fairs. The Beijing survey of 2026-10-02 counted it on 90 of the
247 entries of `db/catalogue-coverage/expectations/beijing.jsonl` (by type: place 58, food 14,
activity 8, event 8, work 1, drink 1). On 6 of them nothing else but the surveyor's own list
names the entry. The kinds in the front matter are those under which the survey filed two or
more of the entries it is named on.

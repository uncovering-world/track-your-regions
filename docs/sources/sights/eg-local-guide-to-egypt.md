---
slug: eg-local-guide-to-egypt
name: "The Local's Guide To Egypt"
publisher: "The Local's Guide To Egypt"
urls:
  home: https://www.localguidetoegypt.com/
  dataset: none
  api: none
  terms: https://www.localguidetoegypt.com/privacy-policy
family: commercial
kinds: [archaeology, places-of-worship, historic-hotels-and-restaurants, tombs-and-mausoleums, regional-food, neighbourhoods, palaces-and-castles, notable-works, art-museums, landmarks, historic-houses, tours-and-cruises, markets, entertainment-venues, history-museums, regional-drinks, viewpoints]
tier: regional
unit: { level: country, code: EG, name: Egypt }
row:
  identity: "none: a place is a heading of a blog post"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en]
  signal: "being named in one of its posts"
terms:
  licence: "none; its terms of service ask permission for copying or republishing and allow one copy of a page for non-commercial use"
  database_right: not-asserted
  attribution: "The Local's Guide To Egypt"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the home page read carries no date"
  volume: unknown
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
  cadence: 0
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# The Local's Guide To Egypt

"An Egyptian blog and travel guide for both tourists and locals alike" (its own description), in
English; the survey records it as written by residents born and raised in Cairo. Looked at on
2026-10-02 because the Cairo survey read it as its guide from inside the city.

**What it sorts its places into.** A blog, with City Guides (eight cities and regions, Cairo
first), Tips & Tricks and Ancient Egypt. A post is a list: so many restaurants, bars, tombs,
things to do. A place is a heading of a post.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.localguidetoegypt.com`:
`allowed` (terms count automated access as use of the site and do not bar it). `robots.txt`:
open (`*`: `Allow: /`, `Disallow: *?lightbox=`; PetalBot is disallowed, dotbot and AhrefsBot
have a crawl delay of 10). Signal: /llms.txt exists: "# Local Guide To Egypt". Terms: silent on
automated reading, at https://www.localguidetoegypt.com/privacy-policy. The footer's "Copyright
Policy" link opens this page, which holds the terms of service. It mentions automated access
only to say that it, too, is use of the site; it does not bar it. Copying or republishing needs
permission; one copy of a page may be downloaded for non-commercial use. The clause, as the
table has it: "Accessing the Site, in any manner, whether automated or otherwise, constitutes
use of the Site and your agreement to be bound by these Terms of Service."

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. Its terms count automated access as use of the site
and do not bar it; copying or republishing needs permission: ask first.

**What the survey measured.** Twenty-seven posts, found through the site's own sitemap: the
headings and bold names of each, and single passages where a heading was not enough. The Cairo
survey of 2026-10-02 counted it on 129 of the 198 entries of
`db/catalogue-coverage/expectations/cairo.jsonl` (by type: place 100, food 13, activity 6, work
6, drink 2, route 1, event 1). On 6 of them nothing else but the surveyor's own list names the
entry. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.

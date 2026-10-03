---
slug: au-tourism-australia
name: "Australia.com (Tourism Australia)"
publisher: "Tourism Australia"
urls:
  home: https://www.australia.com/en
  dataset: none
  api: none
  terms: https://www.australia.com/en/terms-and-conditions.html
family: tourism-board
kinds: [neighbourhoods, beaches-and-swimming, historic-hotels-and-restaurants, natural-landmarks, national-parks-and-reserves, art-museums, squares-and-streets, world-heritage, architecture, parks-and-gardens, towns-and-villages, zoos-and-aquariums]
tier: regional
unit: { level: country, code: AU, name: Australia }
row:
  identity: "none seen: a place has a guide page (/en/places/<area>/guide-to-<place>.html)"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en, de, fr, it, id, ja, ko, vi, zh]
  signal: "being given a guide page or named in one"
terms:
  licence: "none; terms and conditions: no reproducing of any content without express written permission"
  database_right: reserved
  attribution: "Tourism Australia"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: no date on the page read"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
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
issue: 1213
looked_at: 2026-10-02
---

# Australia.com

The national tourism body's site, in English with editions in eight more languages; its
`robots.txt` closes the regional editions and the listings it takes from the Australian Tourism
Data Warehouse, and leaves `/en/` open. Looked at on 2026-10-02 because the Sydney survey read
it as the national body's.

**What it sorts its places into.** "Places to go" and "Things to do": a guide page per city or
area (`/en/places/<area>/guide-to-<place>.html`) and articles by theme. The products and
services it lists are the operators' own entries, of which the site says it "is not the owner,
operator, advertiser or promoter". Only the home page was read for this record.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.australia.com`: `allowed`
(terms forbid reproduction; silent on automated reading). `robots.txt`: some paths closed
(`User-agent: *` only; /en/ pages are not disallowed). Signal: /llms.txt exists: "#
www.australia.com/en llms.txt". Terms: silent on automated reading, at
https://www.australia.com/en/terms-and-conditions.html. The user must not "reproduce any Content
from our Site(s) without our express written permission"; nothing on robots, automated access or
AI.

**What decides it.** Identity 0 on the addresses seen, so the verdict is `curator-list`; the
total is `unknown` because the coordinates were not looked at. For one city it is a thin second
to the state's site. The terms reserve reproduction: ask first.

**What the survey measured.** Nine pages by fetch, none on a closed path. The Sydney survey of
2026-10-02 counted it on 82 of the 483 entries of
`db/catalogue-coverage/expectations/sydney.jsonl` (by type: place 63, activity 7, route 4, event
4, food 2, drink 2). On none of them is the surveyor's own list the only other source. The kinds
in the front matter are those under which the survey filed two or more of the entries it is
named on.

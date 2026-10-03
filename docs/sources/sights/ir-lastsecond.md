---
slug: ir-lastsecond
name: "LastSecond (لست‌سکند)"
publisher: "LastSecond, a travel site and marketplace of agency tours, launched in 1389"
urls:
  home: https://lastsecond.ir/
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [places-of-worship, regional-food, bridges-and-engineering, squares-and-streets, parks-and-gardens, palaces-and-castles, zoos-and-aquariums, landmarks, historic-houses, world-heritage, natural-landmarks, viewpoints, specialty-museums, baths-and-spas, science-and-nature-museums]
tier: regional
unit: { level: country, code: IR, name: Iran }
row:
  identity: "none for a place: a blog article has a number in its address, and a list article names many places under one number"
  wikidata_link: none
  coordinates: most
  languages: [fa]
  signal: "being one of the sights of a city's list article"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: LastSecond
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "irregular: the Isfahan article is dated 2024-04-03 and was modified 2025-11-03"
  volume: "58 sights in the Isfahan article, by its title"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 1
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 1
  total: 7
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# LastSecond

A Persian-language travel site launched in 1389 to inform travellers correctly and quickly (its
About page, in translation), which also carries the tour packages of travel agencies. Looked at
on 2026-10-02 because the Isfahan survey read it in its second pass as a second guide in the
country's language.

**What it sorts its places into.** Blog articles (`/blog/<number>-<slug>`). The one read, the
sights of Isfahan, promises 58 in its title, "with address and price", gives each a heading, and
carries 60 Google Maps embeds. The points are Google's, so they are a pointer to a place and not
a coordinate the catalogue could take.

**Terms ([the access table](../site-access.md), 2026-10-02).** `lastsecond.ir`: `allowed` (no
terms linked). `robots.txt`: some paths closed (`User-agent: *` only; /blog/ is not disallowed).
Terms: no terms page linked. The fetch tool found no terms, copyright or privacy link in the
footer. Footer, read for this record: "تمامی حقوق این وبگاه از آنِ لست‌سکند است." (all rights of
this website belong to LastSecond), "1389 - 1405".

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of 7. No
licence is stated: ask first, through the site's contact page (`/contact`).

**What the survey measured.** Two pages by fetch: the sights of Isfahan and the local dishes.
The survey compared its lists with Kojaro's and counts the two as two sources: the sight lists
differ in order and content, the dish lists overlap heavily. The Isfahan survey of 2026-10-02
counted it on 52 of the 149 entries of `db/catalogue-coverage/expectations/isfahan.jsonl` (by
type: place 44, food 8). On 7 of them nothing else but the surveyor's own list names the entry.
The kinds in the front matter are those under which the survey filed two or more of the entries
it is named on.

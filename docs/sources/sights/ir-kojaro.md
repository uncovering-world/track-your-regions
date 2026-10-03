---
slug: ir-kojaro
name: "Kojaro (کجارو)"
publisher: "Kojaro, registered as an information site (no. 78280) with the Ministry of Culture and Islamic Guidance; active since Mordad 1394"
urls:
  home: https://www.kojaro.com/
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [regional-food, regional-crafts, natural-landmarks, places-of-worship, world-heritage, squares-and-streets, palaces-and-castles, bridges-and-engineering, parks-and-gardens, zoos-and-aquariums, towns-and-villages, festivals-and-events, markets, intangible-heritage, specialty-museums, historic-hotels-and-restaurants]
tier: regional
unit: { level: country, code: IR, name: Iran }
row:
  identity: "none for a place: an article has a number in its address, and a list article names many places under one number"
  wikidata_link: unknown
  coordinates: unknown
  languages: [fa]
  signal: "being named in a city's list of sights"
terms:
  licence: "none; footer: copying part or all of any article only with written permission"
  database_right: not-asserted
  attribution: Kojaro
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: articles dated within days on the home page"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 1
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

# Kojaro

A Persian-language travel magazine: by its About page the most-read tourism medium in Iran, with
about three million readers a month, registered with the Ministry of Culture and Islamic
Guidance and at work since Mordad 1394. Looked at on 2026-10-02 because the Isfahan survey read
it in its second pass as a guide written by residents, in the country's language.

**What it sorts its places into.** The menu: the tourism magazine, news, attractions (جاذبه‌ها),
the travel guide (راهنمای سفر). An article's address carries its section, a number and a slug
(`/attraction/<number>-<slug>/`). What the survey read are list articles: the sights of a city,
a travel guide to it, its local dishes. No list article was opened for this record.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.kojaro.com`: `allowed` (no
terms linked). `robots.txt`: open (`*` disallows search, comment, question, api, user, account
and profile paths and tracking parameters). Terms: no terms page linked. The footer links about,
contact and advertising pages; its copyright line says copying needs written permission. The
copyright line the table mentions, as read for this record: "کپی بخش یا کل هر کدام از مطالب
کجارو تنها با کسب مجوز مکتوب امکان پذیر است." (copying part or all of any Kojaro article is
possible only with written permission), under "© 1405 - 1393".

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The terms are ask first, in writing; the site has a
contact page (`/contact-us/`).

**What the survey measured.** Three pages by fetch: the sights of Isfahan, the travel guide to
Isfahan and the local dishes. The Isfahan survey of 2026-10-02 counted it on 66 of the 149
entries of `db/catalogue-coverage/expectations/isfahan.jsonl` (by type: place 40, food 15,
object 6, event 3, activity 2). On 4 of them nothing else but the surveyor's own list names the
entry. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.

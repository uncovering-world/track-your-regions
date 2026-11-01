---
slug: th-bk-magazine
name: "BK Magazine"
publisher: "Coconuts Media Limited (the terms name Asia City Media Group, its former publisher)"
urls:
  home: https://www.bkmagazine.com/
  dataset: none
  api: none
  terms: https://www.bkmagazine.com/terms-of-service/
family: commercial
kinds: [places-of-worship, regional-food, historic-hotels-and-restaurants, neighbourhoods, markets, squares-and-streets]
tier: regional
unit: { level: city, code: TH, name: Bangkok }
row:
  identity: "an article per list, under /<section>/<slug>/; a place has no page of its own"
  wikidata_link: none
  coordinates: none
  languages: [en]
  signal: "being named in one of its lists or routes: the nine-shrines route, the street-eats list, the Chinatown eating guide, the Chinese-shrines list, the old-markets day trips"
terms:
  licence: "none named; the terms let a reader download content for personal use only and bar copying, redistribution, publication and commercial exploitation without permission"
  database_right: unknown
  attribution: "BK Magazine, with a link to the article"
  agent: allowed
  agent_rests_on: "site-access.md, www.bkmagazine.com, read 2026-11-01: robots.txt closes /wp-admin/ only; the terms bar copying and say nothing of robots, mining or AI"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "weekly for its events lists; the lists the survey read are undated articles of 2017 to 2020"
  volume: "a city magazine's archive: sections for things to do, food, street food, nightlife, shopping, travel, each a stream of articles"
  rate: none
scorecard:
  date: 2026-11-01
  completeness: unknown
  identity: 0
  coordinates: 0
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 1
  total: unknown
  verdict: curator-list
status: looked-at
issue: 2232
looked_at: 2026-11-01
---

# BK Magazine

Bangkok's English-language city magazine, written in Bangkok for the people who live there, since
2018 a Coconuts Media title; `bk.asia-city.com`, its former address, redirects to it. Looked at
on 2026-11-01 because the Bangkok survey read it as a second source from inside the country,
beside the Thai-language bangkoktourist.com.

**What it sorts its places into.** Sections (things to do, food, street food, nightlife,
shopping, travel, city living), each a stream of dated articles. The articles the survey counted
are lists and routes: a nine-shrines merit-making route through the city, the essential street
eats with the stall for each, a street-food-hopping guide to Chinatown, the top Chinese shrines,
and six old markets within a day of Bangkok. A place has no page of its own: it is named in an
article's body with its street, and sometimes a house number, and no coordinates. The weekly
"things to do this weekend" lists and the section indexes were read for their titles only.

**Terms ([the access table](../site-access.md), 2026-11-01).** `www.bkmagazine.com`: `allowed`
(terms bar copying, nothing on automated reading). `robots.txt`: `User-agent: *` closes
`/wp-admin/` only. Terms of Service, § 5, at https://www.bkmagazine.com/terms-of-service/:
"Subscriber may download copyrighted material for Subscriber's personal use only" and "no
copying, redistribution, retransmission, publication or commercial exploitation of downloaded
material" without permission; no clause on robots, crawlers, scraping, mining or AI.
`/.well-known/tdmrep.json` answers 403, a firewall's answer rather than a reservation.

**What decides it.** Identity 0 decides it: a source with no identifier and no point per place is a
curator's list whatever its total (`filling-a-kind.md` § Vetoes), so the verdict is `curator-list`
and the total stays `unknown`. It is the residents' cut
of where to eat and which shrine to visit, strongest on street food and Chinatown, with no
identity and no point per place; a sync of its texts would need the publisher's permission,
which names read for a survey do not.

**What the survey measured.** Nine pages by fetch, one at a time: the home page, the terms, the
things-to-do and street-food indexes, the nine-shrines route, the old-markets article, the
street-eats list, the Chinatown eating guide and the Chinese-shrines list. The Bangkok survey of
2026-11-01 counted it on 41 of the 267 entries of
`db/catalogue-coverage/expectations/bangkok.jsonl`: 27 places, 1 work, 1 activity, 1 event, 10
dishes and 1 drink. The kinds in the front matter are those under which the survey filed two or
more of the entries it is named on.
